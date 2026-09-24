import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const directory = mkdtempSync(join(tmpdir(), "ailoom-content-test-"));
process.env.DATABASE_PATH = join(directory, "test.sqlite");
const { getDb, getSqlite } = await import("../src/server/db");
const { user } = await import("../src/server/db/schema");
const chat = await import("../src/server/content/chat");
const assets = await import("../src/server/content/assets");
const jobs = await import("../src/server/content/jobs");
const projects = await import("../src/server/content/projects");
const preferences = await import("../src/server/content/preferences");
const templates = await import("../src/server/content/templates");
const specialists = await import("../src/server/content/specialists");

migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
const alice = randomUUID();
const bob = randomUUID();
const now = new Date();
getDb().insert(user).values([
  { id: alice, name: "Alice", email: "alice@example.test", role: "admin", emailVerified: true, createdAt: now, updatedAt: now },
  { id: bob, name: "Bob", email: "bob@example.test", role: "user", emailVerified: true, createdAt: now, updatedAt: now }
]).run();

after(() => {
  getSqlite().close();
  rmSync(directory, { recursive: true, force: true });
});

test("conversations and messages stay scoped to their owner", () => {
  const conversation = chat.createConversation(alice, { title: "A new thought", modelId: "openrouter/auto" });
  assert.equal(chat.getConversation(alice, conversation.id)?.title, "A new thought");
  assert.equal(chat.getConversation(bob, conversation.id), null);
  const saved = chat.appendMessage(alice, conversation.id, {
    role: "user", blocks: [{ type: "text", text: "Hello" }]
  });
  assert.ok(saved);
  assert.equal(chat.listMessages(alice, conversation.id)?.[0].blocks[0].type, "text");
  assert.equal(chat.listMessages(bob, conversation.id), null);
  assert.equal(chat.appendMessage(bob, conversation.id, { role: "user", blocks: [{ type: "text", text: "Intrusion" }] }), null);
  assert.equal(chat.listConversations(bob).length, 0);
  assert.equal(chat.deleteConversation(bob, conversation.id), false);
  assert.equal(chat.deleteConversation(alice, conversation.id), true);
  assert.equal(chat.getConversation(alice, conversation.id), null);
});

test("selected chat model persists for each user", () => {
  assert.equal(preferences.getSavedModel(alice), null);
  preferences.saveModel(alice, "openai/gpt-5");
  assert.equal(preferences.getSavedModel(alice), "openai/gpt-5");
  assert.equal(preferences.getSavedModel(bob), null);
});

test("assets begin private and reject foreign ownership or path traversal", () => {
  const created = assets.createAsset(alice, {
    kind: "image", source: "upload", mimeType: "image/png",
    sizeBytes: 123, storageKey: `uploads/${randomUUID()}.png`
  });
  assert.equal(created.visibility, "private");
  assert.equal(assets.getOwnedAsset(alice, created.id)?.visibility, "private");
  assert.equal(assets.getOwnedAsset(bob, created.id), null);
  assert.equal(assets.getAssetForRead(null, created.id), null);
  assert.equal(assets.getAssetForRead(bob, created.id), null);
  assert.equal(assets.setAssetVisibility(bob, created.id, "public"), null);
  assert.equal(assets.setAssetVisibility(alice, created.id, "public")?.visibility, "public");
  assert.equal(assets.getOwnedAsset(alice, created.id)?.visibility, "public");
  assert.equal(assets.getOwnedAsset(bob, created.id), null);
  assert.equal(assets.getAssetForRead(bob, created.id)?.id, created.id);
  assert.equal(assets.deleteAsset(bob, created.id), null);
  assert.equal(assets.deleteAsset(alice, created.id)?.id, created.id);
  assert.equal(assets.getAssetForRead(null, created.id), null);
  assert.throws(() => assets.createAsset(alice, {
    kind: "file", source: "upload", mimeType: "text/plain", sizeBytes: 4,
    storageKey: "../secret.txt"
  }));
});

test("projects cannot be attached to another user's conversation or job", () => {
  const project = projects.createProject(alice, { name: "Private launch" });
  assert.equal(projects.getProject(bob, project.id), null);
  assert.throws(() => chat.createConversation(bob, { projectId: project.id }));
  assert.throws(() => jobs.createGenerationJob(bob, {
    kind: "image", provider: "kie", providerModel: "image/test", projectId: project.id,
    payload: { prompt: "x" }
  }));
});

test("jobs are owner-scoped and enforce a durable state sequence", () => {
  const job = jobs.createGenerationJob(alice, {
    kind: "video", provider: "fal", providerModel: "fal-ai/ltx-2.3-quality/inpaint",
    payload: { prompt: "Repair frames 10 to 12" }, costEstimateMicrosUsd: 220_000
  });
  assert.equal(jobs.getGenerationJob(bob, job.id), null);
  assert.equal(jobs.transitionGenerationJob(bob, job.id, { state: "running" }), null);
  assert.equal(jobs.claimNextQueuedJob()?.id, job.id);
  assert.equal(jobs.claimNextQueuedJob(), null);
  assert.equal(jobs.transitionGenerationJob(alice, job.id, { state: "running", externalId: "task-123" })?.externalId, "task-123");
  assert.equal(jobs.transitionGenerationJob(alice, job.id, { state: "succeeded", output: { assetIds: [] } })?.state, "succeeded");
  assert.deepEqual(jobs.getGenerationJob(alice, job.id)?.output, { assetIds: [] });
  assert.throws(() => jobs.transitionGenerationJob(alice, job.id, { state: "running" }));
});

