import { randomUUID } from "node:crypto";
import { code80Catalog, nextGroupName } from "./catalog.js";
import { AGENT_MODEL, type AppSettings, type ModelChoice, type ModelDefinition, type ProviderGroup, type StoredProviderGroup } from "./domain.js";
import type { CredentialVault, LocalLayout } from "./platform.js";
import { readJson, writeJson } from "./platform.js";

function blankSettings(): AppSettings {
  return { schema: 1, groups: [], updatedAt: new Date(0).toISOString() };
}

function cloneModel(model: ModelDefinition): ModelDefinition {
  return { ...model, sizes: [...model.sizes], qualities: [...model.qualities], price: { ...model.price } };
}

export class SettingsService {
  constructor(private layout: LocalLayout, readonly vault: CredentialVault) {}

  async load(): Promise<AppSettings> {
    const value = await readJson(this.layout.settingsFile, blankSettings());
    return value.schema === 1 && Array.isArray(value.groups) ? value : blankSettings();
  }

  async groups(): Promise<ProviderGroup[]> {
    const settings = await this.load();
    return Promise.all(settings.groups.map(async (group) => ({ ...group, models: group.models.map(cloneModel), hasCredential: await this.vault.has(group.id) })));
  }

  async suggestedGroup(): Promise<{ name: string; endpoint: string; parallelism: number; models: ModelDefinition[] }> {
    const current = await this.load();
    return { name: nextGroupName(current.groups.map((group) => group.name)), endpoint: "https://dev.code80.ai", parallelism: 3, models: code80Catalog() };
  }

  async saveGroup(input: {
    id?: string;
    name: string;
    endpoint: string;
    parallelism: number;
    credential?: string;
    models: ModelDefinition[];
  }): Promise<ProviderGroup> {
    const settings = await this.load();
    const now = new Date().toISOString();
    const existing = input.id ? settings.groups.find((group) => group.id === input.id) : undefined;
    const id = existing?.id || randomUUID();
    const modelIds = new Set<string>();
    const models = input.models.map((entry) => {
      const model = cloneModel(entry);
      model.id = model.id || randomUUID();
      if (!model.model.trim() || !model.label.trim()) throw new Error("每个模型都必须填写显示名称和模型 ID。");
      if (modelIds.has(model.id)) throw new Error("模型 ID 重复。");
      modelIds.add(model.id);
      return model;
    });
    if (!models.length) throw new Error("至少配置一个生图模型。");
    const stored: StoredProviderGroup = {
      id,
      name: input.name.trim(),
      endpoint: input.endpoint.replace(/\/+$/, ""),
      parallelism: Math.max(1, Math.min(12, Math.trunc(input.parallelism))),
      models,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    if (!stored.name) throw new Error("分组名称不能为空。");
    new URL(stored.endpoint);
    const index = settings.groups.findIndex((group) => group.id === id);
    if (index >= 0) settings.groups[index] = stored;
    else settings.groups.push(stored);
    if (input.credential?.trim()) await this.vault.set(id, input.credential.trim());
    settings.updatedAt = now;
    await writeJson(this.layout.settingsFile, settings);
    return { ...stored, hasCredential: await this.vault.has(id) };
  }

  async deleteGroup(groupId: string): Promise<void> {
    const settings = await this.load();
    const removedModels = new Set(settings.groups.find((entry) => entry.id === groupId)?.models.map((model) => model.id) || []);
    settings.groups = settings.groups.filter((entry) => entry.id !== groupId);
    if (settings.defaultModelId && removedModels.has(settings.defaultModelId)) settings.defaultModelId = undefined;
    settings.updatedAt = new Date().toISOString();
    await Promise.all([writeJson(this.layout.settingsFile, settings), this.vault.remove(groupId)]);
  }

  async choices(): Promise<ModelChoice[]> {
    const groups = await this.load();
    const choices = groups.groups.flatMap((group) => group.models.map((model): ModelChoice => ({
      id: model.id,
      groupId: group.id,
      groupName: group.name,
      providerName: "Code80",
      adapter: "code80",
      model: model.model,
      label: model.label,
      parallelism: group.parallelism,
      sizes: [...model.sizes],
      qualities: [...model.qualities],
      canGenerate: model.canGenerate,
      canEdit: model.canEdit,
      price: { ...model.price }
    })));
    return [AGENT_MODEL, ...choices];
  }

  async setDefault(modelId: string): Promise<void> {
    if (!(await this.choices()).some((choice) => choice.id === modelId)) throw new Error("默认模型不存在。");
    const settings = await this.load();
    settings.defaultModelId = modelId;
    settings.updatedAt = new Date().toISOString();
    await writeJson(this.layout.settingsFile, settings);
  }

  async defaultChoice(explicit?: string): Promise<ModelChoice> {
    const settings = await this.load();
    const id = explicit || settings.defaultModelId;
    if (!id) throw new Error("请先在 Code80 Image 设置中选择默认模型。");
    const choice = (await this.choices()).find((entry) => entry.id === id);
    if (!choice) throw new Error("已选择的模型不再存在，请重新设置默认模型。");
    return choice;
  }

  async connection(choice: ModelChoice): Promise<{ endpoint: string; credential: string }> {
    if (choice.adapter !== "code80") throw new Error("Codex 生成不使用外部连接。");
    const settings = await this.load();
    const group = settings.groups.find((entry) => entry.id === choice.groupId);
    if (!group) throw new Error("Code80 分组不存在。");
    const credential = await this.vault.get(group.id);
    if (!credential) throw new Error(`分组“${group.name}”尚未保存 API Key。`);
    return { endpoint: group.endpoint, credential };
  }
}
