import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderImageResult } from "./domain.js";

const extensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export interface ScannedImage {
  path: string;
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  mimeType: string;
}

export function imageMime(file: string): string {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/png";
}

export async function scanFolder(folder: string, recursive: boolean, limit = 500): Promise<ScannedImage[]> {
  const root = path.resolve(folder);
  const found: ScannedImage[] = [];
  async function walk(current: string): Promise<void> {
    if (found.length >= limit) return;
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const entry of entries) {
      if (found.length >= limit) break;
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && recursive) await walk(full);
      else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        const details = await stat(full);
        found.push({ path: full, name: entry.name, sizeBytes: details.size, modifiedAt: details.mtime.toISOString(), mimeType: imageMime(full) });
      }
    }
  }
  await walk(root);
  return found;
}

export async function asDataUrl(file: string): Promise<string> {
  return `data:${imageMime(file)};base64,${(await readFile(file)).toString("base64")}`;
}

export async function persistProviderImage(result: ProviderImageResult, destinationWithoutExtension: string, http: typeof fetch = fetch): Promise<string> {
  let bytes: Buffer;
  if (result.base64) bytes = Buffer.from(result.base64, "base64");
  else if (result.url) {
    const response = await http(result.url);
    if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）。`);
    bytes = Buffer.from(await response.arrayBuffer());
  } else throw new Error("Provider 没有返回可保存的图片。");
  const extension = result.mimeType.includes("jpeg") ? ".jpg" : result.mimeType.includes("webp") ? ".webp" : ".png";
  const file = `${destinationWithoutExtension}${extension}`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes, { mode: 0o600 });
  return file;
}

export async function importImage(source: string, destinationWithoutExtension: string): Promise<string> {
  const extension = extensions.has(path.extname(source).toLowerCase()) ? path.extname(source).toLowerCase() : ".png";
  const destination = `${destinationWithoutExtension}${extension}`;
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  return destination;
}

export async function imageMetadata(file: string): Promise<{ width?: number; height?: number; sizeBytes: number; mimeType: string }> {
  const bytes = await readFile(file);
  let width: number | undefined;
  let height: number | undefined;
  if (bytes.length >= 24 && bytes.subarray(1, 4).toString("ascii") === "PNG") {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (bytes.length >= 30 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    const kind = bytes.subarray(12, 16).toString("ascii");
    if (kind === "VP8X") {
      width = 1 + bytes.readUIntLE(24, 3);
      height = 1 + bytes.readUIntLE(27, 3);
    }
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let cursor = 2;
    while (cursor + 9 < bytes.length) {
      if (bytes[cursor] !== 0xff) { cursor += 1; continue; }
      const marker = bytes[cursor + 1]!;
      const length = bytes.readUInt16BE(cursor + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        height = bytes.readUInt16BE(cursor + 5);
        width = bytes.readUInt16BE(cursor + 7);
        break;
      }
      cursor += Math.max(2, length + 2);
    }
  }
  return { width, height, sizeBytes: bytes.length, mimeType: imageMime(file) };
}
