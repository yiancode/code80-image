import { readFile } from "node:fs/promises";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BatchService } from "./batches.js";
import { createCredentialVault, initializeLayout, localLayout } from "./platform.js";
import { createCode80ImageServer } from "./server.js";
import { SettingsService } from "./settings.js";

declare const __CODE80_IMAGE_VERSION__: string;
declare const __dirname: string;

const MINIMUM_NODE_MAJOR = 20;

// The bundle lives at <root>/mcp/server.cjs and this source at <root>/src/main.ts,
// so the parent of the containing directory is the plugin root in both layouts.
// Resolving against the host's working directory instead breaks whenever the host
// starts the server elsewhere, killing the process before it can serve any tool.
const pluginRoot = path.dirname(__dirname);

function assertSupportedRuntime(): void {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
  if (Number.isFinite(major) && major >= MINIMUM_NODE_MAJOR) return;
  throw new Error(`Code80 Image 需要 Node ${MINIMUM_NODE_MAJOR} 或更高版本，当前运行的是 ${process.versions.node}。请升级 Node，或把 .mcp.json 里的 command 换成新版 node 的完整路径。`);
}

async function selfTest(): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8")) as { name?: string; version?: string };
  const widget = await readFile(path.join(pluginRoot, "mcp", "widget.html"), "utf8");
  if (manifest.name !== "code80-image") throw new Error("插件清单名称错误。");
  if (manifest.version !== __CODE80_IMAGE_VERSION__) throw new Error("运行时版本与插件清单不一致。");
  if (widget.length < 10_000) throw new Error("插件界面构建产物不完整。");
  process.stdout.write(JSON.stringify({ status: "ok", version: __CODE80_IMAGE_VERSION__, widgetBytes: Buffer.byteLength(widget), platform: process.platform }));
}

async function main(): Promise<void> {
  if (process.argv.includes("--version")) { process.stdout.write(`${__CODE80_IMAGE_VERSION__}\n`); return; }
  assertSupportedRuntime();
  if (process.argv.includes("--self-test")) { await selfTest(); return; }
  const layout = localLayout();
  await initializeLayout(layout);
  const settings = new SettingsService(layout, createCredentialVault(layout));
  const batches = new BatchService(layout, settings);
  await batches.initialize();
  const widgetHtml = await readFile(path.join(pluginRoot, "mcp", "widget.html"), "utf8");
  const server = createCode80ImageServer({ version: __CODE80_IMAGE_VERSION__, widgetHtml, settings, batches });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`Code80 Image ${__CODE80_IMAGE_VERSION__} ready at ${layout.root}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
