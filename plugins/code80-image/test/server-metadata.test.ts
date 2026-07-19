import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BatchService } from "../src/batches.js";
import { MemoryCredentialVault, initializeLayout, localLayout } from "../src/platform.js";
import { createCode80ImageServer } from "../src/server.js";
import { SettingsService } from "../src/settings.js";

type RegisteredTool = { _meta?: { ui?: { visibility?: string[] } } };
type ToolRegistry = { _registeredTools: Record<string, RegisteredTool> };

test("UI tools remain routable through the Codex Desktop MCP proxy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "code80-server-meta-"));
  const layout = localLayout({ CODE80_IMAGE_HOME: root }, process.platform);
  await initializeLayout(layout);
  const settings = new SettingsService(layout, new MemoryCredentialVault());
  const batches = new BatchService(layout, settings);
  await batches.initialize();

  try {
    const server = createCode80ImageServer({ version: "test", widgetHtml: "", settings, batches }) as unknown as ToolRegistry;
    for (const name of Object.keys(server._registeredTools).filter((name) => name.startsWith("ui_"))) {
      assert.deepEqual(server._registeredTools[name]?._meta?.ui?.visibility, ["model", "app"], `${name} must be reachable by both the UI and Codex proxy`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
