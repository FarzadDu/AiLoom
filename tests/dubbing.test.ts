import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";

test("Dubbing v2 client sends a prepaid target and reads fresh lossless audio", async () => {
  const { createDubbingProject, getDubbingLanguage } = await import("../src/server/providers/elevenlabs-dubbing");
  let called = 0;
  const create = await createDubbingProject({
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    sourceUrl: "https://ailoom.example.test/api/assets/source?expires=123&token=xyz",
    sourceLanguage: "en", targetLanguage: "fa", apiKey: "test-key",
    fetcher: async (url, init) => {
      called++;
      assert.equal(String(url), "https://api.elevenlabs.io/v1/dubbing/project");
      assert.equal(init?.method, "POST");
      assert.equal((init?.body as FormData).get("model_id"), "dubbing_v2");
      assert.equal((init?.body as FormData).get("target_language"), "fa");
      assert.equal((init?.body as FormData).get("source_language"), "en");
      assert.equal((init?.body as FormData).get("reference"), "Ailoom:123e4567-e89b-42d3-a456-426614174000");
      return Response.json({ project_id: "proj_test", language_ids: ["lang_test"], status: "queued" }, { status: 201 });
    }
  });
  assert.deepEqual(create, { projectId: "proj_test", languageId: "lang_test", status: "queued" });
  const language = await getDubbingLanguage({ projectId: create.projectId, languageId: create.languageId,
    apiKey: "test-key", fetcher: async (url, init) => {
      called++;
      assert.equal(String(url), "https://api.elevenlabs.io/v1/dubbing/project/proj_test/language/lang_test");
      assert.equal(init?.method, undefined);
      return Response.json({ project_id: "proj_test", language_id: "lang_test",
        status: "completed", outputs: { lossless_audio: "https://storage.googleapis.com/example/output.flac?sig=one" } });
    } });
  assert.equal(language.losslessAudioUrl, "https://storage.googleapis.com/example/output.flac?sig=one");
  assert.equal(called, 2);
});

