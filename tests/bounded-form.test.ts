import assert from "node:assert/strict";
import { test } from "node:test";
import { MultipartBodyError, readBoundedMultipartForm } from "../src/server/storage/bounded-form";

test("multipart reader rejects chunked bodies before unlimited buffering", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(6)); },
    cancel() { cancelled = true; }
  });
  const request = new Request("https://example.test/upload", {
    method: "POST", duplex: "half", body,
    headers: { "content-type": "multipart/form-data; boundary=sample" }
  } as RequestInit);
  await assert.rejects(readBoundedMultipartForm(request, 10), (error: unknown) =>
    error instanceof MultipartBodyError && error.status === 413);
  assert.equal(cancelled, true);
});

test("multipart reader rejects declared oversize before reading", async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(1)); } });
  const request = new Request("https://example.test/upload", {
    method: "POST", duplex: "half", body,
    headers: { "content-type": "multipart/form-data; boundary=sample", "content-length": "11" }
  } as RequestInit);
  await assert.rejects(readBoundedMultipartForm(request, 10), (error: unknown) =>
    error instanceof MultipartBodyError && error.status === 413);
  assert.equal(request.bodyUsed, false);
});

test("multipart reader parses a valid bounded file", async () => {
  const form = new FormData();
  form.set("file", new Blob(["hello"], { type: "text/plain" }), "note.txt");
  const request = new Request("https://example.test/upload", { method: "POST", body: form });
  const parsed = await readBoundedMultipartForm(request, 1_000);
  const file = parsed.get("file");
  assert.ok(file instanceof File);
  assert.equal(await file.text(), "hello");
});
