import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function files(folder: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (["node_modules", "mcp"].includes(entry.name) || entry.name === "preview.html" || entry.name === "package-lock.json") continue;
    const target = path.join(folder, entry.name);
    if (entry.isDirectory()) output.push(...await files(target));
    else output.push(target);
  }
  return output;
}

test("release sources contain no retired upstream names or license paths", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const candidates = await files(root);
  const forbidden = ["cmVub2lyMTIyMA==", "dGhpcmRfcGFydHkvZXNzZQ==", "bGljZW5zZS5lcy1zZQ=="].map((value) => Buffer.from(value, "base64").toString("utf8"));
  for (const file of candidates) {
    if (file === import.meta.filename) continue;
    const content = (await readFile(file, "utf8")).toLowerCase();
    for (const term of forbidden) assert(!content.includes(term), `${term} remains in ${path.relative(root, file)}`);
  }
});
