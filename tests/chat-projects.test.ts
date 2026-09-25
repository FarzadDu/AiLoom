import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { conversationsFromPayload, projectsFromPayload } from "../src/components/chat-api";

const directory = mkdtempSync(join(tmpdir(), "ailoom-chat-projects-"));
process.env.DATABASE_PATH = join(directory, "test.sqlite");
const { getDb, getSqlite } = await import("../src/server/db");
const { user } = await import("../src/server/db/schema");
const chat = await import("../src/server/content/chat");
const projects = await import("../src/server/content/projects");
const { projectContextMessages } = await import("../src/server/chat/project-context");

migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
const ownerId = randomUUID();
const otherId = randomUUID();
const now = new Date();
getDb().insert(user).values([
  { id: ownerId, name: "Owner", email: "owner@project.test", role: "admin", emailVerified: true, createdAt: now, updatedAt: now },
  { id: otherId, name: "Other", email: "other@project.test", role: "user", emailVerified: true, createdAt: now, updatedAt: now }
]).run();

after(() => {
  getSqlite().close();
  rmSync(directory, { recursive: true, force: true });
});

test("project conversations are owner scoped and can move without losing messages", () => {
  const project = projects.createProject(ownerId, { name: "Campaign", description: "Private local note" });
  const otherProject = projects.createProject(otherId, { name: "Private" });
  const first = chat.createConversation(ownerId, { projectId: project.id, title: "First draft" });
  const message = chat.appendMessage(ownerId, first.id, { role: "user", blocks: [{ type: "text", text: "A private draft" }] });
  assert.ok(message);
  assert.equal(chat.getConversation(ownerId, first.id)?.projectId, project.id);
  assert.equal(chat.getConversation(otherId, first.id), null);
  assert.equal(projects.getProject(otherId, project.id), null);
  assert.throws(() => chat.createConversation(otherId, { projectId: project.id }));
  assert.throws(() => chat.updateConversation(ownerId, first.id, { projectId: otherProject.id }));
  assert.equal(chat.getConversation(ownerId, first.id)?.projectId, project.id);

  const second = projects.createProject(ownerId, { name: "Website" });
  assert.equal(chat.updateConversation(ownerId, first.id, { projectId: second.id })?.projectId, second.id);
  assert.equal(chat.listMessages(ownerId, first.id)?.[0].id, message.id);
  assert.equal(chat.updateConversation(otherId, first.id, { projectId: otherProject.id }), null);
  assert.equal(chat.updateConversation(ownerId, first.id, { projectId: null })?.projectId, null);
  assert.equal(chat.listMessages(ownerId, first.id)?.[0].blocks[0].type, "text");
});

test("deleting a project unfiles conversations but preserves their content", () => {
  const project = projects.createProject(ownerId, { name: "Temporary" });
  const conversation = chat.createConversation(ownerId, { projectId: project.id });
  chat.appendMessage(ownerId, conversation.id, { role: "assistant", blocks: [{ type: "text", text: "Saved" }] });
  assert.equal(projects.deleteProject(otherId, project.id), false);
  assert.equal(projects.deleteProject(ownerId, project.id), true);
  assert.equal(chat.getConversation(ownerId, conversation.id)?.projectId, null);
  assert.equal(chat.listMessages(ownerId, conversation.id)?.[0].blocks[0].type, "text");
});

test("chat payload parsers retain only explicit project metadata", () => {
  assert.deepEqual(projectsFromPayload({ projects: [
    { id: "p-1", name: "One", description: "Local note" },
    { id: "p-2", name: "Two", description: null },
    { name: "invalid" }
  ] }).map(item => [item.id, item.description]), [["p-1", "Local note"], ["p-2", null]]);
  assert.deepEqual(conversationsFromPayload({ conversations: [
    { id: "c-1", title: "A", projectId: "p-1" },
    { id: "c-2", title: "B", projectId: null }
  ] }).map(item => item.projectId), ["p-1", null]);
});

test("project memory includes only the owner's same-project prior text", () => {
  const sameProject = projects.createProject(ownerId, { name: "Design", description: "Use a calm editorial tone." });
  const otherProject = projects.createProject(ownerId, { name: "Finance", description: "SECRET OTHER PROJECT" });
  const foreignProject = projects.createProject(otherId, { name: "Other", description: "SECRET OTHER USER" });
  const prior = chat.createConversation(ownerId, { projectId: sameProject.id });
  chat.appendMessage(ownerId, prior.id, { role: "user", blocks: [{ type: "text", text: "A coral visual identity." }] });
  chat.appendMessage(ownerId, prior.id, { role: "assistant", blocks: [{ type: "text", text: "Use a warm palette." }] });
  chat.appendMessage(ownerId, prior.id, { role: "system", blocks: [{ type: "text", text: "SECRET SYSTEM MARKER" }] });
  const current = chat.createConversation(ownerId, { projectId: sameProject.id });
  chat.appendMessage(ownerId, current.id, { role: "user", blocks: [{ type: "text", text: "CURRENT ONLY" }] });
  const unrelated = chat.createConversation(ownerId, { projectId: otherProject.id });
  chat.appendMessage(ownerId, unrelated.id, { role: "user", blocks: [{ type: "text", text: "SECRET OTHER PROJECT" }] });
  const foreign = chat.createConversation(otherId, { projectId: foreignProject.id });
  chat.appendMessage(otherId, foreign.id, { role: "user", blocks: [{ type: "text", text: "SECRET OTHER USER" }] });

  const context = projectContextMessages(ownerId, sameProject.id, current.id);
  assert.equal(context[0]?.role, "system");
  assert.match(String(context[0]?.content), /calm editorial tone/);
  assert.equal(context[1]?.role, "user");
  const memory = String(context[1]?.content);
  assert.match(memory, /coral visual identity/);
  assert.match(memory, /warm palette/);
  for (const excluded of ["CURRENT ONLY", "SECRET SYSTEM MARKER", "SECRET OTHER PROJECT", "SECRET OTHER USER"]) {
    assert.ok(!memory.includes(excluded), `unexpected leak: ${excluded}`);
  }
  assert.deepEqual(projectContextMessages(otherId, sameProject.id), []);
  assert.deepEqual(projectContextMessages(ownerId, null), []);
  assert.deepEqual(projectContextMessages(ownerId, foreignProject.id), []);
});

test("project memory caps excerpts and preserves Persian text", () => {
  const project = projects.createProject(ownerId, { name: "فارسی", description: "پاسخ‌ها کوتاه باشند." });
  for (let index = 0; index < 5; index++) {
    const previous = chat.createConversation(ownerId, { projectId: project.id });
    chat.appendMessage(ownerId, previous.id, {
      role: "user", blocks: [{ type: "text", text: `موضوع ${index}: ${"توضیح ".repeat(1_000)}` }]
    });
  }
  const context = projectContextMessages(ownerId, project.id);
  assert.equal(context[0]?.role, "system");
  assert.match(String(context[0]?.content), /پاسخ‌ها کوتاه باشند/);
  const excerpt = String(context[1]?.content);
  assert.match(excerpt, /موضوع/);
  assert.ok(excerpt.length < 4_200, `project memory was too long: ${excerpt.length}`);
});
