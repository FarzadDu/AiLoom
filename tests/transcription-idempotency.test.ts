import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

test("transcription reserves one paid submission without retaining media or transcript", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-transcription-idempotency-"));
  const previous = { DATABASE_PATH: process.env.DATABASE_PATH,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY };
  process.env.DATABASE_PATH = join(directory, "test.sqlite");
  process.env.BETTER_AUTH_SECRET = "transcription-test-secret-at-least-thirty-two-characters";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.ELEVENLABS_API_KEY = "test-only-elevenlabs-key";
  const originalFetch = globalThis.fetch;
  const { getDb, getSqlite } = await import("../src/server/db");
  const { createInvite } = await import("../src/server/auth/invites");
  const authRoute = await import("../src/app/api/auth/[...all]/route");
  const route = await import("../src/app/api/audio/transcribe/route");
  const { getOwnedTranscriptionRequest } = await import("../src/server/content/transcription-requests");
  try {
    migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
    const signup = async (email: string) => {
      const invitation = createInvite({ email });
      const response = await authRoute.POST(new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ name: "Transcription Tester", email,
          password: "Transcription-test-password-123!", inviteToken: invitation.token })
      }));
      assert.equal(response.status, 200);
      return { cookie: response.headers.get("set-cookie")!.split(";")[0],
        id: (await response.json()).user.id as string };
    };
    const owner = await signup("transcription-owner@example.test");
    const other = await signup("transcription-other@example.test");
    const fileBytes = Buffer.from("ID3test audio data");
    const send = (cookie: string, requestId: string, options: {
      bytes?: Buffer; language?: string; diarize?: boolean
    } = {}) => {
      const form = new FormData();
      form.set("file", new File([new Uint8Array(options.bytes ?? fileBytes)], "sample.mp3", { type: "audio/mpeg" }));
      if (options.language) form.set("languageCode", options.language);
      form.set("diarize", options.diarize ? "true" : "false");
      return route.POST(new Request("http://localhost:3000/api/audio/transcribe", {
        method: "POST", headers: { cookie, origin: "http://localhost:3000",
          "Idempotency-Key": requestId }, body: form
      }));
    };
    const status = (cookie: string, requestId: string) => route.GET(new Request(
      `http://localhost:3000/api/audio/transcribe?requestId=${requestId}`, { headers: { cookie } }));
    assert.equal((await send(owner.cookie, "not-a-uuid")).status, 400);
    assert.equal((await status(other.cookie, randomUUID())).status, 404);

    const requestId = randomUUID();
    let providerCalls = 0;
    let completeProvider: ((response: Response) => void) | null = null;
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.elevenlabs.io/v1/speech-to-text");
      assert.equal(new Headers(init?.headers).get("xi-api-key"), "test-only-elevenlabs-key");
      providerCalls++;
      return new Promise<Response>(resolve => { completeProvider = resolve; });
    };
    const first = send(owner.cookie, requestId, { language: "en", diarize: true });
    for (let i = 0; i < 30 && !completeProvider; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(completeProvider);
    assert.equal((await status(owner.cookie, requestId)).status, 409);
    assert.equal((await status(other.cookie, requestId)).status, 404);
    const during = await send(owner.cookie, requestId, { language: "en", diarize: true });
    assert.equal(during.status, 409);
    assert.equal((await during.json()).status, "processing");
    assert.equal((await send(owner.cookie, requestId, { language: "fa", diarize: true })).status, 409);
    assert.equal((await send(owner.cookie, requestId, { language: "en", diarize: true,
      bytes: Buffer.from("ID3changed audio") })).status, 409);
    assert.equal((await send(other.cookie, requestId, { language: "en", diarize: true })).status, 409);
    assert.equal(providerCalls, 1);
    completeProvider!(Response.json({ text: "Private transcript", language_code: "en", words: [] }));
    const completed = await first;
    assert.equal(completed.status, 200);
    assert.equal((await completed.json()).text, "Private transcript");
    const replay = await send(owner.cookie, requestId, { language: "en", diarize: true });
    assert.equal(replay.status, 409);
    assert.equal((await replay.json()).status, "completed");
    assert.equal(providerCalls, 1);
    const row = getOwnedTranscriptionRequest(owner.id, requestId);
    assert.equal(row?.state, "succeeded");
    assert.ok(!JSON.stringify(row).includes("Private transcript"));
    assert.ok(!JSON.stringify(row).includes(fileBytes.toString("utf8")));

    globalThis.fetch = async () => { providerCalls++; throw new Error("Connection lost after provider POST"); };
    const uncertainId = randomUUID();
    const uncertain = await send(owner.cookie, uncertainId);
    assert.equal(uncertain.status, 502);
    assert.equal((await uncertain.json()).status, "uncertain");
    assert.equal((await send(owner.cookie, uncertainId)).status, 409);
    assert.equal(getOwnedTranscriptionRequest(owner.id, uncertainId)?.state, "uncertain");
    assert.equal(providerCalls, 2);

    globalThis.fetch = async () => { providerCalls++; return new Response("rate limited", { status: 429 }); };
    const rejectedId = randomUUID();
    assert.equal((await send(owner.cookie, rejectedId)).status, 429);
    assert.equal(getOwnedTranscriptionRequest(owner.id, rejectedId)?.state, "failed");
    assert.equal((await send(owner.cookie, rejectedId)).status, 409);
    assert.equal(providerCalls, 3);
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
