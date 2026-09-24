import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { listMediaModels } from "../src/server/media/registry";
import { MediaRequestError, prepareMediaRequest, submitMediaRequest } from "../src/server/media/service";
import { firstLastRequestIdentity } from "../src/components/first-last-request";
import { repairRequestIdentity } from "../src/components/repair-request";

test("Veo first and last frame is in the video catalog and maps exact fal fields", async () => {
  const modelId = "fal-ai/veo3.1/fast/first-last-frame-to-video";
  assert.deepEqual(listMediaModels("first_last_frame_to_video").map(model => model.id), [modelId]);
  const input = {
    modelId, operation: "first_last_frame_to_video",
    prompt: "A slow camera move",
    firstFrameUrl: "https://assets.example.com/first.png",
    lastFrameUrl: "https://assets.example.com/last.png",
    durationSec: 6, aspectRatio: "9:16", resolution: "1080p", audio: false
  };
  const prepared = prepareMediaRequest(input);
  assert.deepEqual(prepared.providerInput, {
    prompt: "A slow camera move", duration: "6s", aspect_ratio: "9:16",
    resolution: "1080p", generate_audio: false,
    first_frame_url: input.firstFrameUrl, last_frame_url: input.lastFrameUrl
  });
  assert.equal(prepared.priceEstimate?.amountUsd, 0.6);
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ request_id: "veo_flf_1", queue_position: 0 });
  };
  const task = await submitMediaRequest(input, { fetcher, apiKeys: { fal: "test-key" } });
  assert.equal(task.providerTaskId, "veo_flf_1");
  assert.equal(calls[0]?.url, `https://queue.fal.run/${modelId}`);
  assert.deepEqual(calls[0]?.body, prepared.providerInput);
});

test("Veo first and last frame rejects missing or unsafe frames and unsupported controls", () => {
  const input = {
    modelId: "fal-ai/veo3.1/fast/first-last-frame-to-video",
    operation: "first_last_frame_to_video",
    prompt: "A slow camera move",
    firstFrameUrl: "https://assets.example.com/first.png",
    lastFrameUrl: "https://assets.example.com/last.png"
  };
  for (const invalid of [
    { lastFrameUrl: undefined },
    { firstFrameUrl: "https://127.0.0.1/private" },
    { durationSec: 10 },
    { aspectRatio: "4:3" }
  ]) {
    assert.throws(() => prepareMediaRequest({ ...input, ...invalid }),
      (error: unknown) => error instanceof MediaRequestError && error.code === "invalid_input");
  }
});

test("first/last retry identity follows private asset IDs and controls, not renewed access URLs", () => {
  const controls = { prompt: "Between the frames", durationSec: 6 as const,
    aspectRatio: "16:9" as const, resolution: "720p" as const, audio: true };
  const original = firstLastRequestIdentity("first-id", "last-id", controls);
  assert.equal(original, firstLastRequestIdentity("first-id", "last-id", { ...controls }));
  assert.notEqual(original, firstLastRequestIdentity("first-id", "replacement", controls));
  assert.notEqual(original, firstLastRequestIdentity("replacement", "last-id", controls));
  assert.notEqual(original, firstLastRequestIdentity("first-id", "last-id", { ...controls, prompt: "Different motion" }));
  assert.notEqual(original, firstLastRequestIdentity("first-id", "last-id", { ...controls, durationSec: 8 }));
  assert.notEqual(original, firstLastRequestIdentity("first-id", "last-id", { ...controls, audio: false }));
});

test("repair retry identity follows source, interval and trimmed prompt", () => {
  const original = repairRequestIdentity("source-id", 10, 12, " Improve motion ");
  assert.equal(original, repairRequestIdentity("source-id", 10, 12, "Improve motion"));
  assert.notEqual(original, repairRequestIdentity("other-source", 10, 12, "Improve motion"));
  assert.notEqual(original, repairRequestIdentity("source-id", 10.1, 12, "Improve motion"));
  assert.notEqual(original, repairRequestIdentity("source-id", 10, 12.1, "Improve motion"));
  assert.notEqual(original, repairRequestIdentity("source-id", 10, 12, "Different motion"));
});

test("renewed first/last private access URLs replay one owned video job", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-frames-retry-"));
  const previousDatabase = process.env.DATABASE_PATH;
  const previousBase = process.env.PUBLIC_BASE_URL;
  process.env.DATABASE_PATH = join(directory, "retry.sqlite");
  process.env.PUBLIC_BASE_URL = "https://ailoom.example.test";
  try {
    const { getDb, getSqlite } = await import("../src/server/db");
    const { user } = await import("../src/server/db/schema");
    const { createGenerationJob, GenerationIdempotencyConflictError } = await import("../src/server/content/jobs");
    try {
      migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
      const ownerId = randomUUID();
      const now = new Date();
      getDb().insert(user).values({ id: ownerId, name: "Owner", email: "frames-owner@example.test",
        role: "user", emailVerified: true, createdAt: now, updatedAt: now }).run();
      const key = randomUUID();
      const firstId = randomUUID();
      const lastId = randomUUID();
      const request = (expires: number, token: string, endId = lastId) => ({
        kind: "video" as const, provider: "fal", providerModel: "fal-ai/veo3.1/fast/first-last-frame-to-video",
        idempotencyKey: key,
        payload: { modelId: "fal-ai/veo3.1/fast/first-last-frame-to-video", operation: "first_last_frame_to_video",
          prompt: "A slow camera move", durationSec: 6, aspectRatio: "16:9", resolution: "720p", audio: true,
          firstFrameUrl: `https://ailoom.example.test/api/assets/${firstId}?expires=${expires}&token=${token}`,
          lastFrameUrl: `https://ailoom.example.test/api/assets/${endId}?expires=${expires}&token=${token}` }
      });
      const first = createGenerationJob(ownerId, request(1_790_000_000, "first"));
      assert.equal(createGenerationJob(ownerId, request(1_790_003_600, "renewed")).id, first.id);
      assert.throws(() => createGenerationJob(ownerId, request(1_790_003_600, "renewed", randomUUID())),
        GenerationIdempotencyConflictError);
    } finally { getSqlite().close(); }
  } finally {
    if (previousDatabase === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabase;
    if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousBase;
    rmSync(directory, { recursive: true, force: true });
  }
});
