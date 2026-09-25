import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static") as string;
const ffprobe = (require("ffprobe-static") as { path: string }).path;

test("storyboard render queues once, produces an owned private montage and replays its key", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-storyboard-job-"));
  const before = { DATABASE_PATH: process.env.DATABASE_PATH, MEDIA_DIR: process.env.MEDIA_DIR,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET, BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    FFMPEG_PATH: process.env.FFMPEG_PATH, FFPROBE_PATH: process.env.FFPROBE_PATH };
  process.env.DATABASE_PATH = join(directory, "test.sqlite");
  process.env.MEDIA_DIR = join(directory, "media");
  process.env.BETTER_AUTH_SECRET = "storyboard-test-secret-must-have-at-least-32-characters";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.FFMPEG_PATH = ffmpeg;
  process.env.FFPROBE_PATH = ffprobe;
  const { getDb, getSqlite } = await import("../src/server/db");
  const { createInvite } = await import("../src/server/auth/invites");
  const { createAsset, getOwnedAsset } = await import("../src/server/content/assets");
  const { createStoryboard, createStoryboardShot, updateStoryboardShot } =
    await import("../src/server/content/storyboards");
  const { getGenerationJob } = await import("../src/server/content/jobs");
  const { savePrivateFile } = await import("../src/server/storage/private-files");
  const { runMediaWorkerCycle, runStoryboardWorkerCycle } = await import("../src/server/media/worker");
  const authRoute = await import("../src/app/api/auth/[...all]/route");
  const renderRoute = await import("../src/app/api/storyboards/[id]/render/route");
  const assetRoute = await import("../src/app/api/assets/[id]/route");
  try {
    migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
    const invitation = createInvite({ email: "storyboard-render@example.test" });
    const signup = await authRoute.POST(new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "Storyboard Tester", email: "storyboard-render@example.test",
        password: "Storyboard-test-password-123!", inviteToken: invitation.token })
    }));
    assert.equal(signup.status, 200);
    const cookie = signup.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const ownerId = (await signup.json()).user.id as string;
    const sourcePath = join(directory, "source.mp4");
    const created = spawnSync(ffmpeg, ["-hide_banner", "-nostdin", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=15:d=2",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", sourcePath],
    { timeout: 20_000 });
    assert.equal(created.status, 0, created.stderr?.toString("utf8").slice(0, 500));
    const saved = await savePrivateFile(readFileSync(sourcePath), "video/mp4");
    const output = createAsset(ownerId, { ...saved, source: "generation" });
    const board = createStoryboard(ownerId, { title: "Two-shot test", description: "" });
    const first = createStoryboardShot(ownerId, board.id, {
      title: "Opening", prompt: "Blue", modelId: "fal-ai/veo3.1/fast",
      durationSec: 4, aspectRatio: "16:9", outputAssetId: output.id
    });
    assert.ok(first);
    const second = createStoryboardShot(ownerId, board.id, {
      title: "Ending", prompt: "Blue", modelId: "fal-ai/veo3.1/fast",
      durationSec: 4, aspectRatio: "16:9", outputAssetId: output.id
    });
    assert.ok(second);
    const key = randomUUID();
    const send = (boardId: string, requestKey: string = key, origin = "http://localhost:3000") =>
      renderRoute.POST(new Request(`http://localhost:3000/api/storyboards/${boardId}/render`, {
        method: "POST", headers: { cookie, origin, "Idempotency-Key": requestKey }
      }), { params: Promise.resolve({ id: boardId }) });
    assert.equal((await renderRoute.POST(new Request(`http://localhost:3000/api/storyboards/${board.id}/render`,
      { method: "POST" }), { params: Promise.resolve({ id: board.id }) })).status, 401);
    assert.equal((await send(board.id, key, "https://other.example.test")).status, 403);
    assert.equal((await send(board.id, "bad-key")).status, 400);
    assert.equal((await send(randomUUID(), randomUUID())).status, 404);
    const queued = await send(board.id);
    assert.equal(queued.status, 202, JSON.stringify(await queued.clone().json()));
    assert.equal((await queued.json()).job.state, "queued");
    assert.equal((await send(board.id)).status, 202);
    await runMediaWorkerCycle();
    assert.equal(getGenerationJob(ownerId, key)?.state, "queued",
      "the paid-provider worker must leave local renders to the dedicated renderer");
    await runStoryboardWorkerCycle();
    const finished = getGenerationJob(ownerId, key);
    assert.equal(finished?.state, "succeeded", finished?.errorCode ?? "");
    const assetId = (finished?.output as { assets: Array<{ id: string }> }).assets[0].id;
    const montage = getOwnedAsset(ownerId, assetId);
    assert.equal(montage?.kind, "video");
    assert.equal(montage?.visibility, "private");
    assert.equal((await assetRoute.GET(new Request(`http://localhost:3000/api/assets/${assetId}`),
      { params: Promise.resolve({ id: assetId }) })).status, 404);
    assert.equal((await send(board.id)).status, 202);
    updateStoryboardShot(ownerId, board.id, second!.id, { durationSec: 6 });
    assert.equal((await send(board.id, randomUUID())).status, 202);
  } finally {
    getSqlite().close();
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
