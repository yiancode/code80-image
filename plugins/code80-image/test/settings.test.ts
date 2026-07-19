import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { code80Catalog } from "../src/catalog.js";
import { initializeLayout, localLayout, MemoryCredentialVault } from "../src/platform.js";
import { SettingsService } from "../src/settings.js";

test("Code80 groups own independent credentials and settings never serialize them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "code80-settings-"));
  const layout = localLayout({ CODE80_IMAGE_HOME: root }, process.platform);
  const vault = new MemoryCredentialVault();
  const service = new SettingsService(layout, vault);
  await initializeLayout(layout);
  try {
    const first = await service.saveGroup({ name: "GPT 分组", endpoint: "https://one.code80.ai", parallelism: 2, credential: "key-one", models: [code80Catalog()[0]!] });
    const second = await service.saveGroup({ name: "Grok 分组", endpoint: "https://two.code80.ai/", parallelism: 4, credential: "key-two", models: [code80Catalog()[1]!] });
    assert.equal(await vault.get(first.id), "key-one");
    assert.equal(await vault.get(second.id), "key-two");
    assert.equal((await service.groups())[1]?.endpoint, "https://two.code80.ai");
    const disk = await readFile(layout.settingsFile, "utf8");
    assert(!disk.includes("key-one"));
    assert(!disk.includes("key-two"));
    await service.setDefault(second.models[0]!.id);
    assert.equal((await service.defaultChoice()).groupName, "Grok 分组");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("new groups receive distinct editable names and fresh catalog objects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "code80-groups-"));
  const layout = localLayout({ CODE80_IMAGE_HOME: root }, process.platform);
  const service = new SettingsService(layout, new MemoryCredentialVault());
  await initializeLayout(layout);
  try {
    assert.equal((await service.suggestedGroup()).name, "默认");
    await service.saveGroup({ ...(await service.suggestedGroup()), credential: "x" });
    const next = await service.suggestedGroup();
    assert.equal(next.name, "分组 2");
    next.models[0]!.label = "changed";
    assert.equal(code80Catalog()[0]!.label, "GPT-Image 2");
  } finally { await rm(root, { recursive: true, force: true }); }
});
