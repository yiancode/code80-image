import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import type { BatchView, ImageJob, ModelDefinition } from "./domain.js";
import { AGENT_MODEL_ID } from "./domain.js";
import { asDataUrl, imageMetadata, scanFolder } from "./image-io.js";
import { openDirectory } from "./platform.js";
import type { BatchService } from "./batches.js";
import type { SettingsService } from "./settings.js";
import { Code80Client } from "./code80-client.js";

const execute = promisify(execFile);
const VIEW_URI = "ui://code80-image/workbench.html";

type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown>; isError?: boolean };

const modelSchema = z.object({
  id: z.string().optional().default(""),
  model: z.string().min(1),
  label: z.string().min(1),
  sizes: z.array(z.string()).default([]),
  qualities: z.array(z.string()).default([]),
  canGenerate: z.boolean().default(true),
  canEdit: z.boolean().default(true),
  price: z.object({ mode: z.enum(["per_request", "token", "model_quota", "unknown"]).default("unknown"), currency: z.string().default("CNY"), amount: z.number().optional(), note: z.string().optional() }).default({ mode: "unknown", currency: "CNY" })
});

const imageReferenceSchema = z.object({ batchId: z.string().min(1), imageId: z.string().min(1).optional(), image: z.string().min(1).optional() });

function text(message: string, structuredContent?: Record<string, unknown>, meta?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: message }], structuredContent, _meta: meta };
}

function batchResult(batch: BatchView, message = "Code80 Image 批次已更新。"): ToolResult {
  return text(message, { batch, agentJobs: batch.jobs.filter((job) => job.model.adapter === "agent" && ["queued", "running"].includes(job.state)) });
}

function viewMeta(): Record<string, unknown> {
  return { ui: { resourceUri: VIEW_URI, visibility: ["model", "app"] }, "openai/outputTemplate": VIEW_URI };
}

function appMeta(visibility: Array<"model" | "app"> = ["model", "app"]): Record<string, unknown> {
  return { ui: { visibility } };
}

function appProxyMeta(): Record<string, unknown> {
  // Codex Desktop currently discovers the App proxy's callable tools from the
  // model-visible list. Keeping "app" visibility preserves UI access while
  // "model" visibility makes those calls routable in affected Desktop builds.
  return appMeta();
}

function resolveImage(batch: BatchView, imageId: string): { file: string; label: string } {
  const job = batch.jobs.find((entry) => entry.id === imageId);
  if (job?.outputFile) return { file: job.outputFile, label: job.label };
  const version = batch.jobs.flatMap((entry) => entry.versions).find((entry) => entry.id === imageId);
  if (version) return { file: version.file, label: version.label };
  const failed = batch.jobs.find((entry) => entry.id === imageId && entry.references.length);
  if (failed) return { file: failed.references[0]!, label: failed.label };
  throw new Error("找不到该图片的本地文件。");
}

function resolveReferences(batches: BatchService, references: Array<z.infer<typeof imageReferenceSchema>> = []): string[] {
  return references.map((reference) => {
    const batch = batches.get(reference.batchId);
    const imageId = reference.imageId || batch.jobs.find((job) => job.label === reference.image)?.id || batch.jobs.flatMap((job) => job.versions).find((item) => item.label === reference.image)?.id;
    if (!imageId) throw new Error(`批次 ${reference.batchId} 中没有找到图片 ${reference.image || ""}。`);
    return resolveImage(batch, imageId).file;
  });
}

async function workbenchState(settings: SettingsService, batches: BatchService, tab: "batches" | "settings", batchId?: string): Promise<Record<string, unknown>> {
  const [document, groups, choices, suggestion] = await Promise.all([settings.load(), settings.groups(), settings.choices(), settings.suggestedGroup()]);
  const activeBatch = batchId ? batches.get(batchId) : batches.list(1)[0];
  return {
    view: { tab, batchId: activeBatch?.id },
    groups,
    choices,
    defaultModelId: document.defaultModelId,
    batches: batches.list(12),
    activeBatch,
    activation: batches.activation(),
    suggestion,
    secureStorage: settings.vault.label,
    platform: process.platform
  };
}

