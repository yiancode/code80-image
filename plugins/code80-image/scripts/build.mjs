import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const project = process.cwd();
const output = path.join(project, "mcp");
const manifest = JSON.parse(await readFile(path.join(project, ".codex-plugin", "plugin.json"), "utf8"));
if (typeof manifest.version !== "string" || !manifest.version) throw new Error("plugin.json requires a version.");
await mkdir(output, { recursive: true });

const browser = await build({
  entryPoints: [path.join(project, "web", "main.tsx")],
  bundle: true,
  minify: true,
  write: false,
  outdir: output,
  platform: "browser",
  format: "esm",
  target: "chrome120",
  legalComments: "inline",
  loader: { ".svg": "dataurl", ".png": "dataurl" }
});
const script = browser.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
const style = browser.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "";
if (!script) throw new Error("Browser bundle was not produced.");
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style></head><body><div id="root"></div><script type="module">${script}</script></body></html>`;
await writeFile(path.join(output, "widget.html"), html, "utf8");
await writeFile(path.join(project, "web", "preview.html"), html, "utf8");

await build({
  entryPoints: [path.join(project, "src", "main.ts")],
  bundle: true,
  minify: false,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: path.join(output, "server.cjs"),
  banner: { js: "#!/usr/bin/env node" },
  define: { __CODE80_IMAGE_VERSION__: JSON.stringify(manifest.version) },
  legalComments: "inline"
});
console.log(`Code80 Image ${manifest.version} built (${Buffer.byteLength(html)} byte UI).`);
