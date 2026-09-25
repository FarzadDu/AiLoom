import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { listMediaModels } from "../src/server/media/registry";
import { getMediaTask, MediaRequestError, prepareMediaRequest, submitMediaRequest } from "../src/server/media/service";

const MODEL_ID = "fal-ai/stable-audio-3/small/sfx/text-to-audio";
const directory = mkdtempSync(join(tmpdir(), "ailoom-effects-test-"));
process.env.DATABASE_PATH = join(directory, "test.sqlite");

const { getDb, getSqlite } = await import("../src/server/db");
const { user } = await import("../src/server/db/schema");
const { createGenerationJob, GenerationIdempotencyConflictError, listGenerationJobs } =
  await import("../src/server/content/jobs");
migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });

const now = new Date();
const ownerId = randomUUID();
const anotherId = randomUUID();
for (const [id, email] of [[ownerId, "effects-owner@example.test"], [anotherId, "effects-other@example.test"]]) {
  getDb().insert(user).values({ id, email, name: "Audio owner", role: "user", emailVerified: true,
    createdAt: now, updatedAt: now }).run();
}
after(() => { getSqlite().close(); rmSync(directory, { recursive: true, force: true }); });

const input = { modelId: MODEL_ID, operation: "text_to_sound_effect", prompt: " A metallic impact ",
  durationSec: 10, negativePrompt: " no speech ", outputFormat: "wav", seed: 84 };

test("SFX catalog, validation and fal payload follow the documented endpoint", () => {
  assert.deepEqual(listMediaModels("text_to_sound_effect").map(model => model.id), [MODEL_ID]);
  const prepared = prepareMediaRequest(input);
  assert.equal(prepared.provider, "fal");
  assert.equal(prepared.priceEstimate, null);
  assert.deepEqual(prepared.providerInput, {
    prompt: "A metallic impact", duration: 10, negative_prompt: "no speech",
    output_format: "wav", seed: 84
  });
  for (const value of [
    { durationSec: 31 }, { durationSec: 0 }, { outputFormat: "exe" }, { seed: -1 },
    { modelId: "fal-ai/other" }, { unexpected: true }
  ]) {
    assert.throws(() => prepareMediaRequest({ ...input, ...value }),
      (error: unknown) => error instanceof MediaRequestError);
  }
});

test("SFX fal submission and read-only completion parse a private-importable audio result", async () => {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    const address = String(url);
    calls.push({ url: address, method: init?.method ?? "GET",
      ...(init?.body ? { body: JSON.parse(String(init.body)) as unknown } : {}) });
    if (init?.method === "POST") return Response.json({ request_id: "sfx-task-1", queue_position: 0 });
    if (address.endsWith("/status?logs=0")) return Response.json({ request_id: "sfx-task-1", status: "COMPLETED" });
    return Response.json({ audio: { url: "https://cdn.example.test/generated.mp3", content_type: "audio/mpeg" } });
  };
  const submission = await submitMediaRequest(input, { fetcher, apiKeys: { fal: "test-key" } });
  const result = await getMediaTask({ modelId: submission.modelId, providerTaskId: submission.providerTaskId },
    { fetcher, apiKeys: { fal: "test-key" } });
  assert.equal(calls[0].url, `https://queue.fal.run/${MODEL_ID}`);
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, {
    prompt: "A metallic impact", duration: 10, negative_prompt: "no speech",
    output_format: "wav", seed: 84
  });
  assert.equal(calls[1].url, "https://queue.fal.run/fal-ai/stable-audio-3/requests/sfx-task-1/status?logs=0");
  assert.deepEqual(result.assets, [{ kind: "audio", url: "https://cdn.example.test/generated.mp3",
    contentType: "audio/mpeg" }]);
});

test("owner-scoped SFX history and stable paid request key cannot cross accounts or change payload", () => {
  const key = randomUUID();
  const first = createGenerationJob(ownerId, { kind: "audio", provider: "fal", providerModel: MODEL_ID,
    payload: input, idempotencyKey: key });
  const repeat = createGenerationJob(ownerId, { kind: "audio", provider: "fal", providerModel: MODEL_ID,
    payload: input, idempotencyKey: key });
  assert.equal(first.id, repeat.id);
  assert.deepEqual(listGenerationJobs(ownerId, { providerModel: MODEL_ID }).map(item => item.id), [key]);
  assert.deepEqual(listGenerationJobs(anotherId, { providerModel: MODEL_ID }), []);
  assert.throws(() => createGenerationJob(ownerId, { kind: "audio", provider: "fal", providerModel: MODEL_ID,
    payload: { ...input, prompt: "Different sound" }, idempotencyKey: key }), GenerationIdempotencyConflictError);
  assert.throws(() => createGenerationJob(anotherId, { kind: "audio", provider: "fal", providerModel: MODEL_ID,
    payload: input, idempotencyKey: key }), GenerationIdempotencyConflictError);
});