async function saveAs(source: string, label: string): Promise<string | undefined> {
  if (process.platform === "darwin") {
    const defaultName = `${label}${path.extname(source) || ".png"}`.replace(/[\/:]/g, "-");
    const script = `set chosenFile to choose file name with prompt "保存 Code80 Image 图片" default name ${JSON.stringify(defaultName)}\nreturn POSIX path of chosenFile`;
    try {
      const { stdout } = await execute("osascript", ["-e", script], { encoding: "utf8" });
      const destination = stdout.trim();
      if (!destination) return undefined;
      await mkdir(path.dirname(destination), { recursive: true });
      await import("node:fs/promises").then(({ copyFile }) => copyFile(source, destination));
      return destination;
    } catch { return undefined; }
  }
  return undefined;
}

async function copyToClipboard(source: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("当前版本仅在 macOS 支持图片剪贴板。");
  const folder = await mkdtemp(path.join(os.tmpdir(), "code80-image-clipboard-"));
  const png = path.join(folder, "clipboard.png");
  try {
    await execute("sips", ["-s", "format", "png", source, "--out", png]);
    await execute("osascript", ["-e", `set the clipboard to (read POSIX file ${JSON.stringify(png)} as «class PNGf»)`]);
  } finally { await rm(folder, { recursive: true, force: true }); }
}