test("dubbing request is owner-scoped, posted once, polled, and imported privately", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-dub-test-"));
  const before = { DATABASE_PATH: process.env.DATABASE_PATH, MEDIA_DIR: process.env.MEDIA_DIR,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET, BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL, ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY };
  process.env.DATABASE_PATH = join(directory, "test.sqlite");
  process.env.MEDIA_DIR = join(directory, "media");
  process.env.BETTER_AUTH_SECRET = "dubbing-test-secret-must-have-at-least-32-characters";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.PUBLIC_BASE_URL = "https://ailoom.example.test";
  process.env.ELEVENLABS_API_KEY = "test-key";
  const { getDb, getSqlite } = await import("../src/server/db");
  const { dubbingJob } = await import("../src/server/db/schema");
  const { createInvite } = await import("../src/server/auth/invites");
  const { createAsset, getOwnedAsset } = await import("../src/server/content/assets");
  const { getOwnedDubbingJob } = await import("../src/server/content/dubbing");
  const { savePrivateFile } = await import("../src/server/storage/private-files");
  const { runDubbingWorkerCycle } = await import("../src/server/dubbing/worker");
  const authRoute = await import("../src/app/api/auth/[...all]/route");
  const dubRoute = await import("../src/app/api/audio/dubbing/route");
  const dubDetailRoute = await import("../src/app/api/audio/dubbing/[id]/route");
  const refreshRoute = await import("../src/app/api/audio/dubbing/[id]/refresh/route");
  const assetRoute = await import("../src/app/api/assets/[id]/route");
  try {
    migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
    async function signUp(email: string) {
      const invitation = createInvite({ email });
      const result = await authRoute.POST(new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ name: "Dub Tester", email, password: "Dubbing-test-password-123!",
          inviteToken: invitation.token })
      }));
      assert.equal(result.status, 200);
      const cookie = result.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      return { cookie, ownerId: (await result.json()).user.id as string };
    }
    const owner = await signUp("dubbing-owner@example.test");
    const other = await signUp("dubbing-other@example.test");
    const sourceFile = await savePrivateFile(Buffer.from("RIFF0000WAVEfmt "), "audio/wav");
    const source = createAsset(owner.ownerId, { ...sourceFile, source: "upload", originalName: "recording.wav" });
    const id = randomUUID();
    const post = (cookie: string, key = id, targetLanguage = "fa", sourceAssetId = source.id) =>
      dubRoute.POST(new Request("http://localhost:3000/api/audio/dubbing", { method: "POST",
        headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json",
          "Idempotency-Key": key },
        body: JSON.stringify({ sourceAssetId, sourceLanguage: "en", targetLanguage }) }));
    assert.equal((await dubRoute.POST(new Request("http://localhost:3000/api/audio/dubbing",
      { method: "POST" }))).status, 401);
    assert.equal((await post(other.cookie)).status, 404);
    assert.equal((await post(owner.cookie)).status, 202);
    assert.equal((await post(owner.cookie)).status, 200);
    assert.equal((await post(owner.cookie, id, "es")).status, 409);
    assert.equal((await dubDetailRoute.GET(new Request(`http://localhost:3000/api/audio/dubbing/${id}`,
      { headers: { cookie: other.cookie } }), { params: Promise.resolve({ id }) })).status, 404);
    let createCalls = 0;
    await runDubbingWorkerCycle({ preflight: async url => {
      assert.match(url, /^https:\/\/ailoom\.example\.test\/api\/assets\//);
      return true;
    }, createProject: async options => {
      createCalls++;
      assert.equal(options.targetLanguage, "fa");
      return { projectId: "proj_test", languageId: "lang_test", status: "queued" };
    }, getProject: async () => ({ status: "ready", languageIds: ["lang_test"] }),
    getLanguage: async () => ({ status: "queued", losslessAudioUrl: null }),
    importMedia: async () => { throw new Error("Not ready"); } });
    assert.equal(createCalls, 1);
    assert.equal(getOwnedDubbingJob(owner.ownerId, id)?.state, "running");
    assert.equal((await post(owner.cookie)).status, 200);
    getDb().update(dubbingJob).set({ nextPollAt: new Date(Date.now() - 1000) })
      .where(eq(dubbingJob.id, id)).run();
    let imports = 0;
    await runDubbingWorkerCycle({ getProject: async () => ({ status: "ready", languageIds: ["lang_test"] }),
      getLanguage: async () => ({ status: "completed",
        losslessAudioUrl: "https://storage.googleapis.com/example/output.flac?fresh=one" }),
      importMedia: async (url, kind) => {
        imports++;
        assert.equal(url, "https://storage.googleapis.com/example/output.flac?fresh=one");
        assert.equal(kind, "audio");
        return savePrivateFile(Buffer.from("fLaC\x00\x00\x00\x00"), "audio/flac");
      } });
    assert.equal(createCalls, 1);
    assert.equal(imports, 1);
    const ready = getOwnedDubbingJob(owner.ownerId, id);
    assert.equal(ready?.state, "ready", ready?.errorCode ?? "");
    const output = getOwnedAsset(owner.ownerId, ready!.outputAssetId!);
    assert.equal(output?.mimeType, "audio/flac");
    assert.equal(output?.visibility, "private");
    assert.equal((await assetRoute.GET(new Request(`http://localhost:3000/api/assets/${output!.id}`),
      { params: Promise.resolve({ id: output!.id }) })).status, 404);
    assert.equal((await assetRoute.GET(new Request(`http://localhost:3000/api/assets/${output!.id}`,
      { headers: { cookie: other.cookie } }), { params: Promise.resolve({ id: output!.id }) })).status, 404);
    assert.equal((await assetRoute.GET(new Request(`http://localhost:3000/api/assets/${output!.id}`,
      { headers: { cookie: owner.cookie } }), { params: Promise.resolve({ id: output!.id }) })).status, 200);

    const uncertainId = randomUUID();
    assert.equal((await post(owner.cookie, uncertainId, "es")).status, 202);
    await runDubbingWorkerCycle({ preflight: async () => true,
      createProject: async () => { createCalls++; throw new Error("timeout after provider accepted"); } });
    assert.equal(getOwnedDubbingJob(owner.ownerId, uncertainId)?.state, "uncertain");
    assert.equal((await post(owner.cookie, uncertainId, "es")).status, 200);
    await runDubbingWorkerCycle({ createProject: async () => { createCalls++; throw new Error("reposted"); } });
    assert.equal(createCalls, 2, "uncertain paid POST must never be resubmitted");
    const originalFetch = globalThis.fetch;
    let providerReads = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      providerReads++;
      if (url.startsWith("https://api.elevenlabs.io/v1/dubbing/project?")) {
        return Response.json({ projects: [{ project_id: "proj_recovered",
          reference: `Ailoom:${uncertainId}` }], next_cursor: null });
      }
      if (url === "https://api.elevenlabs.io/v1/dubbing/project/proj_recovered") {
        return Response.json({ project_id: "proj_recovered", status: "ready",
          language_ids: ["lang_recovered"] });
      }
      throw new Error(`Unexpected provider read: ${url}`);
    }) as typeof fetch;
    try {
      const refresh = (cookie: string) => refreshRoute.POST(new Request(
        `http://localhost:3000/api/audio/dubbing/${uncertainId}/refresh`, {
          method: "POST", headers: { cookie, origin: "http://localhost:3000" }
        }), { params: Promise.resolve({ id: uncertainId }) });
      assert.equal((await refresh(other.cookie)).status, 404);
      assert.equal(providerReads, 0);
      assert.equal((await refresh(owner.cookie)).status, 200);
      assert.equal(providerReads, 2);
      assert.equal(getOwnedDubbingJob(owner.ownerId, uncertainId)?.state, "running");
      assert.equal(createCalls, 2, "recovery uses provider GETs, never another POST");
    } finally { globalThis.fetch = originalFetch; }
  } finally {
    getSqlite().close();
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
