import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { Code80Client, type HttpFetch } from "./code80-client.js";
import { Code80HttpError, type BatchState, type BatchView, type ImageBatch, type ImageJob, type ModelChoice } from "./domain.js";
import { importImage, persistProviderImage, scanFolder } from "./image-io.js";
import type { LocalLayout } from "./platform.js";
import { fileExists, readJson, removeManaged, writeJson } from "./platform.js";
import type { SettingsService } from "./settings.js";

const terminal = new Set(["succeeded", "failed", "canceled"]);

function now(): string { return new Date().toISOString(); }

function stateOf(batch: ImageBatch): BatchState {
  const states = batch.jobs.map((job) => job.state);
  if (states.some((state) => state === "running")) return "running";
  if (states.some((state) => state === "queued")) return "queued";
  const succeeded = states.filter((state) => state === "succeeded").length;
  const failed = states.filter((state) => state === "failed").length;
  const canceled = states.filter((state) => state === "canceled").length;
  if (succeeded === states.length) return "completed";
  if (failed === states.length) return "failed";
  if (canceled === states.length) return "canceled";
  return "partial";
}

export function batchView(batch: ImageBatch): BatchView {
  const count = (state: ImageJob["state"]) => batch.jobs.filter((job) => job.state === state).length;
  return {
    ...structuredClone(batch),
    state: stateOf(batch),
    total: batch.jobs.length,
    queued: count("queued"),
    running: count("running"),
    succeeded: count("succeeded"),
    failed: count("failed"),
    canceled: count("canceled")
  };
}

function createJob(ordinal: number, prompt: string, references: string[], model: ModelChoice, size?: string, quality?: string): ImageJob {
  return {
    id: randomUUID(),
    ordinal,
    label: `图${ordinal}`,
    prompt,
    references: [...new Set(references)],
    size,
    quality,
    versions: [],
    model: structuredClone(model),
    state: "queued",
    progress: 0,
    attempt: 0,
    retryable: true,
    billing: "not_charged",
    createdAt: now()
  };
}

export interface CreateBatchInput {
  title?: string;
  modelId?: string;
  prompt?: string;
  jobs?: Array<{ prompt: string; references?: string[] }>;
  imagePaths?: string[];
  folderPath?: string;
  recursive?: boolean;
  sharedReferences?: string[];
  count?: number;
  size?: string;
  quality?: string;
  outputDirectory?: string;
  requestKey?: string;
}

export class BatchService {
  private records = new Map<string, ImageBatch>();
  private active = new Map<string, number>();
  private writes = new Map<string, Promise<void>>();
  private revision = 0;

  constructor(private layout: LocalLayout, private settings: SettingsService, private http: HttpFetch = fetch) {}

  async initialize(): Promise<void> {
    await mkdir(this.layout.batchDirectory, { recursive: true });
    for (const name of await readdir(this.layout.batchDirectory)) {
      if (!name.endsWith(".json")) continue;
      const value = await readJson<ImageBatch | undefined>(path.join(this.layout.batchDirectory, name), undefined);
      if (value?.id && Array.isArray(value.jobs)) this.records.set(value.id, value);
    }
    for (const batch of this.records.values()) {
      let changed = false;
      for (const job of batch.jobs) {
        if (job.state === "running") { job.state = "failed"; job.error = "插件重启时任务仍在运行，请手动重试。"; job.billing = "unknown"; changed = true; }
      }
      if (changed) await this.persist(batch);
      this.schedule(batch.id);
    }
  }

  activation(): { batchId?: string; revision: number } { return { batchId: this.newest()?.id, revision: this.revision }; }

  get(id: string): BatchView {
    const batch = this.records.get(id);
    if (!batch) throw new Error("找不到指定的 Code80 Image 批次。");
    return batchView(batch);
  }

  list(limit = 10): BatchView[] { return this.sorted().slice(0, limit).map(batchView); }

  listPage(page: number, pageSize: number): { batches: BatchView[]; page: number; pageSize: number; total: number; totalPages: number } {
    const sorted = this.sorted();
    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    return { batches: sorted.slice((safePage - 1) * pageSize, safePage * pageSize).map(batchView), page: safePage, pageSize, total: sorted.length, totalPages };
  }