export function createCode80ImageServer(options: {
  version: string;
  widgetHtml: string;
  settings: SettingsService;
  batches: BatchService;
}): McpServer {
  const server = new McpServer({ name: "code80-image", version: options.version }, { capabilities: { resources: {}, tools: {} } });

  registerAppResource(server, "Code80 Image Workbench", VIEW_URI, { description: "Code80 本地批量生图工作台" }, async () => ({
    contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: options.widgetHtml, _meta: { ui: { prefersBorder: false } } }]
  }));

  registerAppTool(server, "open_code80_image", {
    title: "Open Code80 Image",
    description: "打开 Code80 Image 的任务、图库和设置工作台。",
    inputSchema: { tab: z.enum(["batches", "settings"]).default("batches"), batchId: z.string().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    _meta: viewMeta()
  }, async ({ tab, batchId }) => text("Code80 Image 已打开。", await workbenchState(options.settings, options.batches, tab, batchId)));

  registerAppTool(server, "list_image_offerings", {
    title: "List Code80 image models",
    description: "列出已经配置的 Code80 分组模型和 Codex 生成。",
    inputSchema: {}, annotations: { readOnlyHint: true }, _meta: appMeta()
  }, async () => {
    const choices = await options.settings.choices();
    return text(`已配置 ${choices.length} 个生图选项。`, { offerings: choices });
  });

  registerAppTool(server, "inspect_image_folder", {
    title: "Inspect image folder",
    description: "检查本机目录中的图片，并把选定分页的图片提供给当前 Agent 理解。",
    inputSchema: { folderPath: z.string().min(1), recursive: z.boolean().default(false), page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(12).default(8) },
    annotations: { readOnlyHint: true, openWorldHint: false }, _meta: appMeta()
  }, async ({ folderPath, recursive, page, pageSize }) => {
    const files = await scanFolder(folderPath, recursive, 500);
    const start = (page - 1) * pageSize;
    const shown = files.slice(start, start + pageSize);
    const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [{ type: "text", text: `目录 ${path.resolve(folderPath)}，共发现 ${files.length} 张图片。` }];
    for (const [index, file] of shown.entries()) {
      content.push({ type: "text", text: `图片 ${start + index + 1}: ${file.path}` });
      const dataUrl = await asDataUrl(file.path);
      const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl)!;
      content.push({ type: "image", mimeType: match[1]!, data: match[2]! });
    }
    return { content, structuredContent: { folderPath: path.resolve(folderPath), files: shown, page, pageSize, total: files.length, hasMore: start + shown.length < files.length } };
  });

  registerAppTool(server, "create_image_batch", {
    title: "Create image batch",
    description: "使用默认或指定的 Code80/Codex 模型创建 1–50 个持久化并行任务。",
    inputSchema: {
      title: z.string().max(120).optional(), offeringId: z.string().optional(), prompt: z.string().max(5000).optional(),
      folderPath: z.string().optional(), recursive: z.boolean().default(false), imagePaths: z.array(z.string()).max(50).optional(),
      referenceImagePaths: z.array(z.string()).max(20).optional(), referenceImages: z.array(imageReferenceSchema).max(20).optional(),
      jobs: z.array(z.object({ prompt: z.string().min(1).max(5000), referenceImagePaths: z.array(z.string()).max(20).default([]), referenceImages: z.array(imageReferenceSchema).max(20).default([]) })).min(1).max(50).optional(),
      outputDirectory: z.string().optional(), count: z.number().int().min(1).max(50).optional(), size: z.string().optional(), quality: z.string().optional(), requestKey: z.string().max(200).optional()
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false }, _meta: appMeta()
  }, async (input) => {
    const shared = [...(input.referenceImagePaths || []), ...resolveReferences(options.batches, input.referenceImages)];
    const jobs = input.jobs?.map((job) => ({ prompt: job.prompt, references: [...job.referenceImagePaths, ...resolveReferences(options.batches, job.referenceImages)] }));
    const batch = await options.batches.create({ title: input.title, modelId: input.offeringId, prompt: input.prompt, jobs, imagePaths: input.imagePaths, folderPath: input.folderPath, recursive: input.recursive, sharedReferences: shared, count: input.count, size: input.size, quality: input.quality, outputDirectory: input.outputDirectory, requestKey: input.requestKey });
    return batchResult(batch, batch.model.adapter === "agent" ? "Codex 生成任务已建立，请逐项启动并回传结果。" : `已创建 ${batch.total} 个 Code80 生图任务。`);
  });

  registerAppTool(server, "append_image_jobs", {
    title: "Append image jobs",
    description: "向现有批次追加新的独立任务，或从失败任务重建。",
    inputSchema: { batchId: z.string().min(1), offeringId: z.string().optional(), jobs: z.array(z.object({ prompt: z.string().min(1).max(5000), sourceJobId: z.string().optional(), referenceImagePaths: z.array(z.string()).max(20).default([]), referenceImages: z.array(imageReferenceSchema).max(20).default([]) })).min(1).max(50), requestKey: z.string().max(200).optional() },
    annotations: { readOnlyHint: false, openWorldHint: true }, _meta: appMeta()
  }, async (input) => batchResult(await options.batches.append(input.batchId, input.jobs.map((job) => ({ prompt: job.prompt, sourceJobId: job.sourceJobId, references: [...job.referenceImagePaths, ...resolveReferences(options.batches, job.referenceImages)] })), input.offeringId, input.requestKey)));

  registerAppTool(server, "start_agent_image_job", {
    title: "Start Codex image job", description: "启动一个 Codex 生成任务并返回准确 Prompt 和本地参考图。",
    inputSchema: { batchId: z.string().min(1), jobId: z.string().min(1) }, annotations: { readOnlyHint: false }, _meta: appMeta()
  }, async ({ batchId, jobId }) => {
    const batch = await options.batches.startAgentJob(batchId, jobId);
    const job = batch.jobs.find((entry) => entry.id === jobId)!;
    return text(`${job.label} 已启动。`, { batch, job, prompt: job.prompt, referenceImagePaths: job.references });
  });

  registerAppTool(server, "complete_agent_image_job", {
    title: "Complete Codex image job", description: "把当前 Agent 生成的真实本地图片导入任务。",
    inputSchema: { batchId: z.string().min(1), jobId: z.string().min(1), imagePath: z.string().min(1) }, annotations: { readOnlyHint: false }, _meta: appMeta()
  }, async ({ batchId, jobId, imagePath }) => batchResult(await options.batches.completeAgentJob(batchId, jobId, imagePath)));

  registerAppTool(server, "fail_agent_image_job", {
    title: "Fail Codex image job", description: "记录 Codex 生成任务的真实失败原因。",
    inputSchema: { batchId: z.string().min(1), jobId: z.string().min(1), error: z.string().min(1).max(2000) }, annotations: { readOnlyHint: false }, _meta: appMeta()
  }, async ({ batchId, jobId, error }) => batchResult(await options.batches.failAgentJob(batchId, jobId, error)));

  registerAppTool(server, "list_image_batches", {
    title: "List image batches", description: "列出最近批次及其稳定的图片 ID。",
    inputSchema: { limit: z.number().int().min(1).max(50).default(10) }, annotations: { readOnlyHint: true }, _meta: appMeta()
  }, async ({ limit }) => {
    const batches = options.batches.list(limit);
    return text(batches.length ? batches.map((batch) => `${batch.title} (${batch.id}): ${batch.jobs.map((job) => `${job.label}=${job.id}[${job.state}]`).join(", ")}`).join("\n") : "暂无本地批次。", { batches });
  });

  for (const name of ["get_image_batch", "render_image_batch"] as const) {
    registerAppTool(server, name, {
      title: name === "get_image_batch" ? "Get image batch" : "Render image batch", description: "返回指定本地图片批次。",
      inputSchema: { batchId: z.string().min(1) }, annotations: { readOnlyHint: true }, _meta: appMeta()
    }, async ({ batchId }) => batchResult(options.batches.get(batchId)));
  }

  registerAppTool(server, "modify_selected_images", {
    title: "Modify selected images", description: "在原批次中修改准确的图片 ID，并保留旧版本。",
    inputSchema: { batchId: z.string().min(1), imageIds: z.array(z.string()).min(1).max(50).optional(), jobIds: z.array(z.string()).min(1).max(50).optional(), instructions: z.string().min(1).max(5000), offeringId: z.string().optional(), requestKey: z.string().max(200).optional() },
    annotations: { readOnlyHint: false, openWorldHint: true }, _meta: appMeta()
  }, async (input) => {
    const ids = input.imageIds || input.jobIds;
    if (!ids?.length) throw new Error("请选择至少一张图片。");
    return batchResult(await options.batches.modify(input.batchId, ids, input.instructions, input.offeringId, input.requestKey));
  });

  registerAppTool(server, "delete_code80_images", {
    title: "Delete images", description: "删除指定批次中准确的图片或版本 ID。",
    inputSchema: { batchId: z.string().min(1), imageIds: z.array(z.string()).min(1).max(50) }, annotations: { destructiveHint: true }, _meta: appMeta()
  }, async ({ batchId, imageIds }) => batchResult(await options.batches.deleteImages(batchId, imageIds)));

  registerAppTool(server, "merge_image_batches", {
    title: "Merge image batches", description: "把已结束的源批次图片复制到目标批次。",
    inputSchema: { targetBatchId: z.string().min(1), sourceBatchIds: z.array(z.string()).min(1).max(50), deleteSourceBatches: z.boolean().default(false), requestKey: z.string().optional() }, annotations: { destructiveHint: true }, _meta: appMeta()
  }, async (input) => batchResult(await options.batches.merge(input.targetBatchId, input.sourceBatchIds, input.deleteSourceBatches, input.requestKey)));

  registerUiTools(server, options);
  return server;
}

