import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import SQLite from "better-sqlite3";

test("repair migration hides historical helper videos but preserves final output", () => {
  const db = new SQLite(":memory:");
  try {
    db.exec("CREATE TABLE asset (id text PRIMARY KEY, source text NOT NULL, visibility text NOT NULL, storageKey text NOT NULL)");
    const insert = db.prepare("INSERT INTO asset (id, source, visibility, storageKey) VALUES (?, ?, ?, ?)");
    insert.run("context", "generation", "public", "repairs/a/context-old.mp4");
    insert.run("mask", "generation", "private", "repairs/a/mask-old.mp4");
    insert.run("final", "generation", "private", "repairs/a/final-old.mp4");
    insert.run("upload", "upload", "private", "uploads/context-old.mp4");
    db.exec(readFileSync(resolve("src/server/db/migrations/0011_pale_rawhide_kid.sql"), "utf8"));
    const rows = db.prepare("SELECT id, internal, visibility FROM asset ORDER BY id").all();
    assert.deepEqual(rows, [
      { id: "context", internal: 1, visibility: "private" },
      { id: "final", internal: 0, visibility: "private" },
      { id: "mask", internal: 1, visibility: "private" },
      { id: "upload", internal: 0, visibility: "private" }
    ]);
  } finally {
    db.close();
  }
});
