import assert from "node:assert/strict";
import test from "node:test";
import { clearStoredDrafts, emptyDrafts, readUserDrafts, writeUserDrafts } from "../src/components/workspace-privacy";

class MemoryStorage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test("private drafts load only for their account and reject malformed stored values", () => {
  const storage = new MemoryStorage();
  storage.setItem("ailoom.drafts", JSON.stringify({ chat: "old shared secret" }));
  writeUserDrafts(storage, "alice", { ...emptyDrafts(), chat: "Alice's prompt" });
  writeUserDrafts(storage, "bob", { ...emptyDrafts(), video: "Bob's scene" });

  assert.equal(readUserDrafts(storage, "alice").chat, "Alice's prompt");
  assert.equal(readUserDrafts(storage, "alice").video, "");
  assert.equal(readUserDrafts(storage, "bob").chat, "");
  assert.equal(readUserDrafts(storage, "bob").video, "Bob's scene");
  assert.deepEqual(readUserDrafts(storage, "new-user"), emptyDrafts());

  storage.setItem("ailoom.drafts.alice", "not-json");
  assert.deepEqual(readUserDrafts(storage, "alice"), emptyDrafts());
});

test("sign-out removes legacy and account drafts without deleting theme preference", () => {
  const storage = new MemoryStorage();
  storage.setItem("ailoom.drafts", "legacy prompt");
  writeUserDrafts(storage, "alice", { ...emptyDrafts(), chat: "private" });
  writeUserDrafts(storage, "bob", { ...emptyDrafts(), image: "private" });
  storage.setItem("ailoom.theme", "dark");

  clearStoredDrafts(storage);

  assert.equal(storage.getItem("ailoom.drafts"), null);
  assert.deepEqual(readUserDrafts(storage, "alice"), emptyDrafts());
  assert.deepEqual(readUserDrafts(storage, "bob"), emptyDrafts());
  assert.equal(storage.getItem("ailoom.theme"), "dark");
});
