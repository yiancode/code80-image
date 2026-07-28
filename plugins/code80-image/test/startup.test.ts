import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("the entry point resolves plugin files from its own directory", async () => {
  const source = await readFile(path.join(root, "src", "main.ts"), "utf8");
  assert(!source.includes("process.cwd()"), "src/main.ts must not resolve plugin files against the host's working directory.");
  assert(source.includes("path.dirname(__dirname)"), "src/main.ts must derive the plugin root from the module directory.");
});

test("the entry point rejects an unsupported Node runtime before serving", async () => {
  const source = await readFile(path.join(root, "src", "main.ts"), "utf8");
  const guard = source.indexOf("assertSupportedRuntime()");
  const construction = source.indexOf("new BatchService(");
  assert(guard >= 0, "src/main.ts must check the Node version.");
  assert(guard < construction, "the version check must run before any service that depends on a modern runtime.");
});

test("the compiled server carries both startup fixes", async () => {
  const bundle = await readFile(path.join(root, "mcp", "server.cjs"), "utf8");
  assert(bundle.includes("assertSupportedRuntime"), "mcp/server.cjs is stale: rebuild it with npm run build.");
  assert(!bundle.includes("process.cwd()"), "mcp/server.cjs still resolves paths against the working directory.");
});
