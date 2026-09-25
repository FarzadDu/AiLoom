import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const directory = mkdtempSync(join(tmpdir(), "ailoom-content-test-"));
process.env.DATABASE_PATH = join(directory, "test.sqlite");
const { getDb, getSqlite } = await import("../src/server/db");
const { asset: assetTable, user } = await import("../src/server/db/schema");
const chat = await import("../src/server/content/chat");
const specialistContext = await import("../src/server/chat/specialist-context");
const assets = await import("../src/server/content/assets");
const jobs = await import("../src/server/content/jobs");
const projects = await import("../src/server/content/projects");
const preferences = await import("../src/server/content/preferences");
const templates = await import("../src/server/content/templates");
const specialists = await import("../src/server/content/specialists");
const assetAccess = await import("../src/server/storage/asset-access");

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

test("older conversations and messages remain reachable through cursors", () => {
  for (let index = 0; index < 55; index++) {
    chat.createConversation(bob, { title: `History ${index}` });
  }
  const newest = chat.listConversations(bob, { limit: 50 });
  const older = chat.listConversations(bob, { limit: 50, cursor: newest.at(-1)?.id });
  assert.equal(newest.length, 50);
  assert.equal(older.length, 5);
  assert.equal(new Set([...newest, ...older].map(item => item.id)).size, 55);
  assert.deepEqual(chat.listConversations(alice, { cursor: newest.at(-1)?.id }), []);

  const thread = newest[0];
  for (let index = 0; index < 105; index++) {
    chat.appendMessage(bob, thread.id, { role: "user", blocks: [{ type: "text", text: `Turn ${index}` }] });
  }
  const latest = chat.listMessages(bob, thread.id, { limit: 100 }) ?? [];
  const earlier = chat.listMessages(bob, thread.id, { limit: 100, before: latest[0]?.id }) ?? [];
  assert.equal(latest.length, 100);
  assert.equal(earlier.length, 5);
  assert.equal(earlier[0]?.blocks[0]?.type, "text");
  assert.equal(chat.listMessages(alice, thread.id), null);
});

