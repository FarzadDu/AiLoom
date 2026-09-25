import assert from "node:assert/strict";
import { test } from "node:test";
import { listMediaModels } from "../src/server/media/registry";
import {
  getMediaTask, MediaRequestError, prepareMediaRequest, submitMediaRequest
} from "../src/server/media/service";

const operation = {
  speech: "text_to_speech" as const,
  music: "text_to_music" as const,
  effects: "text_to_sound_effect" as const
};

test("audio catalog advertises actual provider endpoints by operation", () => {
  assert.deepEqual(listMediaModels(operation.speech).map(model => [model.id, model.provider]), [
    ["fal-ai/elevenlabs/tts/eleven-v3", "fal"],
    ["fal-ai/elevenlabs/tts/turbo-v2.5", "fal"],
    ["fal-ai/elevenlabs/tts/multilingual-v2", "fal"],
    ["fal-ai/gemini-tts", "fal"],
    ["minimax/speech-2.8-hd", "wavespeed"]
  ]);
  assert.deepEqual(listMediaModels(operation.music).map(model => model.id), [
    "elevenlabs/music/v2", "elevenlabs/music/v2.5",
    "fal-ai/stable-audio-3/small/music/text-to-audio",
    "fal-ai/stable-audio-3/medium/text-to-audio"
  ]);
  assert.deepEqual(listMediaModels(operation.effects).map(model => model.id), [
    "fal-ai/stable-audio-3/small/sfx/text-to-audio",
    "fal-ai/elevenlabs/sound-effects/v2"
  ]);
});

test("ElevenLabs speech variants apply their own supported language and pricing", () => {
  const turbo = prepareMediaRequest({ modelId: "fal-ai/elevenlabs/tts/turbo-v2.5",
    operation: operation.speech, text: "  Hello  ", voice: "Rachel", languageCode: "en" });
  assert.deepEqual(turbo.providerInput, { text: "Hello", voice: "Rachel", language_code: "en",
    apply_text_normalization: "auto" });
  assert.equal(turbo.priceEstimate?.amountUsd, 0.00025);
  const multilingual = prepareMediaRequest({ modelId: "fal-ai/elevenlabs/tts/multilingual-v2",
    operation: operation.speech, text: "سلام", languageCode: "fa" });
  assert.deepEqual(multilingual.providerInput, { text: "سلام", apply_text_normalization: "auto" });
  assert.equal(multilingual.priceEstimate?.amountUsd, 0.0004);
});

test("Gemini speech maps Persian to its documented language label and validates voices", () => {
  const gemini = prepareMediaRequest({ modelId: "fal-ai/gemini-tts",
    operation: operation.speech, text: " سلام ", voice: "Puck", languageCode: "fa",
    modelVariant: "gemini-2.5-pro-tts" });
  assert.deepEqual(gemini.providerInput, {
    prompt: "سلام", voice: "Puck", model: "gemini-2.5-pro-tts",
    language_code: "Persian (Iran)", output_format: "mp3"
  });
  assert.equal(gemini.priceEstimate, null);
  assert.throws(() => prepareMediaRequest({ modelId: "fal-ai/gemini-tts",
    operation: operation.speech, text: "Hello", voice: "Rachel" }),
  (error: unknown) => error instanceof MediaRequestError && error.fields.includes("voice"));
});

test("MiniMax speech submits a required voice_id and returns an audio result", async () => {
  const input = { modelId: "minimax/speech-2.8-hd", operation: operation.speech,
    text: "سلام", languageCode: "fa" };
  assert.deepEqual(prepareMediaRequest(input).providerInput, {
    text: "سلام", voice_id: "Friendly_Person", language_boost: "Persian", format: "mp3"
  });
  const calls: Array<{ url: string; body?: unknown }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), ...(init?.body ? { body: JSON.parse(String(init.body)) as unknown } : {}) });
    return init?.method === "POST"
      ? Response.json({ code: 200, data: { id: "wave_speech_1", status: "created" } })
      : Response.json({ code: 200, data: { id: "wave_speech_1", status: "completed",
        outputs: ["https://cdn.example.test/speech.mp3"] } });
  };
  const submitted = await submitMediaRequest(input, { fetcher, apiKeys: { wavespeed: "test-key" } });
  assert.equal(calls[0].url, "https://api.wavespeed.ai/api/v3/minimax/speech-2.8-hd");
  assert.deepEqual(calls[0].body, { text: "سلام", voice_id: "Friendly_Person",
    language_boost: "Persian", format: "mp3" });
  const task = await getMediaTask({ modelId: input.modelId, providerTaskId: submitted.providerTaskId },
    { fetcher, apiKeys: { wavespeed: "test-key" } });
  assert.equal(task.state, "completed");
  assert.deepEqual(task.assets, [{ kind: "audio", url: "https://cdn.example.test/speech.mp3",
    contentType: null }]);
});

test("new music choices keep endpoint-specific duration limits and estimates", () => {
  const eleven = prepareMediaRequest({ modelId: "elevenlabs/music/v2.5",
    operation: operation.music, prompt: " Ambient piano ", durationSec: 121 });
  assert.deepEqual(eleven.providerInput, { prompt: "Ambient piano", music_length_ms: 121000,
    force_instrumental: false, output_format: "mp3_44100_128" });
  assert.equal(eleven.priceEstimate?.amountUsd, 1.8);
  const medium = prepareMediaRequest({ modelId: "fal-ai/stable-audio-3/medium/text-to-audio",
    operation: operation.music, prompt: "Ambient piano", durationSec: 380 });
  assert.deepEqual(medium.providerInput, { prompt: "Ambient piano", duration: 380,
    output_format: "mp3", bitrate: "192k" });
  assert.equal(medium.priceEstimate, null);
  assert.throws(() => prepareMediaRequest({ modelId: medium.modelId,
    operation: operation.music, prompt: "Ambient piano", durationSec: 381 }),
  (error: unknown) => error instanceof MediaRequestError && error.fields.includes("durationSec"));
});

test("ElevenLabs sound effects uses its own schema and rejects unsupported controls", () => {
  const base = { modelId: "fal-ai/elevenlabs/sound-effects/v2",
    operation: operation.effects, prompt: "  Thunder crack  ", durationSec: 1.5,
    loop: true, promptInfluence: 0.8 };
  const effect = prepareMediaRequest(base);
  assert.deepEqual(effect.providerInput, { text: "Thunder crack",
    duration_seconds: 1.5, prompt_influence: 0.8, loop: true,
    output_format: "mp3_44100_128" });
  assert.equal(effect.priceEstimate?.amountUsd, 0.003);
  for (const extra of [{ durationSec: 23 }, { negativePrompt: "voice" },
    { outputFormat: "wav" }, { seed: 5 }, { promptInfluence: 1.1 }]) {
    assert.throws(() => prepareMediaRequest({ ...base, ...extra }),
    (error: unknown) => error instanceof MediaRequestError && error.code === "invalid_input");
  }
});
