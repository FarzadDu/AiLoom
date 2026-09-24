import assert from "node:assert/strict";
import { test } from "node:test";
import { ElevenLabsError, synthesizeSpeech, transcribeAudio } from "../src/server/providers/elevenlabs";

test("speech synthesis returns binary audio and keeps the key out of the body", async () => {
  let body: any;
  const fetcher: typeof fetch = async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("xi-api-key"), "test-key");
    body = JSON.parse(String(init?.body));
    return new Response(Buffer.from([0x49, 0x44, 0x33]), { status: 200 });
  };
  const audio = await synthesizeSpeech({
    text: "سلام", voiceId: "voice-a", modelId: "eleven_v3",
    languageCode: "fa", apiKey: "test-key", fetcher
  });
  assert.deepEqual([...audio], [0x49, 0x44, 0x33]);
  assert.equal(body.language_code, "fa");
  assert.equal(JSON.stringify(body).includes("test-key"), false);
});

test("transcription sends multipart media and parses a timed transcript", async () => {
  const fetcher: typeof fetch = async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("xi-api-key"), "test-key");
    assert.equal(init?.body instanceof FormData, true);
    const form = init?.body as FormData;
    assert.equal(form.get("model_id"), "scribe_v2");
    assert.equal(form.get("timestamps_granularity"), "word");
    assert.equal(form.get("language_code"), "fa");
    assert.equal(form.get("diarize"), "true");
    assert.equal((form.get("file") as File).name, "sample.mp3");
    return Response.json({ text: "سلام", language_code: "fa", words: [
      { text: "سلام", start: 0, end: 0.5, speaker_id: "speaker_1" }
    ] });
  };
  const transcript = await transcribeAudio({
    bytes: Buffer.from([0x49, 0x44, 0x33]), filename: "sample.mp3",
    mimeType: "audio/mpeg", languageCode: "fa", diarize: true,
    apiKey: "test-key", fetcher
  });
  assert.equal(transcript.text, "سلام");
  assert.equal(transcript.words[0].speakerId, "speaker_1");
});

test("provider failures do not echo the response body", async () => {
  const fetcher: typeof fetch = async () => new Response("private text", { status: 429 });
  await assert.rejects(synthesizeSpeech({
    text: "hello", voiceId: "voice-a", apiKey: "test-key", fetcher
  }), (error: unknown) => error instanceof ElevenLabsError &&
    error.status === 429 && !error.message.includes("private text"));
});