  private sorted(): ImageBatch[] { return [...this.records.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  private newest(): ImageBatch | undefined { return this.sorted()[0]; }

  async create(input: CreateBatchInput): Promise<BatchView> {
    if (input.requestKey) {
      const existing = [...this.records.values()].find((batch) => batch.requestKeys[input.requestKey!]);
      if (existing) return batchView(existing);
    }
    const model = await this.settings.defaultChoice(input.modelId);
    let images = [...new Set(input.imagePaths || [])];
    if (input.folderPath) images.push(...(await scanFolder(input.folderPath, Boolean(input.recursive), 50)).map((item) => item.path));
    images = [...new Set(images)].slice(0, 50);
    const shared = [...new Set(input.sharedReferences || [])];
    const tasks: Array<{ prompt: string; references: string[] }> = [];
    if (input.jobs?.length) {
      for (const job of input.jobs) tasks.push({ prompt: job.prompt, references: [...shared, ...(job.references || [])] });
    } else if (images.length) {
      if (!input.prompt) throw new Error("图片批处理需要 Prompt。");
      for (const image of images) tasks.push({ prompt: input.prompt, references: [...shared, image] });
    } else {
      if (!input.prompt) throw new Error("生图任务需要 Prompt。");
      const count = Math.max(1, Math.min(50, input.count || 1));
      for (let index = 0; index < count; index += 1) tasks.push({ prompt: input.prompt, references: shared });
    }
    if (!tasks.length || tasks.length > 50) throw new Error("每个批次必须包含 1–50 个任务。");
    const id = randomUUID();
    const outputDirectory = input.outputDirectory ? path.resolve(input.outputDirectory) : path.join(this.layout.outputDirectory, id);
    await mkdir(outputDirectory, { recursive: true });
    const created = now();
    const batch: ImageBatch = {
      id,
      title: input.title?.trim() || input.prompt?.slice(0, 60) || `图片批次 ${created.slice(0, 10)}`,
      summaryPrompt: input.prompt || "独立任务 Prompt",
      outputDirectory,
      model: structuredClone(model),
      jobs: tasks.map((task, index) => createJob(index + 1, task.prompt, task.references, model, input.size, input.quality)),
      requestKeys: input.requestKey ? { [input.requestKey]: [] } : {},
      createdAt: created,
      updatedAt: created
    };
    if (input.requestKey) batch.requestKeys[input.requestKey] = batch.jobs.map((job) => job.id);
    this.records.set(batch.id, batch);
    this.revision += 1;
    await this.persist(batch);
    this.schedule(batch.id);
    return batchView(batch);
  }

  async append(batchId: string, jobs: Array<{ prompt: string; references?: string[]; sourceJobId?: string }>, modelId?: string, requestKey?: string): Promise<BatchView> {
    const batch = this.mutable(batchId);
    if (requestKey && batch.requestKeys[requestKey]) return batchView(batch);
    if (batch.jobs.length + jobs.length > 50) throw new Error("一个批次最多包含 50 个任务。");
    const model = modelId ? await this.settings.defaultChoice(modelId) : batch.model;
    const createdIds: string[] = [];
    for (const input of jobs) {
      const source = input.sourceJobId ? batch.jobs.find((job) => job.id === input.sourceJobId) : undefined;
      if (input.sourceJobId && !source) throw new Error("找不到要重建的来源任务。");
      const references = [...(source?.references || []), ...(input.references || [])];
      if (source?.outputFile) references.push(source.outputFile);
      const job = createJob(batch.jobs.length + 1, input.prompt, references, model);
      batch.jobs.push(job);
      createdIds.push(job.id);
    }
    if (requestKey) batch.requestKeys[requestKey] = createdIds;
    await this.touch(batch);
    this.schedule(batch.id);
    return batchView(batch);
  }

  async startAgentJob(batchId: string, jobId: string): Promise<BatchView> {
    const { batch, job } = this.agentJob(batchId, jobId);
    if (job.state !== "queued") throw new Error("该 Codex 任务不是等待状态。");
    job.state = "running"; job.progress = 15; job.startedAt = now(); job.attempt += 1; job.error = undefined;
    await this.touch(batch);
    return batchView(batch);
  }

  async completeAgentJob(batchId: string, jobId: string, imagePath: string): Promise<BatchView> {
    const { batch, job } = this.agentJob(batchId, jobId);
    if (job.state !== "running") throw new Error("请先启动 Codex 任务。");
    job.outputFile = await importImage(path.resolve(imagePath), path.join(batch.outputDirectory, `image-${job.ordinal}`));
    job.state = "succeeded"; job.progress = 100; job.finishedAt = now(); job.billing = "charged"; job.retryable = false;
    await this.touch(batch);
    return batchView(batch);
  }

  async failAgentJob(batchId: string, jobId: string, error: string): Promise<BatchView> {
    const { batch, job } = this.agentJob(batchId, jobId);
    job.state = "failed"; job.progress = 100; job.finishedAt = now(); job.error = error; job.billing = "not_charged"; job.retryable = true;
    await this.touch(batch);
    return batchView(batch);
  }

  private agentJob(batchId: string, jobId: string): { batch: ImageBatch; job: ImageJob } {
    const batch = this.mutable(batchId);
    const job = batch.jobs.find((entry) => entry.id === jobId);
    if (!job) throw new Error("找不到指定任务。");
    if (job.model.adapter !== "agent") throw new Error("该任务不是 Codex 生成任务。");
    return { batch, job };
  }

  async modify(batchId: string, imageIds: string[], instructions: string, modelId?: string, requestKey?: string): Promise<BatchView> {
    const batch = this.mutable(batchId);
    if (requestKey && batch.requestKeys[requestKey]) return batchView(batch);
    const model = modelId ? await this.settings.defaultChoice(modelId) : batch.model;
    const created: string[] = [];
    for (const imageId of imageIds) {
      const current = batch.jobs.find((job) => job.id === imageId);
      if (current?.outputFile) {
        const extension = path.extname(current.outputFile) || ".png";
        const versionNumber = current.versions.length + 1;
        const versionFile = path.join(batch.outputDirectory, `image-${current.ordinal}-version-${versionNumber}${extension}`);
        await copyFile(current.outputFile, versionFile);
        current.versions.push({ id: randomUUID(), label: `${current.label}-${versionNumber}`, file: versionFile, createdAt: now() });
        current.references = [current.outputFile];
        current.prompt = instructions;
        current.model = structuredClone(model);
        current.outputFile = undefined;
        current.state = "queued";
        current.progress = 0;
        current.error = undefined;
        current.retryable = true;
        created.push(current.id);
        continue;
      }
      const version = batch.jobs.flatMap((job) => job.versions).find((entry) => entry.id === imageId);
      const failed = batch.jobs.find((job) => job.id === imageId && job.references.length);
      const reference = version?.file || failed?.references[0];
      if (!reference) throw new Error(`图片 ${imageId} 没有可修改的本地文件。`);
      const job = createJob(batch.jobs.length + 1, instructions, [reference], model);
      batch.jobs.push(job);
      created.push(job.id);
    }
    if (requestKey) batch.requestKeys[requestKey] = created;
    await this.touch(batch);
    this.schedule(batch.id);
    return batchView(batch);
  }

  async cancel(batchId: string, ids?: string[]): Promise<BatchView> {
    const batch = this.mutable(batchId);
    const selected = ids ? new Set(ids) : undefined;
    for (const job of batch.jobs) if (job.state === "queued" && (!selected || selected.has(job.id))) { job.state = "canceled"; job.progress = 100; job.finishedAt = now(); }
    await this.touch(batch);
    return batchView(batch);
  }

  async retry(batchId: string, ids: string[], allowUnknown: boolean): Promise<BatchView> {
    const batch = this.mutable(batchId);
    for (const id of ids) {
      const job = batch.jobs.find((entry) => entry.id === id);
      if (!job || !["failed", "canceled"].includes(job.state)) continue;
      if (job.billing === "unknown" && !allowUnknown) throw new Error("该任务扣费状态未知；确认后才能重试。");
      job.state = "queued"; job.progress = 0; job.error = undefined; job.finishedAt = undefined;
    }
    await this.touch(batch);
    this.schedule(batch.id);
    return batchView(batch);
  }

  async deleteImages(batchId: string, imageIds: string[]): Promise<BatchView> {
    const batch = this.mutable(batchId);
    const ids = new Set(imageIds);
    const keep: ImageJob[] = [];
    for (const job of batch.jobs) {
      if (ids.has(job.id)) {
        if (!terminal.has(job.state)) throw new Error("运行中的图片不能删除。");
        if (job.outputFile && (await fileExists(job.outputFile))) await removeManaged(job.outputFile, batch.outputDirectory);
        for (const version of job.versions) if (await fileExists(version.file)) await removeManaged(version.file, batch.outputDirectory);
        continue;
      }
      const removed = job.versions.filter((version) => ids.has(version.id));
      for (const version of removed) if (await fileExists(version.file)) await removeManaged(version.file, batch.outputDirectory);
      job.versions = job.versions.filter((version) => !ids.has(version.id));
      keep.push(job);
    }
    batch.jobs = keep;
    await this.touch(batch);
    return batchView(batch);
  }

  async merge(targetId: string, sourceIds: string[], deleteSources: boolean, requestKey?: string): Promise<BatchView> {
    const target = this.mutable(targetId);
    if (requestKey && target.requestKeys[requestKey]) return batchView(target);
    const sources = sourceIds.map((id) => this.mutable(id));
    if ([target, ...sources].some((batch) => ["queued", "running"].includes(stateOf(batch)))) throw new Error("只能合并已经结束的批次。");
    const outputJobs = sources.flatMap((batch) => batch.jobs.filter((job) => job.outputFile));
    if (target.jobs.length + outputJobs.length > 50) throw new Error("合并后不能超过 50 张图片。");
    const ids: string[] = [];
    for (const source of outputJobs) {
      const ordinal = target.jobs.length + 1;
      const destination = path.join(target.outputDirectory, `image-${ordinal}${path.extname(source.outputFile!) || ".png"}`);
      await copyFile(source.outputFile!, destination);
      const job = createJob(ordinal, source.prompt, source.references, source.model, source.size, source.quality);
      job.outputFile = destination; job.state = "succeeded"; job.progress = 100; job.finishedAt = now(); job.billing = "charged"; job.retryable = false;
      target.jobs.push(job); ids.push(job.id);
    }
    if (requestKey) target.requestKeys[requestKey] = ids;
    await this.touch(target);
    if (deleteSources) for (const source of sources) await this.delete(source.id);
    return batchView(target);
  }

  async delete(batchId: string): Promise<void> {
    const batch = this.mutable(batchId);
    if (["queued", "running"].includes(stateOf(batch))) throw new Error("运行中的批次不能删除。");
    await Promise.all([
      removeManaged(path.join(this.layout.batchDirectory, `${batchId}.json`), this.layout.batchDirectory),
      batch.outputDirectory.startsWith(`${path.resolve(this.layout.outputDirectory)}${path.sep}`) ? removeManaged(batch.outputDirectory, this.layout.outputDirectory) : Promise.resolve()
    ]);
    this.records.delete(batchId);
    this.revision += 1;
  }

  private mutable(id: string): ImageBatch {
    const batch = this.records.get(id);
    if (!batch) throw new Error("找不到指定的 Code80 Image 批次。");
    return batch;
  }

  private async persist(batch: ImageBatch): Promise<void> {
    const snapshot = structuredClone(batch);
    const previous = this.writes.get(batch.id) || Promise.resolve();
    const pending = previous.catch(() => undefined).then(() => writeJson(path.join(this.layout.batchDirectory, `${batch.id}.json`), snapshot));
    this.writes.set(batch.id, pending);
    try { await pending; }
    finally { if (this.writes.get(batch.id) === pending) this.writes.delete(batch.id); }
  }
  private async touch(batch: ImageBatch): Promise<void> { batch.updatedAt = now(); this.revision += 1; await this.persist(batch); }

  private schedule(batchId: string): void {
    queueMicrotask(() => { void this.pump(batchId); });
  }

  private async pump(batchId: string): Promise<void> {
    const batch = this.records.get(batchId);
    if (!batch) return;
    const running = this.active.get(batchId) || 0;
    const capacity = Math.max(0, batch.model.parallelism - running);
    if (!capacity) return;
    const jobs = batch.jobs.filter((job) => job.state === "queued" && job.model.adapter === "code80").slice(0, capacity);
    for (const job of jobs) {
      this.active.set(batchId, (this.active.get(batchId) || 0) + 1);
      void this.execute(batchId, job.id).finally(() => {
        this.active.set(batchId, Math.max(0, (this.active.get(batchId) || 1) - 1));
        this.schedule(batchId);
      });
    }
  }

  private async execute(batchId: string, jobId: string): Promise<void> {
    const batch = this.mutable(batchId);
    const job = batch.jobs.find((entry) => entry.id === jobId);
    if (!job || job.state !== "queued") return;
    job.state = "running"; job.progress = 12; job.startedAt = now(); job.attempt += 1; job.error = undefined;
    await this.touch(batch);
    try {
      const connection = await this.settings.connection(job.model);
      const client = new Code80Client(connection.endpoint, connection.credential, this.http);
      const result = await client.generate({ model: job.model.model, prompt: job.prompt, references: job.references, size: job.size, quality: job.quality });
      job.outputFile = await persistProviderImage(result, path.join(batch.outputDirectory, `image-${job.ordinal}`), this.http as typeof fetch);
      job.providerRequestId = result.requestId;
      job.state = "succeeded"; job.progress = 100; job.finishedAt = now(); job.billing = "charged"; job.retryable = false;
    } catch (error) {
      const failure = error instanceof Code80HttpError ? error : new Code80HttpError(error instanceof Error ? error.message : String(error), undefined, true, "unknown");
      if (failure.retryable && failure.billing === "not_charged" && job.attempt < 3) {
        job.state = "queued"; job.progress = 0; job.billing = failure.billing; job.error = failure.message; job.providerRequestId = failure.requestId;
      } else {
        job.state = "failed"; job.progress = 100; job.finishedAt = now(); job.billing = failure.billing; job.retryable = failure.retryable; job.error = failure.message; job.providerRequestId = failure.requestId;
      }
    }
    await this.touch(batch);
  }
}
