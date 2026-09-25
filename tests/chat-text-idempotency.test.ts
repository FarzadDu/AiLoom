import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

test("text chat reserves a paid turn once, replays its saved answer, and blocks uncertain retries", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-chat-text-"));
  const previous = { DATABASE_PATH: process.env.DATABASE_PATH,
    MEDIA_DIR: process.env.MEDIA_DIR, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL, PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY };
  process.env.DATABASE_PATH = join(directory, "test.sqlite");
  process.env.MEDIA_DIR = join(directory, "media");
  process.env.BETTER_AUTH_SECRET = "chat-text-test-secret-at-least-thirty-two-characters";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.OPENROUTER_API_KEY = "test-only-openrouter-key";
  const originalFetch = globalThis.fetch;
  const { getDb, getSqlite } = await import("../src/server/db");
  const { createInvite } = await import("../src/server/auth/invites");
  const { appendMessage, createConversation, listMessages } = await import("../src/server/content/chat");
  const { createAsset } = await import("../src/server/content/assets");
  const { savePrivateFile } = await import("../src/server/storage/private-files");
  const authRoute = await import("../src/app/api/auth/[...all]/route");
  const chatRoute = await import("../src/app/api/chat/route");
  try {
    migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
    const signup = async (email: string) => {
      const invitation = createInvite({ email });
      const response = await authRoute.POST(new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ name: "Text Tester", email,
          password: "Text-test-password-123!", inviteToken: invitation.token })
      }));
      assert.equal(response.status, 200);
      return { cookie: response.headers.get("set-cookie")!.split(";")[0],
        id: (await response.json()).user.id as string };
    };
    const owner = await signup("text-owner@example.test");
    const other = await signup("text-other@example.test");
    const requestId = randomUUID();
    const body = { requestId, text: "Say hello", model: "openrouter/auto" };
    const send = (cookie: string, payload: unknown) => chatRoute.POST(new Request("http://localhost:3000/api/chat", {
      method: "POST", headers: { cookie, origin: "http://localhost:3000",
        "content-type": "application/json" }, body: JSON.stringify(payload)
    }));
    const status = (cookie: string, id = requestId) => chatRoute.GET(
      new Request(`http://localhost:3000/api/chat?requestId=${id}`, { headers: { cookie } }));
    assert.equal((await send(owner.cookie, { text: "No request ID" })).status, 400);
    assert.equal((await status(other.cookie)).status, 404);
    let providerCalls = 0;
    let completeProvider: ((response: Response) => void) | null = null;
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-only-openrouter-key");
      providerCalls++;
      return new Promise<Response>(resolve => { completeProvider = resolve; });
    };
    const first = send(owner.cookie, body);
    for (let i = 0; i < 30 && !completeProvider; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(completeProvider);
    assert.equal((await status(owner.cookie)).status, 200);
    assert.equal((await status(owner.cookie).then(response => response.json())).status, "processing");
    assert.equal((await send(owner.cookie, body)).status, 202);
    assert.equal((await send(owner.cookie, { ...body, text: "Changed" })).status, 409);
    assert.equal(providerCalls, 1);
    completeProvider!(new Response(
      'data: {"choices":[{"delta":{"content":"Hello from model"}}]}\n\ndata: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } }));
    const streamed = await first;
    assert.equal(streamed.status, 200);
    const events = await streamed.text();
    assert.match(events, /event: done/);
    const saved = await (await status(owner.cookie)).json();
    assert.equal(saved.status, "completed");
    assert.equal(saved.answer, "Hello from model");
    assert.ok(saved.conversationId);
    assert.ok(saved.userMessageId);
    assert.ok(saved.assistantMessageId);
    assert.equal(listMessages(owner.id, saved.conversationId)?.length, 2);
    const replay = await send(owner.cookie, body);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).answer, "Hello from model");
    assert.equal(providerCalls, 1);

    const interrupted = { requestId: randomUUID(), conversationId: saved.conversationId,
      text: "A partial reply", model: "openrouter/auto" };
    globalThis.fetch = async () => {
      providerCalls++;
      return new Response('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n',
        { headers: { "content-type": "text/event-stream" } });
    };
    const interruptedResponse = await send(owner.cookie, interrupted);
    assert.equal(interruptedResponse.status, 200);
    assert.match(await interruptedResponse.text(), /event: error/);
    assert.equal((await (await status(owner.cookie, interrupted.requestId)).json()).status, "uncertain");
    const interruptedCount = providerCalls;
    assert.equal((await send(owner.cookie, interrupted)).status, 409);
    assert.equal(providerCalls, interruptedCount);

    globalThis.fetch = async () => { providerCalls++; throw new Error("Connection lost after POST"); };
    const uncertain = { ...body, requestId: randomUUID(), text: "Another turn" };
    assert.equal((await send(owner.cookie, uncertain)).status, 502);
    const uncertainStatus = await (await status(owner.cookie, uncertain.requestId)).json();
    assert.equal(uncertainStatus.status, "uncertain");
    const callCount = providerCalls;
    assert.equal((await send(owner.cookie, uncertain)).status, 409);
    assert.equal(providerCalls, callCount);
    assert.equal((await status(other.cookie, uncertain.requestId)).status, 404);

    const attachmentConversation = createConversation(owner.id);
    for (let index = 1; index <= 3; index++) {
      const bytes = Buffer.alloc(7_000_000, index);
      bytes.write("%PDF-", 0, "ascii");
      const stored = await savePrivateFile(bytes, "application/pdf");
      const asset = createAsset(owner.id, { ...stored, source: "upload",
        originalName: `reference-${index}.pdf` });
      appendMessage(owner.id, attachmentConversation.id, { role: "user", blocks: [
        { type: "text", text: `Prior question ${index}` },
        { type: "file", assetId: asset.id }
      ] });
      appendMessage(owner.id, attachmentConversation.id, { role: "assistant",
        blocks: [{ type: "text", text: `Prior answer ${index}` }] });
    }
    let providerMessages: Array<{ role: string; content: unknown }> = [];
    globalThis.fetch = async (_url, init) => {
      providerCalls++;
      const body = JSON.parse(String(init?.body)) as { messages: typeof providerMessages };
      providerMessages = body.messages;
      return new Response('data: {"choices":[{"delta":{"content":"Follow-up answered"}}]}\n\ndata: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" } });
    };
    const followUp = await send(owner.cookie, { requestId: randomUUID(),
      conversationId: attachmentConversation.id, text: "A text-only follow-up" });
    assert.equal(followUp.status, 200);
    assert.match(await followUp.text(), /event: done/);
    const questions = providerMessages.filter(message => message.role === "user");
    assert.equal(questions.length, 4);
    for (let index = 1; index <= 3; index++) {
      assert.ok(questions.some(message => JSON.stringify(message.content).includes(`Prior question ${index}`)));
    }
    assert.equal(questions.at(-1)?.content, "A text-only follow-up");
    const attachedNames = questions.flatMap(message => Array.isArray(message.content)
      ? message.content.filter((part): part is { type: "file"; file: { filename: string } } =>
        !!part && typeof part === "object" && part.type === "file")
        .map(part => part.file.filename) : []);
    assert.deepEqual(attachedNames, ["reference-2.pdf", "reference-3.pdf"]);

    const currentBytes = Buffer.alloc(8_000_000, 4);
    currentBytes.write("%PDF-", 0, "ascii");
    const currentStored = await savePrivateFile(currentBytes, "application/pdf");
    const currentAsset = createAsset(owner.id, { ...currentStored, source: "upload",
      originalName: "current.pdf" });
    const withAttachment = await send(owner.cookie, { requestId: randomUUID(),
      conversationId: attachmentConversation.id, text: "Check this new file",
      attachmentIds: [currentAsset.id] });
    assert.equal(withAttachment.status, 200);
    assert.match(await withAttachment.text(), /event: done/);
    const followUpFiles = providerMessages.flatMap(message => Array.isArray(message.content)
      ? message.content.filter((part): part is { type: "file"; file: { filename: string } } =>
        !!part && typeof part === "object" && part.type === "file")
        .map(part => part.file.filename) : []);
    assert.deepEqual(followUpFiles, ["reference-3.pdf", "current.pdf"]);
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
