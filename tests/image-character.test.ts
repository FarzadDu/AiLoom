import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mediaViewForJob } from "../src/components/media-api";
import { listMediaModels } from "../src/server/media/registry";
import { MediaRequestError, prepareMediaRequest, submitMediaRequest } from "../src/server/media/service";

const MODEL = "fal-ai/ideogram/character";
const IMAGE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9xc5EAAAAASUVORK5CYII=", "base64");

test("character mode maps the documented one-reference request and price", async () => {
  assert.deepEqual(listMediaModels("character_to_image").map(model => model.id), [MODEL]);
  const imageUrl = "https://assets.example.test/private-reference.png";
  const input = { modelId: MODEL, operation: "character_to_image", prompt: "  Same person in a new city  ",
    imageUrl, imageSize: "portrait_4_3", renderingSpeed: "QUALITY" };
  const prepared = prepareMediaRequest(input);
  assert.equal(prepared.provider, "fal");
  assert.deepEqual(prepared.providerInput, { prompt: "Same person in a new city",
    reference_image_urls: [imageUrl], image_size: "portrait_4_3",
    rendering_speed: "QUALITY", num_images: 1 });
  assert.equal(prepared.priceEstimate?.amountUsd, 0.20);
  assert.equal(prepareMediaRequest({ ...input, renderingSpeed: "BALANCED" }).priceEstimate?.amountUsd, 0.15);
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ request_id: "character_test_1" });
  };
  const submitted = await submitMediaRequest(input, { apiKeys: { fal: "test-only-key" }, fetcher });
  assert.equal(submitted.providerTaskId, "character_test_1");
  assert.deepEqual(calls, [{ url: `https://queue.fal.run/${MODEL}`, body: prepared.providerInput }]);
});

test("character mode rejects unsafe URLs, extra references and unsupported provider fields", () => {
  const input = { modelId: MODEL, operation: "character_to_image", prompt: "New scene",
    imageUrl: "https://assets.example.test/reference.webp" };
  for (const invalid of [
    { imageUrl: undefined }, { imageUrl: "http://assets.example.test/reference.webp" },
    { imageUrl: "https://127.0.0.1/private" },
    { reference_image_urls: [input.imageUrl, input.imageUrl] },
    { renderingSpeed: "TURBO" }, { prompt: " " }
  ]) {
    assert.throws(() => prepareMediaRequest({ ...input, ...invalid }),
      (error: unknown) => error instanceof MediaRequestError && error.code === "invalid_input");
  }
});