function registerUiTools(server: McpServer, options: { version: string; settings: SettingsService; batches: BatchService }): void {
  registerAppTool(server, "ui_get_local_state", {
    title: "Refresh workbench", description: "仅供 Code80 Image 界面刷新。", inputSchema: { batchId: z.string().optional(), tab: z.enum(["batches", "settings"]).default("batches") }, annotations: { readOnlyHint: true }, _meta: appProxyMeta()
  }, async ({ batchId, tab }) => text("工作台状态已刷新。", await workbenchState(options.settings, options.batches, tab, batchId)));

  registerAppTool(server, "ui_get_batch_state", {
    title: "Refresh batch", description: "仅供界面刷新一个批次。", inputSchema: { batchId: z.string().min(1) }, annotations: { readOnlyHint: true }, _meta: appProxyMeta()
  }, async ({ batchId }) => batchResult(options.batches.get(batchId)));

  registerAppTool(server, "ui_list_image_batches", {
    title: "Browse batches", description: "仅供界面分页浏览批次。", inputSchema: { page: z.number().int().min(1).default(1), pageSize: z.number().int().min(4).max(20).default(8) }, annotations: { readOnlyHint: true }, _meta: appProxyMeta()
  }, async ({ page, pageSize }) => text("批次列表已加载。", options.batches.listPage(page, pageSize)));

  registerAppTool(server, "ui_save_provider_profile", {
    title: "Save Code80 group", description: "保存一个拥有独立 API Key 的 Code80 分组。密钥不会返回给界面或模型。",
    inputSchema: { id: z.string().optional(), name: z.string().min(1).max(100), endpoint: z.string().url(), parallelism: z.number().int().min(1).max(12), credential: z.string().max(1000).optional(), models: z.array(modelSchema).min(1).max(50) },
    annotations: { readOnlyHint: false }, _meta: appProxyMeta()
  }, async (input) => {
    await options.settings.saveGroup({ ...input, models: input.models as ModelDefinition[] });
    return text("Code80 分组已保存。", await workbenchState(options.settings, options.batches, "settings"));
  });

  registerAppTool(server, "ui_delete_provider_profile", {
    title: "Delete Code80 group", description: "删除 Code80 分组及其独立密钥。", inputSchema: { id: z.string().min(1) }, annotations: { destructiveHint: true }, _meta: appProxyMeta()
  }, async ({ id }) => { await options.settings.deleteGroup(id); return text("分组已删除。", await workbenchState(options.settings, options.batches, "settings")); });

  registerAppTool(server, "ui_test_provider_profile", {
    title: "Test Code80 group", description: "测试 Code80 地址和分组密钥，并读取可用模型。",
    inputSchema: { endpoint: z.string().url(), groupId: z.string().optional(), credential: z.string().max(1000).optional() }, annotations: { readOnlyHint: true, openWorldHint: true }, _meta: appProxyMeta()
  }, async ({ endpoint, groupId, credential }) => {
    const key = credential?.trim() || (groupId ? await options.settings.vault.get(groupId) : undefined);
    if (!key) throw new Error("请输入 API Key，或先保存该分组密钥。");
    const models = await new Code80Client(endpoint.replace(/\/+$/, ""), key).models();
    return text(`连接成功，发现 ${models.length} 个模型。`, { ok: true, models });
  });

  registerAppTool(server, "ui_set_default_offering", {
    title: "Set default model", description: "设置默认生图模型。", inputSchema: { offeringId: z.string().min(1) }, annotations: { readOnlyHint: false }, _meta: appProxyMeta()
  }, async ({ offeringId }) => { await options.settings.setDefault(offeringId); return text("默认模型已更新。", await workbenchState(options.settings, options.batches, "settings")); });

  registerAppTool(server, "ui_get_image_previews", {
    title: "Load image previews", description: "把本地图片预览仅返回给插件界面。",
    inputSchema: { batchId: z.string().min(1), items: z.array(z.object({ jobId: z.string().min(1), full: z.boolean().default(false) })).min(1).max(16) }, annotations: { readOnlyHint: true }, _meta: appProxyMeta()
  }, async ({ batchId, items }) => {
    const batch = options.batches.get(batchId);
    const previews = await Promise.all(items.map(async ({ jobId }) => {
      try { const image = resolveImage(batch, jobId); return { jobId, dataUrl: await asDataUrl(image.file) }; }
      catch (error) { return { jobId, error: error instanceof Error ? error.message : String(error) }; }
    }));
    return text("图片预览已加载。", { batchId, available: previews.filter((item) => item.dataUrl).length }, { previews });
  });

  registerAppTool(server, "ui_get_image_preview", {
    title: "Load image preview", description: "把单张本地图片预览仅返回给插件界面。",
    inputSchema: { batchId: z.string().min(1), jobId: z.string().min(1), full: z.boolean().default(false) }, annotations: { readOnlyHint: true }, _meta: appProxyMeta()
  }, async ({ batchId, jobId }) => {
    const image = resolveImage(options.batches.get(batchId), jobId);
    return text("图片预览已加载。", { batchId, jobId, available: true }, { dataUrl: await asDataUrl(image.file) });
  });

  registerAppTool(server, "ui_get_image_metadata", {
    title: "Read image metadata", description: "读取本地图片尺寸与文件大小。",
    inputSchema: { batchId: z.string().min(1), jobId: z.string().min(1) }, annotations: { readOnlyHint: true }, _meta: appProxyMeta()
  }, async ({ batchId, jobId }) => {
    const image = resolveImage(options.batches.get(batchId), jobId);
    return text("图片信息已读取。", { batchId, jobId, available: true, ...(await imageMetadata(image.file)) });
  });

  registerAppTool(server, "ui_open_batch_folder", {
    title: "Open output folder", description: "在系统文件管理器中打开批次目录。", inputSchema: { batchId: z.string().min(1) }, annotations: { readOnlyHint: true }, _meta: appProxyMeta()
  }, async ({ batchId }) => { const folder = options.batches.get(batchId).outputDirectory; await openDirectory(folder); return text("输出目录已打开。", { opened: true, path: folder }); });

  registerAppTool(server, "ui_save_image_as", {
    title: "Save image as", description: "使用系统保存对话框复制图片。", inputSchema: { batchId: z.string().min(1), jobId: z.string().min(1) }, annotations: { readOnlyHint: false }, _meta: appProxyMeta()
  }, async ({ batchId, jobId }) => { const image = resolveImage(options.batches.get(batchId), jobId); const destination = await saveAs(image.file, image.label); return text(destination ? `已保存到 ${destination}` : "已取消保存。", { saved: Boolean(destination), canceled: !destination, path: destination }); });

  registerAppTool(server, "ui_copy_image_to_clipboard", {
    title: "Copy image", description: "把本地图片复制到系统剪贴板。", inputSchema: { batchId: z.string().min(1), jobId: z.string().min(1) }, annotations: { readOnlyHint: false }, _meta: appProxyMeta()
  }, async ({ batchId, jobId }) => { await copyToClipboard(resolveImage(options.batches.get(batchId), jobId).file); return text("图片已复制。", { copied: true }); });

  registerAppTool(server, "ui_cancel_queued_jobs", {
    title: "Cancel queued jobs", description: "取消尚未发送的任务。", inputSchema: { batchId: z.string().min(1), jobIds: z.array(z.string()).max(50).optional() }, annotations: { readOnlyHint: false }, _meta: appProxyMeta()
  }, async ({ batchId, jobIds }) => batchResult(await options.batches.cancel(batchId, jobIds)));

  registerAppTool(server, "ui_retry_jobs", {
    title: "Retry jobs", description: "重试失败或取消的任务。", inputSchema: { batchId: z.string().min(1), jobIds: z.array(z.string()).min(1).max(50), allowUnknownCharge: z.boolean().default(false) }, annotations: { readOnlyHint: false, openWorldHint: true }, _meta: appProxyMeta()
  }, async ({ batchId, jobIds, allowUnknownCharge }) => batchResult(await options.batches.retry(batchId, jobIds, allowUnknownCharge)));

  registerAppTool(server, "ui_delete_code80_images", {
    title: "Delete images", description: "删除准确的图片 ID。", inputSchema: { batchId: z.string().min(1), imageIds: z.array(z.string()).min(1).max(50) }, annotations: { destructiveHint: true }, _meta: appProxyMeta()
  }, async ({ batchId, imageIds }) => batchResult(await options.batches.deleteImages(batchId, imageIds)));

  registerAppTool(server, "ui_delete_image_batch", {
    title: "Delete batch", description: "删除已经结束的本地批次。", inputSchema: { batchId: z.string().min(1) }, annotations: { destructiveHint: true }, _meta: appProxyMeta()
  }, async ({ batchId }) => { await options.batches.delete(batchId); return text("批次已删除。", await workbenchState(options.settings, options.batches, "batches")); });

  registerAppTool(server, "ui_check_for_updates", {
    title: "Check updates", description: "返回当前插件版本。", inputSchema: {}, annotations: { readOnlyHint: true }, _meta: appProxyMeta()
  }, async () => text("版本信息已读取。", { update: { currentVersion: options.version, latestVersion: options.version, updateAvailable: false, checked: true, checkedAt: new Date().toISOString(), releaseUrl: "https://github.com/yiancode/code80-image/releases" } }));
}
