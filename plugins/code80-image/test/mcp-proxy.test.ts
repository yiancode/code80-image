import assert from "node:assert/strict";
import test from "node:test";
import { isTransientMcpProxyError, retryTransientMcpOperation } from "../web/mcp-proxy.js";

test("recognizes Codex MCP proxy startup errors", () => {
  assert.equal(isTransientMcpProxyError(new Error("MCP error -32000: MCP proxy request failed")), true);
  assert.equal(isTransientMcpProxyError("MCP proxy request failed"), true);
  assert.equal(isTransientMcpProxyError(new Error("Provider HTTP 400")), false);
});

test("retries transient idempotent failures and then returns the result", async () => {
  let calls = 0;
  const waited: number[] = [];
  const result = await retryTransientMcpOperation(async () => {
    calls += 1;
    if (calls < 3) throw new Error("MCP error -32000: MCP proxy request failed");
    return "ready";
  }, {
    delays: [10, 20, 30],
    wait: async (milliseconds) => { waited.push(milliseconds); },
  });

  assert.equal(result, "ready");
  assert.equal(calls, 3);
  assert.deepEqual(waited, [10, 20]);
});

test("does not retry non-proxy failures", async () => {
  let calls = 0;
  await assert.rejects(() => retryTransientMcpOperation(async () => {
    calls += 1;
    throw new Error("Provider HTTP 400");
  }, { delays: [1, 1], wait: async () => undefined }), /Provider HTTP 400/);
  assert.equal(calls, 1);
});

test("stops after the configured retry budget", async () => {
  let calls = 0;
  await assert.rejects(() => retryTransientMcpOperation(async () => {
    calls += 1;
    throw new Error("MCP proxy request failed");
  }, { delays: [1, 1], wait: async () => undefined }), /MCP proxy request failed/);
  assert.equal(calls, 3);
});
