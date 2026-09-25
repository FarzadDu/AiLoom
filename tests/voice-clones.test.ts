import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createInstantVoice, findInstantVoiceByExactName, getInstantVoiceVerification,
  synthesizeSpeech } from "../src/server/providers/elevenlabs";

const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04]);

test("ElevenLabs clone and speech adapters use the documented endpoints and fields", async () => {
  const calls: Array<{ url: string; body: unknown; headers: Headers }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body,
      headers: new Headers(init?.headers) });
    return String(url).endsWith("/v1/voices/add")
      ? Response.json({ voice_id: "VoiceTest123", requires_verification: false })
      : new Response(MP3);
  };
  const created = await createInstantVoice({ name: "Test · Ailoom 12345678", bytes: MP3,
    filename: "sample.mp3", mimeType: "audio/mpeg", apiKey: "test-key", fetcher });
  assert.deepEqual(created, { voiceId: "VoiceTest123", requiresVerification: false });
  assert.equal(calls[0].url, "https://api.elevenlabs.io/v1/voices/add");
  assert.equal(calls[0].headers.get("xi-api-key"), "test-key");
  assert.equal(calls[0].headers.has("content-type"), false);
  const form = calls[0].body as FormData;
  assert.equal(form.get("name"), "Test · Ailoom 12345678");
  assert.equal(form.getAll("files[]").length, 1);
  assert.equal((form.get("files[]") as File).name, "sample.mp3");
  const audio = await synthesizeSpeech({ text: "سلام", voiceId: created.voiceId,
    modelId: "eleven_v3", apiKey: "test-key", fetcher });
  assert.deepEqual(audio, MP3);
  assert.equal(calls[1].url, "https://api.elevenlabs.io/v1/text-to-speech/VoiceTest123?output_format=mp3_44100_128");
  assert.deepEqual(JSON.parse(String(calls[1].body)), { text: "سلام", model_id: "eleven_v3" });
});

test("provider voice checks use read-only endpoints and require an exact unique match", async () => {
  const calls: string[] = [];
  const name = "My voice · Ailoom 12345678";
  const fetcher: typeof fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.method ?? "GET", "GET");
    assert.equal(new Headers(init?.headers).get("xi-api-key"), "test-key");
    if (String(url).includes("/v2/voices")) {
      return Response.json({ voices: [
        { voice_id: "WrongVoice", name: "Other voice", category: "cloned" },
        { voice_id: "ExactVoice", name, category: "cloned" }
      ], has_more: false });
    }
    return Response.json({ voice_id: "ExactVoice",
      voice_verification: { requires_verification: true, is_verified: true } });
  };
  assert.equal(await findInstantVoiceByExactName({ name, apiKey: "test-key", fetcher }), "ExactVoice");
  assert.equal(await getInstantVoiceVerification({ voiceId: "ExactVoice", apiKey: "test-key", fetcher }), "ready");
  assert.match(calls[0], /\/v2\/voices\?page_size=100&category=cloned&search=/);
  assert.equal(calls[1], "https://api.elevenlabs.io/v1/voices/ExactVoice");
  await assert.rejects(findInstantVoiceByExactName({ name, apiKey: "test-key", fetcher: async () =>
    Response.json({ voices: [
      { voice_id: "FirstVoice", name }, { voice_id: "SecondVoice", name }
    ], has_more: false }) }), /Several provider voices/);
});