test("Explore templates only become public through an owner action", () => {
  const template = templates.createExploreTemplate(alice, {
    title: "Portrait study", description: "An editable visual prompt", category: "image",
    definition: { version: 1, inputs: [], steps: [{ id: "prompt", title: "Compose", kind: "image", prompt: "A portrait of {{subject}}" }] }
  });
  assert.equal(templates.getExploreTemplate(bob, template.id), null);
  assert.equal(templates.setExploreTemplateVisibility(bob, template.id, "public"), null);
  assert.equal(templates.setExploreTemplateVisibility(alice, template.id, "public")?.visibility, "public");
  assert.equal(templates.getExploreTemplate(null, template.id)?.definition.steps.length, 1);
});

test("only admins can maintain specialist profiles", () => {
  const input = { slug: "general-health", name: "General health", domain: "health",
    description: "General health information", systemPrompt: "Explain uncertainty and cite sources.",
    sourceLinks: [], enabled: true };
  assert.throws(() => specialists.createSpecialistProfile(bob, input));
  const saved = specialists.createSpecialistProfile(alice, input);
  assert.equal(specialists.getEnabledSpecialist("general-health")?.id, saved.id);
  assert.equal(specialists.updateSpecialistProfile(alice, saved.id, { enabled: false })?.enabled, false);
  assert.equal(specialists.getEnabledSpecialist("general-health"), null);
});

test("five private Explore starters seed once per account and remain editable, publishable and deletable", () => {
  const firstOwner = randomUUID();
  const secondOwner = randomUUID();
  const createdAt = new Date();
  getDb().insert(user).values([
    { id: firstOwner, name: "First", email: "starter-first@example.test", role: "user", emailVerified: true, createdAt, updatedAt: createdAt },
    { id: secondOwner, name: "Second", email: "starter-second@example.test", role: "user", emailVerified: true, createdAt, updatedAt: createdAt }
  ]).run();

  assert.equal(templates.ensureStarterTemplates(firstOwner), 5);
  assert.equal(templates.ensureStarterTemplates(firstOwner), 0);
  const starters = templates.listExploreTemplates(firstOwner).filter(item => item.ownerId === firstOwner);
  assert.equal(starters.length, 5);
  assert.deepEqual(new Set(starters.map(item => item.title)), new Set([
    "Product hero image", "Consistent portrait", "Short film scene", "Voiceover take", "Social launch clip"
  ]));
  assert.equal(starters.every(item => item.visibility === "private" && item.definition.steps.length >= 2), true);
  for (const item of starters) {
    assert.equal(templates.getExploreTemplate(secondOwner, item.id), null);
    assert.equal(templates.getExploreTemplate(null, item.id), null);
  }

  const chosen = starters.find(item => item.title === "Product hero image")!;
  const editedDefinition = {
    ...chosen.definition,
    steps: chosen.definition.steps.map((step, index) => index === 0
      ? { ...step, prompt: "My revised product brief" } : step)
  };
  const edited = templates.updateExploreTemplate(firstOwner, chosen.id, {
    title: "My own product campaign", definition: editedDefinition
  });
  assert.equal(edited?.title, "My own product campaign");
  assert.equal(edited?.definition.steps[0].prompt, "My revised product brief");
  assert.equal(templates.updateExploreTemplate(secondOwner, chosen.id, { title: "Intrusion" }), null);
  assert.equal(templates.ensureStarterTemplates(firstOwner), 0);
  assert.equal(templates.getExploreTemplate(firstOwner, chosen.id)?.title, "My own product campaign");

  assert.equal(templates.setExploreTemplateVisibility(firstOwner, chosen.id, "public")?.visibility, "public");
  assert.equal(templates.getExploreTemplate(secondOwner, chosen.id)?.id, chosen.id);
  assert.equal(templates.deleteExploreTemplate(secondOwner, chosen.id), false);
  assert.equal(templates.deleteExploreTemplate(firstOwner, chosen.id), true);
  assert.equal(templates.ensureStarterTemplates(firstOwner), 0, "deleted starters must not reappear");
  assert.equal(templates.listExploreTemplates(firstOwner).filter(item => item.ownerId === firstOwner).length, 4);

  assert.equal(templates.ensureStarterTemplates(secondOwner), 5);
  const secondStarters = templates.listExploreTemplates(secondOwner).filter(item => item.ownerId === secondOwner);
  assert.equal(secondStarters.length, 5);
  assert.equal(secondStarters.every(item => !starters.some(first => first.id === item.id)), true);
});
