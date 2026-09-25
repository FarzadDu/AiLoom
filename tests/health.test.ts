import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { WORKER_NAMES, workerHealthy, writeWorkerHeartbeat, type WorkerHeartbeat } from "../src/server/worker-health";

test("health endpoint checks database and four private worker heartbeats without exposing details", async t => {
  const root = await mkdtemp(join(tmpdir(), "ailoom-health-"));
  const previousDatabase = process.env.DATABASE_PATH;
  const previousMedia = process.env.MEDIA_DIR;
  process.env.DATABASE_PATH = join(root, "app.sqlite");
  process.env.MEDIA_DIR = join(root, "media");
  const sqlite = new Database(process.env.DATABASE_PATH);
  sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY)");
  sqlite.close();
  const { GET } = await import("../src/app/api/health/route");
  const { getSqlite } = await import("../src/server/db");
  t.after(async () => {
    getSqlite().close();
    if (previousDatabase === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabase;
    if (previousMedia === undefined) delete process.env.MEDIA_DIR;
    else process.env.MEDIA_DIR = previousMedia;
    await rm(root, { recursive: true, force: true });
  });

  const web = await GET(new Request("http://localhost/api/health?scope=web"));
  assert.equal(web.status, 200);
  assert.deepEqual(await web.json(), { status: "ok" });
  const missing = await GET(new Request("http://localhost/api/health"));
  assert.equal(missing.status, 503);
  assert.deepEqual(await missing.json(), { status: "unavailable" });

  const now = Date.now();
  for (const worker of WORKER_NAMES) {
    const heartbeat: WorkerHeartbeat = { version: 1, worker, updatedAt: now,
      consecutiveFailures: 0, state: "idle" };
    await writeWorkerHeartbeat(heartbeat);
  }
  const all = await GET(new Request("http://localhost/api/health"));
  assert.equal(all.status, 200);
  assert.equal(all.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await all.json(), { status: "ok" });

  await writeWorkerHeartbeat({ version: 1, worker: "media", updatedAt: now,
    consecutiveFailures: 3, state: "error" });
  const failing = await GET(new Request("http://localhost/api/health"));
  assert.equal(failing.status, 503);
  const body = JSON.stringify(await failing.json());
  assert.equal(body.includes("media"), false);
  assert.equal(body.includes(root), false);
  assert.equal((await GET(new Request("http://localhost/api/health?scope=web"))).status, 200);
  getSqlite().exec("DROP TABLE user");
  const databaseUnavailable = await GET(new Request("http://localhost/api/health?scope=web"));
  assert.equal(databaseUnavailable.status, 503);
  assert.deepEqual(await databaseUnavailable.json(), { status: "unavailable" });
});

test("worker health rejects stale, future, stopped and mismatched heartbeats", async t => {
  const root = await mkdtemp(join(tmpdir(), "ailoom-heartbeat-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const now = Date.now();
  const heartbeat: WorkerHeartbeat = { version: 1, worker: "renderer", updatedAt: now,
    consecutiveFailures: 0, state: "working" };
  await writeWorkerHeartbeat(heartbeat, root);
  assert.equal(await workerHealthy("renderer", { mediaDirectory: root, now }), true);
  assert.equal(await workerHealthy("media", { mediaDirectory: root, now }), false);
  assert.equal(await workerHealthy("renderer", { mediaDirectory: root, now: now + 31_000 }), false);
  assert.equal(await workerHealthy("renderer", { mediaDirectory: root, now: now - 6_000 }), false);
  await writeWorkerHeartbeat({ ...heartbeat, state: "stopped" }, root);
  assert.equal(await workerHealthy("renderer", { mediaDirectory: root, now }), false);
});