test("private character route checks ownership, replays one job and reloads in Image Studio", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-character-"));
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH, MEDIA_DIR: process.env.MEDIA_DIR,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL
  };
  process.env.DATABASE_PATH = join(directory, "test.sqlite");
  process.env.MEDIA_DIR = join(directory, "media");
  process.env.BETTER_AUTH_SECRET = "character-test-secret-must-have-at-least-32-characters";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.PUBLIC_BASE_URL = "https://ailoom.example.test";
  const originalFetch = globalThis.fetch;
  const { getDb, getSqlite } = await import("../src/server/db");
  const { user } = await import("../src/server/db/schema");
  const { createInvite } = await import("../src/server/auth/invites");
  const { createAsset } = await import("../src/server/content/assets");
  const { createProject } = await import("../src/server/content/projects");
  const { getGenerationJob } = await import("../src/server/content/jobs");
  const { refreshPrivateAssetUrls } = await import("../src/server/media/private-references");
  const { savePrivateFile } = await import("../src/server/storage/private-files");
  const authRoute = await import("../src/app/api/auth/[...all]/route");
  const characterRoute = await import("../src/app/api/image/character/route");
  const generationsRoute = await import("../src/app/api/generations/route");
  try {
    migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
    const invitation = createInvite({ email: "character@example.test" });
    const signup = await authRoute.POST(new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "Character Tester", email: "character@example.test",
        password: "Character-test-password-123!", inviteToken: invitation.token })
    }));
    assert.equal(signup.status, 200);
    const cookie = signup.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const ownerId = (await signup.json()).user.id as string;
    const otherId = randomUUID();
    const now = new Date();
    getDb().insert(user).values({ id: otherId, name: "Other", email: "character-other@example.test",
      role: "user", emailVerified: true, createdAt: now, updatedAt: now }).run();
    const project = createProject(ownerId, { name: "Character images" });
    const foreignProject = createProject(otherId, { name: "Private" });
    const makeAsset = async (owner: string, bytes: Buffer, mimeType = "image/png", sizeBytes?: number) => {
      const saved = await savePrivateFile(bytes, mimeType);
      return createAsset(owner, { ...saved, sizeBytes: sizeBytes ?? saved.sizeBytes,
        source: "upload" }).id;
    };
    const ownAssetId = await makeAsset(ownerId, IMAGE);
    const foreignAssetId = await makeAsset(otherId, IMAGE);
    const oversizeAssetId = await makeAsset(ownerId, IMAGE, "image/png", 10_000_001);
    const key = randomUUID();
    const input = { sourceAssetId: ownAssetId, prompt: "Same person walking in rain",
      imageSize: "portrait_4_3", renderingSpeed: "BALANCED", projectId: project.id };
    const send = (value: unknown, requestKey: string = key, headers: Record<string, string> = {}) =>
      characterRoute.POST(new Request("http://localhost:3000/api/image/character", {
        method: "POST", headers: { origin: "http://localhost:3000", cookie,
          "content-type": "application/json", "Idempotency-Key": requestKey, ...headers },
        body: JSON.stringify(value)
      }));
    assert.equal((await characterRoute.POST(new Request("http://localhost:3000/api/image/character", {
      method: "POST", body: JSON.stringify(input) }))).status, 401);
    assert.equal((await send(input, key, { origin: "https://other.example.test" })).status, 403);
    assert.equal((await send(input, "bad-key")).status, 400);
    assert.equal((await send({ ...input, projectId: "invalid" }, randomUUID())).status, 400);
    assert.equal((await send({ ...input, projectId: foreignProject.id }, randomUUID())).status, 404);
    assert.equal((await send({ ...input, sourceAssetId: foreignAssetId })).status, 404);
    assert.equal((await send({ ...input, sourceAssetId: oversizeAssetId })).status, 422);
    assert.equal((await send({ ...input, imageSize: "invalid" })).status, 400);
    let probeCount = 0;
    globalThis.fetch = async () => { probeCount++; return new Response("x", { status: 206 }); };
    const queued = await send(input, key.toUpperCase());
    assert.equal(queued.status, 202);
    const body = await queued.json();
    assert.equal(body.job.id, key);
    assert.equal(body.job.kind, "image");
    assert.equal(body.job.costEstimateMicrosUsd, 150_000);
    assert.equal(body.estimate.amountUsd, 0.15);
    assert.equal(probeCount, 1);
    assert.equal(JSON.stringify(body).includes("token="), false);
    assert.equal(JSON.stringify(body).includes("/api/assets/"), false);
    const stored = getGenerationJob(ownerId, key);
    assert.equal(stored?.providerModel, MODEL);
    assert.equal(stored?.kind, "image");
    assert.equal(stored?.projectId, project.id);
    assert.ok(stored?.input && typeof stored.input === "object" && "imageUrl" in stored.input);
    assert.equal("projectId" in (stored?.input as Record<string, unknown>), false);
    const originalReference = (stored.input as { imageUrl: string }).imageUrl;
    const refreshed = refreshPrivateAssetUrls(ownerId, stored.input,
      (owner, id) => owner === ownerId && id === ownAssetId) as { imageUrl: string };
    assert.notEqual(refreshed.imageUrl, originalReference);
    assert.deepEqual(prepareMediaRequest(refreshed).providerInput.reference_image_urls, [refreshed.imageUrl]);
    const listed = await generationsRoute.GET(new Request("http://localhost:3000/api/generations", {
      headers: { cookie }
    }));
    assert.equal(listed.status, 200);
    const jobs = (await listed.json()).jobs as Array<{ kind: string; providerModel: string }>;
    assert.equal(mediaViewForJob(jobs[0].kind, jobs[0].providerModel), "image");
    const replayed = await send(input);
    assert.equal(replayed.status, 202);
    assert.equal((await replayed.json()).job.id, key);
    assert.equal(probeCount, 1);
    assert.equal((await send({ ...input, prompt: "Changed scene" })).status, 409);
    assert.equal((await send({ ...input, projectId: null })).status, 409);
    assert.equal((await send({ ...input, sourceAssetId: foreignAssetId })).status, 409);
    const raw = await generationsRoute.POST(new Request("http://localhost:3000/api/generations", {
      method: "POST", headers: { origin: "http://localhost:3000", cookie,
        "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ modelId: MODEL, operation: "character_to_image", prompt: input.prompt,
        imageUrl: "https://assets.example.test/unowned.png" })
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
