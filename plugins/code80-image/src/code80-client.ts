import { readFile } from "node:fs/promises";
import path from "node:path";
import { Code80HttpError, type ProviderImageRequest, type ProviderImageResult } from "./domain.js";

export type HttpFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function grok(model: string): boolean {
  return model.trim().toLowerCase().startsWith("grok-imagine");
}

function compact(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== ""));
}

function mimeFromFile(file: string): string {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/png";
}

async function referenceValue(reference: string): Promise<string> {
  if (/^(data:|https?:)/i.test(reference)) return reference;
  const bytes = await readFile(reference);
  return `data:${mimeFromFile(reference)};base64,${bytes.toString("base64")}`;
}

function responseRequestId(response: Response, body: unknown): string | undefined {
  const header = response.headers.get("x-request-id") || response.headers.get("request-id");
  if (header) return header;
  if (body && typeof body === "object") {
    const value = body as Record<string, unknown>;
    return typeof value.id === "string" ? value.id : typeof value.request_id === "string" ? value.request_id : undefined;
  }
  return undefined;
}

function messageFrom(body: unknown, status: number): string {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (body && typeof body === "object") {
    const value = body as Record<string, unknown>;
    const error = value.error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") return String((error as Record<string, unknown>).message);
    if (typeof value.message === "string") return value.message;
  }
  return `Code80 请求失败（HTTP ${status}）。`;
}

async function decoded(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return text; }
}

function resultFrom(body: unknown, response: Response): ProviderImageResult {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const data = Array.isArray(record.data) ? record.data[0] : record;
  const image = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const url = typeof image.url === "string" ? image.url : typeof image.output_url === "string" ? image.output_url : undefined;
  const base64 = typeof image.b64_json === "string" ? image.b64_json : typeof image.base64 === "string" ? image.base64 : undefined;
  if (!url && !base64) throw new Code80HttpError("Code80 返回成功，但响应中没有图片。", response.status, false, "unknown", responseRequestId(response, body));
  const mimeType = typeof image.mime_type === "string" ? image.mime_type : url?.match(/\.webp(?:\?|$)/i) ? "image/webp" : url?.match(/\.jpe?g(?:\?|$)/i) ? "image/jpeg" : "image/png";
  return { url, base64, mimeType, requestId: responseRequestId(response, body) };
}

export class Code80Client {
  constructor(
    private endpoint: string,
    private credential: string,
    private http: HttpFetch = fetch,
    private timeoutMs = 300_000
  ) {}

  async models(): Promise<string[]> {
    const response = await this.http(`${this.endpoint}/v1/models`, { headers: { authorization: `Bearer ${this.credential}` }, signal: AbortSignal.timeout(30_000) });
    const body = await decoded(response);
    if (!response.ok) throw this.failure(response, body);
    const values = body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).data) ? (body as { data: unknown[] }).data : [];
    return values.flatMap((entry) => {
      if (typeof entry === "string") return [entry];
      if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).id === "string") return [String((entry as Record<string, unknown>).id)];
      return [];
    });
  }

  async generate(input: ProviderImageRequest, externalSignal?: AbortSignal): Promise<ProviderImageResult> {
    if (grok(input.model) && input.references.length > 3) throw new Code80HttpError("Grok 图片编辑最多接受 3 张参考图。", undefined, false, "not_charged");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
    try {
      const response = input.references.length ? await this.edit(input, signal) : await this.create(input, signal);
      const body = await decoded(response);
      if (!response.ok) throw this.failure(response, body);
      return resultFrom(body, response);
    } catch (error) {
      if (error instanceof Code80HttpError) throw error;
      if (error instanceof DOMException && error.name === "TimeoutError") throw new Code80HttpError("Code80 请求超时。", undefined, true, "unknown");
      throw new Code80HttpError(error instanceof Error ? error.message : String(error), undefined, true, "not_charged");
    }
  }

  private create(input: ProviderImageRequest, signal: AbortSignal): Promise<Response> {
    const isGrok = grok(input.model);
    return this.http(`${this.endpoint}/v1/images/generations`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.credential}`, "content-type": "application/json" },
      body: JSON.stringify(compact({
        model: input.model,
        prompt: input.prompt,
        n: 1,
        response_format: "b64_json",
        size: isGrok ? undefined : input.size,
        quality: isGrok ? undefined : input.quality,
        aspect_ratio: isGrok ? input.size : undefined,
        resolution: isGrok ? input.quality : undefined
      })),
      signal
    });
  }

  private async edit(input: ProviderImageRequest, signal: AbortSignal): Promise<Response> {
    if (grok(input.model)) {
      const references = await Promise.all(input.references.map(referenceValue));
      const imageObjects = references.map((url) => ({ type: "image_url", url }));
      const body: Record<string, unknown> = compact({ model: input.model, prompt: input.prompt, response_format: "b64_json", resolution: input.quality });
      if (imageObjects.length === 1) body.image = imageObjects[0];
      else { body.images = imageObjects; body.aspect_ratio = input.size; }
      return this.http(`${this.endpoint}/v1/images/edits`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.credential}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal
      });
    }
    const form = new FormData();
    form.set("model", input.model);
    form.set("prompt", input.prompt);
    form.set("n", "1");
    form.set("response_format", "b64_json");
    if (input.size) form.set("size", input.size);
    if (input.quality) form.set("quality", input.quality);
    for (const [index, reference] of input.references.entries()) {
      const data = await referenceValue(reference);
      const match = /^data:([^;,]+);base64,(.+)$/s.exec(data);
      if (!match) throw new Code80HttpError("参考图无法转换为图片数据。", undefined, false, "not_charged");
      const mime = match[1]!;
      const bytes = Uint8Array.from(Buffer.from(match[2]!, "base64"));
      form.append("image", new Blob([bytes.buffer], { type: mime }), `reference-${index + 1}.${mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png"}`);
    }
    return this.http(`${this.endpoint}/v1/images/edits`, { method: "POST", headers: { authorization: `Bearer ${this.credential}` }, body: form, signal });
  }

  private failure(response: Response, body: unknown): Code80HttpError {
    const retryable = response.status === 408 || response.status === 409 || response.status === 425 || response.status === 429 || response.status >= 500;
    const billing = response.status >= 400 && response.status < 500 ? "not_charged" : "unknown";
    return new Code80HttpError(messageFrom(body, response.status), response.status, retryable, billing, responseRequestId(response, body));
  }
}
