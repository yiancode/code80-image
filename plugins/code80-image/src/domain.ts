export type AdapterKind = "code80" | "agent";
export type JobState = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type BatchState = "queued" | "running" | "completed" | "partial" | "failed" | "canceled";

export interface Money {
  mode: "per_request" | "token" | "model_quota" | "unknown";
  currency: string;
  amount?: number;
  note?: string;
}

export interface ModelDefinition {
  id: string;
  model: string;
  label: string;
  sizes: string[];
  qualities: string[];
  canGenerate: boolean;
  canEdit: boolean;
  price: Money;
}

export interface ProviderGroup {
  id: string;
  name: string;
  endpoint: string;
  parallelism: number;
  models: ModelDefinition[];
  hasCredential: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredProviderGroup extends Omit<ProviderGroup, "hasCredential"> {}

export interface AppSettings {
  schema: 1;
  groups: StoredProviderGroup[];
  defaultModelId?: string;
  updatedAt: string;
}

export interface ModelChoice {
  id: string;
  groupId: string;
  groupName: string;
  providerName: "Code80" | "Codex";
  adapter: AdapterKind;
  model: string;
  label: string;
  parallelism: number;
  sizes: string[];
  qualities: string[];
  canGenerate: boolean;
  canEdit: boolean;
  price: Money;
}

export interface ImageVersion {
  id: string;
  label: string;
  file: string;
  createdAt: string;
}

export interface ImageJob {
  id: string;
  ordinal: number;
  label: string;
  prompt: string;
  references: string[];
  size?: string;
  quality?: string;
  outputFile?: string;
  versions: ImageVersion[];
  model: ModelChoice;
  state: JobState;
  progress: number;
  attempt: number;
  retryable: boolean;
  billing: "not_charged" | "charged" | "unknown";
  error?: string;
  providerRequestId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ImageBatch {
  id: string;
  title: string;
  summaryPrompt: string;
  outputDirectory: string;
  model: ModelChoice;
  jobs: ImageJob[];
  requestKeys: Record<string, string[]>;
  createdAt: string;
  updatedAt: string;
}

export interface BatchView extends ImageBatch {
  state: BatchState;
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  canceled: number;
}

export interface ProviderImageRequest {
  model: string;
  prompt: string;
  references: string[];
  size?: string;
  quality?: string;
}

export interface ProviderImageResult {
  url?: string;
  base64?: string;
  mimeType: string;
  requestId?: string;
}

export class Code80HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly retryable: boolean,
    readonly billing: "not_charged" | "charged" | "unknown",
    readonly requestId?: string
  ) {
    super(message);
    this.name = "Code80HttpError";
  }
}

export const AGENT_MODEL_ID = "code80-agent-image";

export const AGENT_MODEL: ModelChoice = {
  id: AGENT_MODEL_ID,
  groupId: "code80-agent",
  groupName: "内置",
  providerName: "Codex",
  adapter: "agent",
  model: "agent-image-generation",
  label: "Codex 生成",
  parallelism: 1,
  sizes: [],
  qualities: [],
  canGenerate: true,
  canEdit: true,
  price: { mode: "model_quota", currency: "MODEL" }
};
