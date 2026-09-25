import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

const script = resolve("scripts/backup-data.mjs");

test("snapshot backup copies referenced private media and detects missing or altered files", async t => {
  const root = await mkdtemp(join(tmpdir(), "ailoom-backup-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = join(root, "data");
  const media = join(data, "media");
  const databasePath = join(data, "ailoom.sqlite");
  await mkdir(join(media, "uploads"), { recursive: true });
  await mkdir(join(media, "lora", "datasets"), { recursive: true });
  await mkdir(join(media, "lora", "weights"), { recursive: true });
  await writeFile(join(media, "uploads", "test.txt"), "private bytes");
  await writeFile(join(media, "lora", "datasets", "test.zip"), "dataset");
  await writeFile(join(media, "lora", "weights", "test.safetensors"), "weights");
  const db = new Database(databasePath);
  try {
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE asset (storageKey TEXT NOT NULL, sizeBytes INTEGER NOT NULL); CREATE TABLE lora_dataset (storage_key TEXT NOT NULL, size_bytes INTEGER NOT NULL); CREATE TABLE lora_model (weight_storage_key TEXT, weight_size_bytes INTEGER)");
    db.prepare("INSERT INTO asset VALUES (?, ?)").run("uploads/test.txt", 13);
    db.prepare("INSERT INTO lora_dataset VALUES (?, ?)").run("lora/datasets/test.zip", 7);
    db.prepare("INSERT INTO lora_model VALUES (?, ?)").run("lora/weights/test.safetensors", 7);
    const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], {
      cwd: resolve("."), encoding: "utf8", env: { ...process.env, DATABASE_PATH: databasePath, MEDIA_DIR: media }
    });

    const backup = join(root, "backup-one");
    const result = run(backup);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(join(backup, "manifest.json"), "utf8"));
    assert.equal(manifest.media.length, 3);
    assert.equal(await readFile(join(backup, "media", "uploads", "test.txt"), "utf8"), "private bytes");
    assert.equal(run("--verify", backup).status, 0);

    const insideData = run(join(data, "bad-backup"));
    assert.notEqual(insideData.status, 0);
    assert.match(insideData.stderr, /outside the live data directory/);

    await writeFile(join(backup, "media", "uploads", "test.txt"), "tampered");
    const tampered = run("--verify", backup);
    assert.notEqual(tampered.status, 0);
    assert.match(tampered.stderr, /does not match/);

    db.prepare("INSERT INTO asset VALUES (?, ?)").run("uploads/missing.txt", 4);
    const incomplete = join(root, "backup-incomplete");
    const missing = run(incomplete);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /referenced by the snapshot is missing/);
    await assert.rejects(readFile(join(incomplete, "manifest.json")));
  } finally {
    db.close();
  }
});

test("backup succeeds before the first media file exists", async t => {
  const root = await mkdtemp(join(tmpdir(), "ailoom-empty-backup-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = join(root, "data");
  await mkdir(data);
  const databasePath = join(data, "ailoom.sqlite");
  const db = new Database(databasePath);
  db.exec("CREATE TABLE asset (storageKey TEXT NOT NULL, sizeBytes INTEGER NOT NULL); CREATE TABLE lora_dataset (storage_key TEXT NOT NULL, size_bytes INTEGER NOT NULL); CREATE TABLE lora_model (weight_storage_key TEXT, weight_size_bytes INTEGER)");
  db.close();
  const destination = join(root, "backup");
  const env = { ...process.env, DATABASE_PATH: databasePath, MEDIA_DIR: join(data, "media") };
  const create = spawnSync(process.execPath, [script, destination], { cwd: resolve("."), encoding: "utf8", env });
  assert.equal(create.status, 0, create.stderr);
  const verify = spawnSync(process.execPath, [script, "--verify", destination], { cwd: resolve("."), encoding: "utf8", env });
  assert.equal(verify.status, 0, verify.stderr);
});