test("specialist context survives follow-up turns and reopening without user-text promotion", () => {
  const specialist = chat.createConversation(alice, { title: "Skin question" });
  chat.appendMessage(alice, specialist.id, {
    role: "system", blocks: [{ type: "text", text: specialistContext.specialistContextMarker("skin-and-hair") }]
  });
  chat.appendMessage(alice, specialist.id, { role: "user", blocks: [{ type: "text", text: "I have acne" }] });
  const secondTurn = specialistContext.resolveSpecialistForTurn(true,
    chat.getConversationSystemTexts(alice, specialist.id), null);
  assert.deepEqual(secondTurn, { slug: "skin-and-hair", conflict: false });
  for (let index = 0; index < 35; index++) chat.appendMessage(alice, specialist.id, {
    role: "user", blocks: [{ type: "text", text: `Follow-up ${index}` }]
  });
  assert.ok(chat.getConversation(alice, specialist.id));
  const reopened = specialistContext.resolveSpecialistForTurn(true,
    chat.getConversationSystemTexts(alice, specialist.id), null);
  assert.deepEqual(reopened, secondTurn);
  assert.equal(specialistContext.resolveSpecialistForTurn(true,
    chat.getConversationSystemTexts(alice, specialist.id), "general-health").conflict, true);
  assert.deepEqual(chat.getConversationSystemTexts(bob, specialist.id), []);

  const plain = chat.createConversation(alice, { title: "Plain chat" });
  chat.appendMessage(alice, plain.id, { role: "user", blocks: [{ type: "text",
    text: specialistContext.specialistContextMarker("mental-wellbeing") }] });
  assert.deepEqual(specialistContext.resolveSpecialistForTurn(true,
    chat.getConversationSystemTexts(alice, plain.id), null), { slug: null, conflict: false });
  assert.equal(specialistContext.resolveSpecialistForTurn(true,
    chat.getConversationSystemTexts(alice, plain.id), "mental-wellbeing").conflict, true);
  assert.equal(specialistContext.specialistSlugFromSystemTexts([
    "You are Ailoom's mental well-being information specialist. Reply in the user's language."
  ]), "mental-wellbeing");
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

test("repair helper assets remain private and signed-reference capable but never enter the library", () => {
  const context = assets.createAsset(alice, {
    kind: "video", source: "generation", internal: true, mimeType: "video/mp4",
    sizeBytes: 12, storageKey: `repairs/${randomUUID()}/context-${randomUUID()}.mp4`
  });
  const final = assets.createAsset(alice, {
    kind: "video", source: "generation", mimeType: "video/mp4",
    sizeBytes: 12, storageKey: `repairs/${randomUUID()}/final-${randomUUID()}.mp4`
  });
  assert.equal(context.internal, true);
  assert.equal(context.visibility, "private");
  assert.equal(assets.getOwnedAsset(alice, context.id)?.id, context.id);
  assert.equal(assets.getOwnedAsset(bob, context.id), null);
  assert.equal(assets.getAssetForRead(null, context.id), null);
  const priorBase = process.env.PUBLIC_BASE_URL;
  const priorSecret = process.env.BETTER_AUTH_SECRET;
  process.env.PUBLIC_BASE_URL = "https://ailoom.example.test";
  process.env.BETTER_AUTH_SECRET = "repair-reference-secret-is-long-enough-to-sign";
  try {
    const signed = new URL(assetAccess.signedAssetUrl(context.id).url);
    assert.equal(assetAccess.verifyAssetAccess(context.id,
      signed.searchParams.get("expires"), signed.searchParams.get("token")), true);
  } finally {
    if (priorBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = priorBase;
    if (priorSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = priorSecret;
  }
  assert.equal(assets.setAssetVisibility(alice, context.id, "public"), null);
  assert.equal(assets.getOwnedAsset(alice, context.id)?.visibility, "private");
  assert.equal(assets.listAssets(alice, { kind: "video" }).some(item => item.id === context.id), false);
  assert.equal(assets.listAssets(alice, { kind: "video" }).some(item => item.id === final.id), true);
  assert.throws(() => assets.createAsset(alice, { kind: "video", source: "upload", internal: true,
    mimeType: "video/mp4", sizeBytes: 12, storageKey: `uploads/${randomUUID()}.mp4` }));
});

test("asset cursor pages preserve owner scope and order as newer outputs arrive", () => {
  const create = (ownerId: string, kind: "image" | "video", source: "generation" | "upload") =>
    assets.createAsset(ownerId, { kind, source, mimeType: kind === "video" ? "video/mp4" : "image/png",
      sizeBytes: 12, storageKey: `uploads/${randomUUID()}.${kind === "video" ? "mp4" : "png"}` });
  const dates = ["2026-01-03", "2026-01-03", "2026-01-02", "2026-01-02", "2026-01-01"];
  const generated = dates.map(date => {
    const item = create(alice, "image", "generation");
    getDb().update(assetTable).set({ createdAt: new Date(`${date}T00:00:00.000Z`) })
      .where(eq(assetTable.id, item.id)).run();
    return { id: item.id, date };
  });
  const uploaded = create(alice, "image", "upload");
  const video = create(alice, "video", "generation");
  const foreign = create(bob, "image", "generation");
  assets.setAssetVisibility(bob, foreign.id, "public");
  const expected = [...generated].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).map(item => item.id);

  const first = assets.listAssetsPage(alice, { kind: "image", source: "generation", limit: 2 });
  assert.deepEqual(first.assets.map(item => item.id), expected.slice(0, 2));
  assert.ok(first.nextCursor);
  const newer = create(alice, "image", "generation");
  const second = assets.listAssetsPage(alice, { kind: "image", source: "generation", limit: 2,
    cursor: assets.parseAssetCursor(first.nextCursor) });
  const third = assets.listAssetsPage(alice, { kind: "image", source: "generation", limit: 2,
    cursor: assets.parseAssetCursor(second.nextCursor) });
  assert.deepEqual([...first.assets, ...second.assets, ...third.assets].map(item => item.id), expected);
  assert.equal(third.nextCursor, null);
  assert.equal(assets.listAssetsPage(alice, { kind: "image", source: "generation", limit: 2 }).assets[0].id, newer.id);
  assert.ok(!expected.includes(uploaded.id) && !expected.includes(video.id) && !expected.includes(foreign.id));
  assert.deepEqual(assets.listAssetsPage(bob, { kind: "image", source: "generation", limit: 2 }).assets.map(item => item.id), [foreign.id]);
  assert.throws(() => assets.parseAssetCursor("not-a-cursor"));
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

test("a repeated paid request key returns one owned job and rejects changed or foreign requests", () => {
  const key = randomUUID();
  const request = { kind: "image" as const, provider: "fal", providerModel: "fal-ai/flux-2-pro",
    payload: { modelId: "fal-ai/flux-2-pro", operation: "text_to_image", prompt: "A blue kite" } };
  const first = jobs.createGenerationJob(alice, { ...request, idempotencyKey: key });
  const count = jobs.listGenerationJobs(alice, { limit: 200 }).length;
  assert.equal(first.id, key);
  assert.equal(jobs.createGenerationJob(alice, { ...request, idempotencyKey: key }).id, first.id);
  assert.equal(jobs.listGenerationJobs(alice, { limit: 200 }).length, count);
  assert.equal(jobs.claimNextQueuedJob()?.id, key);
  assert.equal(jobs.createGenerationJob(alice, { ...request, idempotencyKey: key }).state, "submitting");
  assert.throws(() => jobs.createGenerationJob(alice, { ...request,
    payload: { ...request.payload, prompt: "A red kite" }, idempotencyKey: key
  }), jobs.GenerationIdempotencyConflictError);
  assert.throws(() => jobs.createGenerationJob(bob, { ...request, idempotencyKey: key }),
    jobs.GenerationIdempotencyConflictError);
});

test("a renewed signed private reference resolves to the original paid job", () => {
  const previousBase = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = "https://ailoom.example.test";
  try {
    const key = randomUUID();
    const assetId = randomUUID();
    const input = (expires: number, token: string, referenceId = assetId) => ({
      kind: "edit" as const, provider: "fal", providerModel: "fal-ai/qwen-image-edit", idempotencyKey: key,
      payload: { modelId: "fal-ai/qwen-image-edit", operation: "image_edit", prompt: "Change the backdrop",
        imageUrl: `https://ailoom.example.test/api/assets/${referenceId}?expires=${expires}&token=${token}` }
    });
    const first = jobs.createGenerationJob(alice, input(1_790_000_000, "first"));
    assert.equal(jobs.createGenerationJob(alice, input(1_790_003_600, "second")).id, first.id);
    assert.throws(() => jobs.createGenerationJob(alice, input(1_790_003_600, "second", randomUUID())),
      jobs.GenerationIdempotencyConflictError);
  } finally {
    if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousBase;
  }
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
