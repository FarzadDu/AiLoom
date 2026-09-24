import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TRANSCRIPTION_FILE_BYTES, parseTranscriptionRequest, TranscriptionRequestError } from "../src/server/media/transcription-request";

function upload(bytes: Uint8Array, mimeType: string, name: string, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name, { type: mimeType }));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("http://localhost/api/audio/transcribe", { method: "POST", body: form });
}

test("transcription accepts signed media bytes and optional settings", async () => {
  const request = upload(new Uint8Array([0x49, 0x44, 0x33, 0x04]), "audio/mpeg", "voice.mp3", {
    languageCode: " FA ", diarize: "true"
  });
  const parsed = await parseTranscriptionRequest(request);
  assert.equal(parsed.filename, "voice.mp3");
  assert.equal(parsed.mimeType, "audio/mpeg");
  assert.equal(parsed.languageCode, "fa");
  assert.equal(parsed.diarize, true);
  assert.deepEqual([...parsed.bytes], [0x49, 0x44, 0x33, 0x04]);
});

test("transcription rejects a spoofed media type and invalid language", async () => {
  await assert.rejects(parseTranscriptionRequest(upload(new Uint8Array([1, 2, 3]), "audio/mpeg", "fake.mp3")),
    (error: unknown) => error instanceof TranscriptionRequestError && error.status === 415);
  await assert.rejects(parseTranscriptionRequest(upload(new Uint8Array([0x49, 0x44, 0x33]), "audio/mpeg", "real.mp3", {
    languageCode: "English"
  })), (error: unknown) => error instanceof TranscriptionRequestError && error.status === 400);
});

test("transcription rejects oversized uploads before parsing multipart", async () => {
  const request = upload(new Uint8Array([0x49, 0x44, 0x33]), "audio/mpeg", "voice.mp3");
  request.headers.set("content-length", String(MAX_TRANSCRIPTION_FILE_BYTES + 1_000_001));
  await assert.rejects(parseTranscriptionRequest(request),
    (error: unknown) => error instanceof TranscriptionRequestError && error.status === 413);
});
