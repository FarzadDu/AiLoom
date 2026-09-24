import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const directory = mkdtempSync(join(tmpdir(), "ailoom-export-test-"));
process.env.DATABASE_PATH = join(directory, "test.sqlite");
const { getDb, getSqlite } = await import("../src/server/db");
const { user } = await import("../src/server/db/schema");
const { accountExport } = await import("../src/server/content/account-export");
const chat = await import("../src/server/content/chat");
const assets = await import("../src/server/content/assets");
const projects = await import("../src/server/content/projects");
const templates = await import("../src/server/content/templates");
const jobs = await import("../src/server/content/jobs");

migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
const alice = randomUUID();
const bob = randomUUID();
const now = new Date();
getDb().insert(user).values([
  { id: alice, name: "Alice", email: "alice@example.test", createdAt: now, updatedAt: now },
  { id: bob, name: "Bob", email: "bob@example.test", createdAt: now, updatedAt: now }
]).run();

after(() => { getSqlite().close(); rmSync(directory, { recursive: true, force: true }); });

test("account export includes owned content but never other accounts or private storage paths", () => {
  const project = projects.createProject(alice, { name: "Alice project" });
  const aliceConversation = chat.createConversation(alice, { title: "Alice private chat", projectId: project.id });
  chat.appendMessage(alice, aliceConversation.id, { role: "user", blocks: [{ type: "text", text: "Alice secret thought" }] });
  const bobConversation = chat.createConversation(bob, { title: "Bob private chat" });
  chat.appendMessage(bob, bobConversation.id, { role: "user", blocks: [{ type: "text", text: "Bob secret thought" }] });
  const aliceAsset = assets.createAsset(alice, { kind: "image", source: "upload", mimeType: "image/png",
    sizeBytes: 123, storageKey: "uploads/alice-private.png" });
  assets.createAsset(bob, { kind: "image", source: "upload", mimeType: "image/png",
    sizeBytes: 123, storageKey: "uploads/bob-private.png" });
  templates.createExploreTemplate(alice, { title: "Alice workflow", description: "Private draft", category: "Image",
    definition: { version: 1, inputs: [], steps: [{ id: "make", title: "Make", kind: "image", prompt: "A tree" }] } });
  jobs.createGenerationJob(alice, { kind: "image", provider: "fal", providerModel: "fal-ai/flux-2-pro",
    payload: { prompt: "Blue clouds", imageUrl: "https://example.test/private?token=secret" } });

  const exported = accountExport(alice);
  assert.ok(exported);
  assert.equal(exported.owner.email, "alice@example.test");
  assert.equal(exported.projects.length, 1);
  assert.equal(exported.conversations.length, 1);
  assert.equal(exported.messages.length, 1);
  assert.equal(exported.assets.length, 1);
  assert.equal(exported.assets[0].downloadPath, `/api/assets/${aliceAsset.id}`);
  assert.equal(exported.templates.length, 1);
  assert.equal(exported.jobs[0].prompt, "Blue clouds");
  const serialized = JSON.stringify(exported);
  assert.match(serialized, /Alice secret thought/);
  assert.doesNotMatch(serialized, /Bob secret thought|Bob private chat|bob-private|alice-private\.png|password|tokenHash|token=secret/);
  assert.equal(accountExport(randomUUID()), null);
});
