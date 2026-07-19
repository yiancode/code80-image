import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scratch = await mkdtemp(path.join(os.tmpdir(), "code80-image-smoke-"));
const client = new Client({ name: "code80-image-smoke", version: "1" });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(process.cwd(), "mcp", "server.cjs")], env: { ...process.env, CODE80_IMAGE_HOME: scratch } });
try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = new Set(listed.tools.map((tool) => tool.name));
  for (const required of ["open_code80_image", "create_image_batch", "append_image_jobs", "modify_selected_images", "ui_save_provider_profile"]) {
    if (!names.has(required)) throw new Error(`Missing MCP tool: ${required}`);
  }
  const opened = await client.callTool({ name: "open_code80_image", arguments: { tab: "settings" } });
  if (opened.isError || !opened.structuredContent) throw new Error("Workbench tool did not return structured content.");
  const resource = await client.readResource({ uri: "ui://code80-image/workbench.html" });
  const html = resource.contents.find((item) => "text" in item)?.text || "";
  if (html.length < 10_000) throw new Error("Workbench resource is incomplete.");
  console.log(JSON.stringify({ status: "ok", tools: listed.tools.length, widgetBytes: html.length }));
} finally {
  await client.close().catch(() => undefined);
  await rm(scratch, { recursive: true, force: true });
}
