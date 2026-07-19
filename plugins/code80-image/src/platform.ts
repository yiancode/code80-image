import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, chmod, copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface LocalLayout {
  root: string;
  settingsFile: string;
  credentialsFile: string;
  batchDirectory: string;
  outputDirectory: string;
}

export function localLayout(environment = process.env, platform = process.platform): LocalLayout {
  const override = environment.CODE80_IMAGE_HOME?.trim();
  let root: string;
  if (override) root = path.resolve(override);
  else if (platform === "darwin") root = path.join(os.homedir(), "Library", "Application Support", "Code80 Image");
  else if (platform === "win32") root = path.join(environment.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Code80 Image");
  else root = path.join(environment.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "code80-image");
  return {
    root,
    settingsFile: path.join(root, "settings.json"),
    credentialsFile: path.join(root, "credentials.json"),
    batchDirectory: path.join(root, "batches"),
    outputDirectory: path.join(root, "outputs")
  };
}

export async function initializeLayout(layout: LocalLayout): Promise<void> {
  await Promise.all([
    mkdir(layout.root, { recursive: true }),
    mkdir(layout.batchDirectory, { recursive: true }),
    mkdir(layout.outputDirectory, { recursive: true })
  ]);
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
  await chmod(file, 0o600).catch(() => undefined);
}

export interface CredentialVault {
  get(groupId: string): Promise<string | undefined>;
  set(groupId: string, value: string): Promise<void>;
  remove(groupId: string): Promise<void>;
  has(groupId: string): Promise<boolean>;
  readonly label: string;
}

export class MemoryCredentialVault implements CredentialVault {
  readonly label = "Memory";
  private values = new Map<string, string>();
  async get(groupId: string): Promise<string | undefined> { return this.values.get(groupId); }
  async set(groupId: string, value: string): Promise<void> { this.values.set(groupId, value); }
  async remove(groupId: string): Promise<void> { this.values.delete(groupId); }
  async has(groupId: string): Promise<boolean> { return this.values.has(groupId); }
}

class FileCredentialVault implements CredentialVault {
  readonly label = "本机加密文件权限";
  constructor(private file: string) {}
  private async all(): Promise<Record<string, string>> { return readJson(this.file, {}); }
  async get(groupId: string): Promise<string | undefined> { return (await this.all())[groupId]; }
  async has(groupId: string): Promise<boolean> { return Boolean(await this.get(groupId)); }
  async set(groupId: string, value: string): Promise<void> {
    const values = await this.all();
    values[groupId] = value;
    await writeJson(this.file, values);
  }
  async remove(groupId: string): Promise<void> {
    const values = await this.all();
    delete values[groupId];
    await writeJson(this.file, values);
  }
}

class MacCredentialVault implements CredentialVault {
  readonly label = "macOS Keychain";
  private service = "ai.code80.image";
  async get(groupId: string): Promise<string | undefined> {
    try {
      const result = await run("security", ["find-generic-password", "-s", this.service, "-a", groupId, "-w"], { encoding: "utf8" });
      return result.stdout.trim() || undefined;
    } catch { return undefined; }
  }
  async has(groupId: string): Promise<boolean> { return Boolean(await this.get(groupId)); }
  async set(groupId: string, value: string): Promise<void> {
    await run("security", ["add-generic-password", "-U", "-s", this.service, "-a", groupId, "-w", value]);
  }
  async remove(groupId: string): Promise<void> {
    await run("security", ["delete-generic-password", "-s", this.service, "-a", groupId]).catch(() => undefined);
  }
}

export function createCredentialVault(layout: LocalLayout, platform = process.platform): CredentialVault {
  return platform === "darwin" ? new MacCredentialVault() : new FileCredentialVault(layout.credentialsFile);
}

export async function copyInto(source: string, destination: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

export async function removeManaged(target: string, allowedRoot: string): Promise<void> {
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = `${path.resolve(allowedRoot)}${path.sep}`;
  if (!resolvedTarget.startsWith(resolvedRoot)) throw new Error("拒绝删除 Code80 Image 数据目录之外的文件。");
  await rm(resolvedTarget, { recursive: true, force: true });
}

export async function fileExists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

export async function openDirectory(folder: string): Promise<void> {
  if (process.platform === "darwin") await run("open", [folder]);
  else if (process.platform === "win32") await run("explorer.exe", [folder]);
  else await run("xdg-open", [folder]);
}

export async function fileSize(file: string): Promise<number> {
  return (await stat(file)).size;
}

export async function saveCopy(source: string, destination: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}
