import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const groups = new Map();

for (const [location, metadata] of Object.entries(lock.packages || {})) {
  if (!location.startsWith("node_modules/") || metadata.dev) continue;
  const packageName = location.slice("node_modules/".length);
  const folder = path.join(root, location);
  const candidates = (await readdir(folder).catch(() => [])).filter((name) => /^(license|licence|copying)(\.|$)/i.test(name));
  const licenseFile = candidates[0];
  const licenseText = licenseFile ? (await readFile(path.join(folder, licenseFile), "utf8")).trim() : `License identifier: ${metadata.license || "UNKNOWN"}`;
  const hash = createHash("sha256").update(licenseText).digest("hex");
  const group = groups.get(hash) || { licenseText, packages: [] };
  group.packages.push(`${packageName}@${metadata.version || "unknown"} (${metadata.license || "UNKNOWN"})`);
  groups.set(hash, group);
}

const sections = [...groups.values()]
  .sort((a, b) => a.packages[0].localeCompare(b.packages[0]))
  .map((group) => `## ${group.packages.join(", ")}\n\n${group.licenseText}\n`);
const notice = `# Third-party notices\n\nCode80 Image bundles the open-source packages listed below. Their licenses and copyright notices are reproduced as supplied by their package distributions. Product and model names mentioned by the plugin remain the property of their respective owners.\n\n${sections.join("\n---\n\n")}`;
await writeFile(path.join(root, "THIRD_PARTY_NOTICES.md"), notice, "utf8");
console.log(`Wrote ${groups.size} license groups covering ${[...groups.values()].reduce((total, group) => total + group.packages.length, 0)} packages.`);
