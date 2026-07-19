import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BatchService } from "../src/batches.js";
import { code80Catalog } from "../src/catalog.js";
import { AGENT_MODEL_ID, type ImageBatch } from "../src/domain.js";
import { initializeLayout, localLayout, MemoryCredentialVault, readJson } from "../src/platform.js";
import { SettingsService } from "../src/settings.js";

async function fixture(parallelism = 2) {
  const root = await mkdtemp(path.join(os.tmpdir(), "code80-batches-"));
  const layout = localLayout({ CODE80_IMAGE_HOME: root }, process.platform);
  await initializeLayout(layout);
  const settings = new SettingsService(layout, new MemoryCredentialVault());
  const group = await settings.saveGroup({ name: "默认", endpoint: "https://code80.ai", parallelism, credential: "secret", models: [code80Catalog()[0]!] });
  await settings.setDefault(group.models[0]!.id);
  return { root, layout, settings, modelId: group.models[0]!.id };
}

async function waitFor(check: () => boolean | Promise<boolean>, timeout = 2500): Promise<void> {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeout) throw new Error("Timed out waiting for batch state.");
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

test("provider batches obey group parallelism and persist unique files", async () => {
  const context = await fixture(2);
  let active = 0;
  let peak = 0;
  const service = new BatchService(context.layout, context.settings, async () => {
    active += 1; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 35));
    active -= 1;
    return Response.json({ data: [{ b64_json: Buffer.from("image").toString("base64"), mime_type: "image/png" }] });
  });
  await service.initialize();
  try {
    const created = await service.create({ prompt: "three views", count: 3 });
    await waitFor(() => service.get(created.id).state === "completed");
    await service.waitForIdle(created.id);
    const done = service.get(created.id);
    assert.equal(peak, 2);
    assert.equal(done.succeeded, 3);
    assert.equal(new Set(done.jobs.map((job) => job.outputFile)).size, 3);
    const batchFile = path.join(context.layout.batchDirectory, `${created.id}.json`);
    await waitFor(async () => {
      const persisted = await readJson<ImageBatch | undefined>(batchFile, undefined);
      return persisted?.jobs.filter((job) => job.state === "succeeded").length === 3;
    });
    const reloaded = new BatchService(context.layout, context.settings);
    await reloaded.initialize();
    assert.equal(reloaded.get(created.id).succeeded, 3);
  } finally { await rm(context.root, { recursive: true, force: true }); }
});

test("Codex jobs round-trip through explicit start and completion", async () => {
  const context = await fixture();
  const service = new BatchService(context.layout, context.settings);
  await service.initialize();
  try {
    const source = path.join(context.root, "agent.png");
    await writeFile(source, Buffer.from("agent-image"));
    const created = await service.create({ modelId: AGENT_MODEL_ID, prompt: "agent prompt", count: 1 });
    const job = created.jobs[0]!;
    assert.equal(job.state, "queued");
    assert.equal((await service.startAgentJob(created.id, job.id)).jobs[0]!.state, "running");
    const completed = await service.completeAgentJob(created.id, job.id, source);
    assert.equal(completed.state, "completed");
    assert(completed.jobs[0]!.outputFile?.startsWith(completed.outputDirectory));
  } finally { await rm(context.root, { recursive: true, force: true }); }
});

test("append and in-place modification preserve old image versions", async () => {
  const context = await fixture();
  const service = new BatchService(context.layout, context.settings, async () => Response.json({ data: [{ b64_json: Buffer.from(`image-${Date.now()}`).toString("base64"), mime_type: "image/png" }] }));
  await service.initialize();
  try {
    const created = await service.create({ prompt: "first", count: 1 });
    await waitFor(() => service.get(created.id).state === "completed");
    const original = service.get(created.id).jobs[0]!;
    await service.modify(created.id, [original.id], "make it white");
    await waitFor(() => service.get(created.id).state === "completed");
    assert.equal(service.get(created.id).jobs[0]!.versions[0]!.label, "图1-1");
    const appended = await service.append(created.id, [{ prompt: "second" }]);
    assert.equal(appended.total, 2);
    await waitFor(() => service.get(created.id).state === "completed");
    await service.waitForIdle(created.id);
  } finally { await rm(context.root, { recursive: true, force: true }); }
});
