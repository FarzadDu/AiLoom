import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9xc5EAAAAASUVORK5CYII=", "base64");

test("chat images reserve a paid request once, replay a private result, and never retry an uncertain POST", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-chat-image-"));
  const previous = { DATABASE_PATH: process.env.DATABASE_PATH,
    MEDIA_DIR: process.env.MEDIA_DIR, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL, PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY };
  process.env.DATABASE_PATH = join(directory, "test.sqlite");
  process.env.MEDIA_DIR = join(directory, "media");
  process.env.BETTER_AUTH_SECRET = "chat-image-test-secret-at-least-thirty-two-characters";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.OPENROUTER_API_KEY = "test-only-openrouter-key";
  const originalFetch = globalThis.fetch;
  const { getDb, getSqlite } = await import("../src/server/db");
  const { createInvite } = await import("../src/server/auth/invites");
  const { getConversation, listMessages } = await import("../src/server/content/chat");
  const { createProject } = await import("../src/server/content/projects");
  const authRoute = await import("../src/app/api/auth/[...all]/route");
  const imageRoute = await import("../src/app/api/chat/images/route");
  try {
    migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
    const signup = async (email: string) => {
      const invitation = createInvite({ email });
      const response = await authRoute.POST(new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ name: "Image Tester", email,
          password: "Image-test-password-123!", inviteToken: invitation.token })
      }));
      assert.equal(response.status, 200);
      return { cookie: response.headers.get("set-cookie")!.split(";")[0],
        id: (await response.json()).user.id as string };
    };
    const owner = await signup("image-owner@example.test");
    const other = await signup("image-other@example.test");
    const project = createProject(owner.id, { name: "Private project" });
    const requestId = randomUUID();
    const body = { requestId, projectId: project.id, prompt: "A luminous blue thread",
      model: "google/gemini-3.1-flash-image" };
    const send = (cookie: string, payload: unknown) => imageRoute.POST(
      new Request("http://localhost:3000/api/chat/images", {
        method: "POST", headers: { cookie, origin: "http://localhost:3000",
          "content-type": "application/json" }, body: JSON.stringify(payload)
      }));
    const status = (cookie: string, id = requestId) => imageRoute.GET(
      new Request(`http://localhost:3000/api/chat/images?requestId=${id}`,
        { headers: { cookie } }));
    assert.equal((await send(other.cookie, body)).status, 404);
    assert.equal((await status(other.cookie)).status, 404);
    let providerCalls = 0;
    let completeProvider: ((value: Response) => void) | null = null;
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/images");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-only-openrouter-key");
      assert.equal(JSON.stringify(init?.body).includes(project.id), false);
      providerCalls++;
      return await new Promise<Response>(resolve => { completeProvider = resolve; });
    };
    const first = send(owner.cookie, body);
    for (let i = 0; i < 30 && !completeProvider; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(completeProvider);
    assert.equal((await status(owner.cookie)).status, 202);
    assert.equal((await send(owner.cookie, body)).status, 202);
    assert.equal((await send(owner.cookie, { ...body, prompt: "Changed" })).status, 409);
    assert.equal(providerCalls, 1);
    completeProvider!(Response.json({ data: [{ b64_json: PNG.toString("base64"), media_type: "image/png" }],
      usage: { cost: 0.02 } }));
    const created = await first;
    assert.equal(created.status, 201, JSON.stringify(await created.clone().json()));
    const result = await created.json();
    assert.equal(result.assets.length, 1);
    assert.equal(getConversation(owner.id, result.conversationId)?.projectId, project.id);
    assert.equal(listMessages(owner.id, result.conversationId)?.length, 2);
    assert.equal((await status(other.cookie)).status, 404);
    const replay = await send(owner.cookie, body);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), result);
    const recovered = await status(owner.cookie);
    assert.equal(recovered.status, 200);
    assert.deepEqual(await recovered.json(), result);
    assert.equal(providerCalls, 1);
    assert.equal(listMessages(owner.id, result.conversationId)?.length, 2);

    const uncertainId = randomUUID();
    globalThis.fetch = async () => { providerCalls++; throw new Error("Connection lost after send"); };
    const uncertainBody = { ...body, requestId: uncertainId, prompt: "Maybe generated" };
    const uncertain = await send(owner.cookie, uncertainBody);
    assert.equal(uncertain.status, 502);
    assert.equal((await uncertain.json()).status, "uncertain");
    const callCount = providerCalls;
    assert.equal((await send(owner.cookie, uncertainBody)).status, 409);
    assert.equal((await status(owner.cookie, uncertainId)).status, 409);
    assert.equal(providerCalls, callCount);
  } finally {
    globalThis.fetch = originalFetch;
    getSqlite().close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
