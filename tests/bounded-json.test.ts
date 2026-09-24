import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { BoundedJsonError, parseBoundedJson, readBoundedJson } from "../src/server/storage/bounded-json";

test("JSON reader limits chunked bodies using actual bytes", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(6)); },
    cancel() { cancelled = true; }
  });
  const request = new Request("https://example.test/api", {
    method: "POST", duplex: "half", body,
    headers: { "content-type": "application/json" }
  } as RequestInit);
  await assert.rejects(readBoundedJson(request, 10), (error: unknown) =>
    error instanceof BoundedJsonError && error.status === 413);
  assert.equal(cancelled, true);
});

test("JSON reader rejects an oversized declaration before consuming", async () => {
  const request = new Request("https://example.test/api", {
    method: "POST", body: "{}", headers: { "content-length": "999" }
  });
  await assert.rejects(readBoundedJson(request, 10), (error: unknown) =>
    error instanceof BoundedJsonError && error.status === 413);
  assert.equal(request.bodyUsed, false);
});

test("bounded JSON parsing distinguishes malformed input and excessive size", async () => {
  const schema = z.object({ name: z.string().min(1) }).strict();
  const valid = await parseBoundedJson(new Request("https://example.test/api", {
    method: "POST", body: JSON.stringify({ name: "Ailoom" })
  }), schema, 100, "Invalid project.");
  assert.equal(valid.success, true);
  if (valid.success) assert.equal(valid.data.name, "Ailoom");

  const malformed = await parseBoundedJson(new Request("https://example.test/api", {
    method: "POST", body: "{"
  }), schema, 100, "Invalid project.");
  assert.equal(malformed.success, false);
  if (!malformed.success) assert.equal(malformed.response.status, 400);

  const oversized = await parseBoundedJson(new Request("https://example.test/api", {
    method: "POST", body: JSON.stringify({ name: "a".repeat(100) })
  }), schema, 50, "Invalid project.");
  assert.equal(oversized.success, false);
  if (!oversized.success) assert.equal(oversized.response.status, 413);
});