test("voice API is private, consent-gated and never repeats an uncertain provider POST", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-voice-"));
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH, MEDIA_DIR: process.env.MEDIA_DIR,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY
  };
  process.env.DATABASE_PATH = join(directory, "test.sqlite");
  process.env.MEDIA_DIR = join(directory, "media");
  process.env.BETTER_AUTH_SECRET = "voice-clone-test-secret-must-have-at-least-32-characters";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.PUBLIC_BASE_URL = "https://ailoom.example.test";
  process.env.ELEVENLABS_API_KEY = "test-only-key";
  const originalFetch = globalThis.fetch;
  const { getDb, getSqlite } = await import("../src/server/db");
  const { createInvite } = await import("../src/server/auth/invites");
  const { getOwnedAsset } = await import("../src/server/content/assets");
  const { getOwnedVoiceClone, getOwnedVoiceSpeech } = await import("../src/server/content/voice-clones");
  const authRoute = await import("../src/app/api/auth/[...all]/route");
  const voicesRoute = await import("../src/app/api/audio/voices/route");
  const speechRoute = await import("../src/app/api/audio/voices/[id]/speech/route");
  const refreshRoute = await import("../src/app/api/audio/voices/[id]/refresh/route");
  const speechListRoute = await import("../src/app/api/audio/voices/speech/route");
  const assetRoute = await import("../src/app/api/assets/[id]/route");
  const signup = async (email: string) => {
    const invitation = createInvite({ email });
    const response = await authRoute.POST(new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "Voice Tester", email,
        password: "Voice-test-password-123!", inviteToken: invitation.token })
    }));
    assert.equal(response.status, 200);
    return { cookie: response.headers.get("set-cookie")!.split(";")[0],
      id: (await response.json()).user.id as string };
  };
  const cloneForm = (name = "My voice", consent = true) => {
    const form = new FormData();
    form.set("name", name); form.set("file", new File([MP3], "voice.mp3", { type: "audio/mpeg" }));
    form.set("consent", String(consent));
    return form;
  };
  try {
    migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
    const owner = await signup("voice@example.test");
    const other = await signup("other-voice@example.test");
    const cloneKey = randomUUID();
    const sendClone = (cookie: string, key: string, form: FormData, origin = "http://localhost:3000") =>
      voicesRoute.POST(new Request("http://localhost:3000/api/audio/voices", {
        method: "POST", headers: { cookie, origin, "Idempotency-Key": key }, body: form
      }));
    assert.equal((await voicesRoute.GET(new Request("http://localhost:3000/api/audio/voices"))).status, 401);
    assert.equal((await sendClone(owner.cookie, cloneKey, cloneForm(), "https://evil.example.test")).status, 403);
    assert.equal((await sendClone(owner.cookie, cloneKey, cloneForm("My voice", false))).status, 400);
    assert.equal((await sendClone(owner.cookie, "bad-key", cloneForm())).status, 400);
    let cloneCalls = 0;
    let speechCalls = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/v1/voices/add")) {
        cloneCalls++;
        assert.equal(new Headers(init?.headers).get("xi-api-key"), "test-only-key");
        return Response.json({ voice_id: "OwnedVoice123", requires_verification: false });
      }
      speechCalls++;
      return new Response(MP3);
    };
    const created = await sendClone(owner.cookie, cloneKey, cloneForm());
    assert.equal(created.status, 201);
    const voice = (await created.json()).voice as { id: string; state: string };
    assert.equal(voice.id, cloneKey);
    assert.equal(voice.state, "ready");
    assert.equal(JSON.stringify(voice).includes("sampleHash"), false);
    assert.equal(cloneCalls, 1);
    assert.equal((await sendClone(owner.cookie, cloneKey, cloneForm())).status, 200);
    assert.equal(cloneCalls, 1);
    assert.equal((await sendClone(owner.cookie, cloneKey, cloneForm("Different voice"))).status, 409);
    assert.equal(getOwnedVoiceClone(other.id, cloneKey), null);
    const otherList = await voicesRoute.GET(new Request("http://localhost:3000/api/audio/voices", {
      headers: { cookie: other.cookie }
    }));
    assert.deepEqual((await otherList.json()).voices, []);
    const speechKey = randomUUID();
    const speechContext = { params: Promise.resolve({ id: cloneKey }) };
    const sendSpeech = (cookie: string, key: string, text: string) => speechRoute.POST(
      new Request(`http://localhost:3000/api/audio/voices/${cloneKey}/speech`, {
        method: "POST", headers: { cookie, origin: "http://localhost:3000",
          "content-type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ text })
      }), speechContext);
    assert.equal((await sendSpeech(other.cookie, speechKey, "Hello")).status, 404);
    const spoken = await sendSpeech(owner.cookie, speechKey, "سلام");
    assert.equal(spoken.status, 201);
    const speech = (await spoken.json()).speech as { id: string; state: string; outputUrl: string };
    assert.equal(speech.state, "ready");
    assert.match(speech.outputUrl, /^\/api\/assets\/[0-9a-f-]{36}$/);
    assert.equal(speechCalls, 1);
    assert.equal(getOwnedVoiceSpeech(other.id, speechKey), null);
    const assetId = speech.outputUrl.split("/").at(-1)!;
    assert.equal(getOwnedAsset(owner.id, assetId)?.visibility, "private");
    assert.equal(getOwnedAsset(other.id, assetId), null);
    const assetContext = { params: Promise.resolve({ id: assetId }) };
    assert.equal((await assetRoute.GET(new Request(`http://localhost:3000${speech.outputUrl}`), assetContext)).status, 404);
    assert.equal((await assetRoute.GET(new Request(`http://localhost:3000${speech.outputUrl}`,
      { headers: { cookie: other.cookie } }), assetContext)).status, 404);
    const ownedAudio = await assetRoute.GET(new Request(`http://localhost:3000${speech.outputUrl}`,
      { headers: { cookie: owner.cookie } }), assetContext);
    assert.equal(ownedAudio.status, 200);
    assert.deepEqual(Buffer.from(await ownedAudio.arrayBuffer()), MP3);
    assert.equal((await sendSpeech(owner.cookie, speechKey, "سلام")).status, 200);
    assert.equal(speechCalls, 1);
    assert.equal((await sendSpeech(owner.cookie, speechKey, "Different text")).status, 409);
    const list = await speechListRoute.GET(new Request("http://localhost:3000/api/audio/voices/speech", {
      headers: { cookie: owner.cookie }
    }));
    assert.equal((await list.json()).speech[0].outputUrl, speech.outputUrl);

    const uncertainKey = randomUUID();
    globalThis.fetch = async () => { cloneCalls++; throw new Error("network dropped after send"); };
    const uncertain = await sendClone(owner.cookie, uncertainKey, cloneForm("Uncertain voice"));
    assert.equal(uncertain.status, 502);
    assert.equal(getOwnedVoiceClone(owner.id, uncertainKey)?.state, "uncertain");
    const afterUncertain = cloneCalls;
    assert.equal((await sendClone(owner.cookie, uncertainKey, cloneForm("Uncertain voice"))).status, 202);
    assert.equal(cloneCalls, afterUncertain);

    const refreshContext = (id: string) => ({ params: Promise.resolve({ id }) });
    const sendRefresh = (cookie: string, id: string, origin = "http://localhost:3000") =>
      refreshRoute.POST(new Request(`http://localhost:3000/api/audio/voices/${id}/refresh`, {
        method: "POST", headers: { cookie, origin }
      }), refreshContext(id));
    assert.equal((await sendRefresh(other.cookie, uncertainKey)).status, 404);
    assert.equal((await sendRefresh(owner.cookie, uncertainKey, "https://evil.example.test")).status, 403);
    assert.equal((await refreshRoute.POST(new Request(
      `http://localhost:3000/api/audio/voices/${uncertainKey}/refresh`, { method: "POST" }),
    refreshContext(uncertainKey))).status, 401);
    const exactName = getOwnedVoiceClone(owner.id, uncertainKey)!.providerName;
    let readCalls = 0;
    globalThis.fetch = async (url, init) => {
      readCalls++;
      assert.equal(init?.method ?? "GET", "GET");
      if (String(url).includes("/v2/voices")) return Response.json({
        voices: [{ voice_id: "RecoveredVoice123", name: exactName, category: "cloned" }], has_more: false
      });
      if (String(url).endsWith("/v1/voices/RecoveredVoice123")) return Response.json({
        voice_id: "RecoveredVoice123",
        voice_verification: { requires_verification: false, is_verified: true }
      });
      throw new Error("Unexpected provider endpoint");
    };
    const recovered = await sendRefresh(owner.cookie, uncertainKey);
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).voice.state, "ready");
    assert.equal(getOwnedVoiceClone(owner.id, uncertainKey)?.providerVoiceId, "RecoveredVoice123");
    assert.equal(readCalls, 2);
    assert.equal(cloneCalls, afterUncertain);

    const verifyKey = randomUUID();
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/v1/voices/add")) return Response.json({
        voice_id: "VerifyVoice123", requires_verification: true
      });
      if (String(url).endsWith("/v1/voices/VerifyVoice123")) return Response.json({
        voice_id: "VerifyVoice123", voice_verification: { requires_verification: true, is_verified: true }
      });
      throw new Error("Unexpected provider endpoint");
    };
    const needsVerification = await sendClone(owner.cookie, verifyKey, cloneForm("Verify voice"));
    assert.equal((await needsVerification.json()).voice.state, "verification_required");
    const verified = await sendRefresh(owner.cookie, verifyKey);
    assert.equal((await verified.json()).voice.state, "ready");
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
