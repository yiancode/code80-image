import assert from "node:assert/strict";
import test from "node:test";
import { Code80Client } from "../src/code80-client.js";
import { Code80HttpError } from "../src/domain.js";

test("GPT generation uses the OpenAI Images-compatible Code80 contract", async () => {
  let request: { url?: string; init?: RequestInit } = {};
  const client = new Code80Client("https://code80.ai", "secret", async (input, init) => {
    request = { url: String(input), init };
    return Response.json({ data: [{ b64_json: "aW1hZ2U=", mime_type: "image/png" }] }, { headers: { "x-request-id": "request-1" } });
  });
  const result = await client.generate({ model: "gpt-image-2", prompt: "orange bus", references: [], size: "1024x1024", quality: "high" });
  assert.equal(request.url, "https://code80.ai/v1/images/generations");
  assert.equal((request.init?.headers as Record<string, string>).authorization, "Bearer secret");
  assert.deepEqual(JSON.parse(String(request.init?.body)), { model: "gpt-image-2", prompt: "orange bus", n: 1, response_format: "b64_json", size: "1024x1024", quality: "high" });
  assert.equal(result.requestId, "request-1");
});

test("Grok uses aspect ratio and resolution fields and limits edits to three references", async () => {
  let body: Record<string, unknown> = {};
  const client = new Code80Client("https://code80.ai", "secret", async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ data: [{ b64_json: "aW1hZ2U=" }] });
  });
  await client.generate({ model: "grok-imagine", prompt: "rain", references: [], size: "16:9", quality: "2k" });
  assert.equal(body.aspect_ratio, "16:9");
  assert.equal(body.resolution, "2k");
  assert.equal(body.size, undefined);
  await assert.rejects(() => client.generate({ model: "grok-imagine", prompt: "edit", references: ["1", "2", "3", "4"] }), (error: unknown) => error instanceof Code80HttpError && error.billing === "not_charged");
});

test("provider policy messages are preserved instead of becoming opaque HTTP errors", async () => {
  const client = new Code80Client("https://code80.ai", "secret", async () => Response.json({ error: { message: "Please revise the prompt." } }, { status: 400 }));
  await assert.rejects(() => client.generate({ model: "gpt-image-2", prompt: "blocked", references: [] }), (error: unknown) => error instanceof Code80HttpError && error.message === "Please revise the prompt." && !error.retryable);
});
