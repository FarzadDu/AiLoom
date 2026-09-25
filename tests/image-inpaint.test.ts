import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { imageDimensions, inpaintDimensionsAllowed } from "../src/server/media/image-dimensions";
import { listMediaModels } from "../src/server/media/registry";
import { MediaRequestError, prepareMediaRequest, submitMediaRequest } from "../src/server/media/service";
import { mediaViewForJob } from "../src/components/media-api";

const MODEL = "wavespeed-ai/z-image/turbo-inpaint";

test("an inpaint edit resumes in Image Studio after reload", () => {
  assert.equal(mediaViewForJob("edit", MODEL), "image");
  assert.equal(mediaViewForJob("edit", "fal-ai/qwen-image-edit"), "image");
  assert.equal(mediaViewForJob("edit", "fal-ai/ltx-2.3-quality/inpaint"), "video");
  assert.equal(mediaViewForJob("edit", "unrecognized-model"), null);
});

function crc32(bytes: Buffer): number {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? crc >>> 1 ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(name: string, data: Buffer): Buffer {
  const type = Buffer.from(name, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

function png(width: number, height: number, markCentre = false): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8-bit greyscale.
  const rowLength = width + 1;
  const raw = Buffer.alloc(rowLength * height);
  if (markCentre) {
    for (let y = Math.floor(height / 3); y < Math.ceil(height * 2 / 3); y++) {
      raw.fill(255, y * rowLength + Math.floor(width / 3) + 1,
        y * rowLength + Math.ceil(width * 2 / 3) + 1);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

test("inpaint uses the exact WaveSpeed model, fields and published estimate", async () => {
  assert.deepEqual(listMediaModels("image_inpaint").map(model => model.id), [MODEL]);
  const input = { modelId: MODEL, operation: "image_inpaint", prompt: "  Replace the mug  ",
    imageUrl: "https://assets.example.test/source.png",
    maskImageUrl: "https://assets.example.test/mask.png" };
  const prepared = prepareMediaRequest(input);
  assert.equal(prepared.provider, "wavespeed");
  assert.deepEqual(prepared.providerInput, { prompt: "Replace the mug",
    image: input.imageUrl, mask_image: input.maskImageUrl });
  assert.equal(prepared.priceEstimate?.amountUsd, 0.02);
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ code: 200, data: { id: "inpaint_test_1", status: "created" } });
  };
  const submitted = await submitMediaRequest(input, { apiKeys: { wavespeed: "test-only-key" }, fetcher });
  assert.equal(submitted.providerTaskId, "inpaint_test_1");
  assert.deepEqual(calls, [{ url: `https://api.wavespeed.ai/api/v3/${MODEL}`,
    body: prepared.providerInput }]);
});

test("inpaint rejects missing, unsafe and unrecognized provider fields", () => {
  const input = { modelId: MODEL, operation: "image_inpaint", prompt: "Replace the mug",
    imageUrl: "https://assets.example.test/source.png",
    maskImageUrl: "https://assets.example.test/mask.png" };
  for (const invalid of [
    { maskImageUrl: undefined }, { maskImageUrl: "http://assets.example.test/mask.png" },
    { imageUrl: "https://127.0.0.1/private" }, { mask_url: input.maskImageUrl },
    { prompt: " " }
  ]) {
    assert.throws(() => prepareMediaRequest({ ...input, ...invalid }),
      (error: unknown) => error instanceof MediaRequestError && error.code === "invalid_input");
  }
});

test("image dimensions reject invalid headers and out-of-range edit canvases", () => {
  const square = png(512, 512);
  assert.deepEqual(imageDimensions(square, "image/png"), { width: 512, height: 512 });
  assert.equal(imageDimensions(square.subarray(0, 20), "image/png"), null);
  assert.equal(imageDimensions(square, "image/jpeg"), null);
  assert.equal(inpaintDimensionsAllowed({ width: 512, height: 512 }), true);
  assert.equal(inpaintDimensionsAllowed({ width: 255, height: 512 }), false);
  assert.equal(inpaintDimensionsAllowed({ width: 4096, height: 4096 }), false);
});

test("private inpaint checks ownership and dimensions before queueing, then replays exactly once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-inpaint-"));
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    MEDIA_DIR: process.env.MEDIA_DIR,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL
  };
  process.env.DATABASE_PATH = join(directory, "test.sqlite");
  process.env.MEDIA_DIR = join(directory, "media");
  process.env.BETTER_AUTH_SECRET = "inpaint-test-secret-must-have-at-least-32-characters";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.PUBLIC_BASE_URL = "https://ailoom.example.test";
  const originalFetch = globalThis.fetch;
  const { getDb, getSqlite } = await import("../src/server/db");
  const { user } = await import("../src/server/db/schema");
  const { createInvite } = await import("../src/server/auth/invites");
  const { createAsset } = await import("../src/server/content/assets");
  const { getGenerationJob } = await import("../src/server/content/jobs");
  const { savePrivateFile } = await import("../src/server/storage/private-files");
  const authRoute = await import("../src/app/api/auth/[...all]/route");
  const inpaintRoute = await import("../src/app/api/image/inpaint/route");
  const generationsRoute = await import("../src/app/api/generations/route");
  try {
    migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
    const invitation = createInvite({ email: "inpaint@example.test" });
    const signup = await authRoute.POST(new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "Inpaint Tester", email: "inpaint@example.test",
        password: "Inpaint-test-password-123!", inviteToken: invitation.token })
    }));
    assert.equal(signup.status, 200);
    const cookie = signup.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const ownerId = (await signup.json()).user.id as string;
    const otherId = randomUUID();
    const now = new Date();
    getDb().insert(user).values({ id: otherId, name: "Other", email: "inpaint-other@example.test",
      role: "user", emailVerified: true, createdAt: now, updatedAt: now }).run();
    const makeAsset = async (owner: string, bytes: Buffer) => {
      const saved = await savePrivateFile(bytes, "image/png");
      return createAsset(owner, { ...saved, source: "upload" }).id;
    };
    const sourceAssetId = await makeAsset(ownerId, png(512, 512));
    const maskAssetId = await makeAsset(ownerId, png(512, 512, true));
    const mismatchedMaskId = await makeAsset(ownerId, png(384, 512, true));
    const foreignMaskId = await makeAsset(otherId, png(512, 512, true));
    const key = randomUUID();
    const input = { sourceAssetId, maskAssetId, prompt: "Replace the central object" };
    const send = (value: unknown, requestKey: string = key, headers: Record<string, string> = {}) =>
      inpaintRoute.POST(new Request("http://localhost:3000/api/image/inpaint", {
        method: "POST", headers: { origin: "http://localhost:3000", cookie,
          "content-type": "application/json", "Idempotency-Key": requestKey, ...headers },
        body: JSON.stringify(value)
      }));
    assert.equal((await inpaintRoute.POST(new Request("http://localhost:3000/api/image/inpaint",
      { method: "POST", body: JSON.stringify(input) }))).status, 401);
    assert.equal((await send(input, key, { origin: "https://other.example.test" })).status, 403);
    assert.equal((await send(input, "bad-key")).status, 400);
    assert.equal((await send({ ...input, maskAssetId: foreignMaskId })).status, 404);
    assert.equal((await send({ ...input, maskAssetId: mismatchedMaskId })).status, 422);
    let probeCount = 0;
    globalThis.fetch = async () => { probeCount++; return new Response("x", { status: 206 }); };
    const queued = await send(input);
    assert.equal(queued.status, 202);
    const body = await queued.json();
    assert.equal(body.job.id, key);
    assert.equal(body.job.costEstimateMicrosUsd, 20_000);
    assert.equal(body.estimate.amountUsd, 0.02);
    assert.equal(probeCount, 2);
    assert.equal(JSON.stringify(body).includes("/api/assets/"), false);
    assert.equal(JSON.stringify(body).includes("token="), false);
    const stored = getGenerationJob(ownerId, key);
    assert.equal(stored?.providerModel, MODEL);
    assert.equal(stored?.kind, "edit");
    assert.ok(typeof stored?.input === "object" && stored.input !== null);
    const replayed = await send(input);
    assert.equal(replayed.status, 202);
    assert.equal((await replayed.json()).job.id, key);
    assert.equal(probeCount, 2);
    assert.equal((await send({ ...input, prompt: "Different object" })).status, 409);
    assert.equal((await send({ ...input, maskAssetId: mismatchedMaskId })).status, 409);
    const genericBody = { modelId: "wavespeed-ai/z-image/turbo", operation: "text_to_image",
      prompt: "A ceramic mug" };
    const genericRequest = (body: unknown, requestKey?: string) =>
      generationsRoute.POST(new Request("http://localhost:3000/api/generations", {
        method: "POST", headers: { origin: "http://localhost:3000", cookie,
          "content-type": "application/json", ...(requestKey ? { "Idempotency-Key": requestKey } : {}) },
        body: JSON.stringify(body)
      }));
    assert.equal((await genericRequest(genericBody)).status, 400);
    const genericKey = randomUUID();
    const firstGeneric = await genericRequest(genericBody, genericKey);
    assert.equal(firstGeneric.status, 202);
    assert.equal((await firstGeneric.json()).job.id, genericKey);
    const replayGeneric = await genericRequest(genericBody, genericKey);
    assert.equal(replayGeneric.status, 202);
    assert.equal((await replayGeneric.json()).job.id, genericKey);
    assert.equal((await genericRequest({ ...genericBody, prompt: "Another mug" }, genericKey)).status, 409);
    const raw = await generationsRoute.POST(new Request("http://localhost:3000/api/generations", {
      method: "POST", headers: { origin: "http://localhost:3000", cookie,
        "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ modelId: MODEL, operation: "image_inpaint", prompt: input.prompt,
        imageUrl: "https://assets.example.test/source.png",
        maskImageUrl: "https://assets.example.test/mask.png" })
    }));
    assert.equal(raw.status, 422);
  } finally {
    globalThis.fetch = originalFetch;
    getSqlite().close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
