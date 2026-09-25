import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { captionsToAss, parseCaptions, renderBurnedCaptions, CaptionError } from "../src/server/media/captions";
import { beginCaptionClaim, captionRequestDigest, finishCaptionClaim,
  readCaptionClaim } from "../src/server/media/caption-claims";

const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static") as string;
const ffprobe = (require("ffprobe-static") as { path: string }).path;

function createClip(path: string): Buffer {
  const generated = spawnSync(ffmpeg, ["-hide_banner", "-nostdin", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=0x123456:s=320x180:r=15:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest", path], { timeout: 20_000 });
  assert.equal(generated.status, 0, generated.stderr?.toString("utf8").slice(0, 500));
  return readFileSync(path);
}

function frame(path: string): Buffer {
  const extracted = spawnSync(ffmpeg, ["-hide_banner", "-nostdin", "-loglevel", "error",
    "-ss", "1", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { timeout: 20_000, maxBuffer: 2_000_000 });
  assert.equal(extracted.status, 0);
  return extracted.stdout;
}

function brightPixels(rgb: Buffer): number {
  let count = 0;
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    if (rgb[i] > 210 && rgb[i + 1] > 210 && rgb[i + 2] > 210) count++;
  }
  return count;
}

test("SRT/VTT parser bounds and escapes English/Persian text before ASS rendering", () => {
  const cues = parseCaptions("vtt", "WEBVTT\n\n00:00:00.100 --> 00:00:01.700\nسلام دنیا\\N {\\pos(0,0)}\nEnglish line");
  assert.equal(cues.length, 1);
  assert.equal(cues[0].startMs, 100);
  const ass = captionsToAss(cues, 320, 180);
  assert.match(ass, /Noto Sans/);
  assert.match(ass, /سلام دنیا/);
  assert.doesNotMatch(ass, /\{\\pos\(0,0\)\}/);
  assert.match(ass, /｛＼pos\(0,0\)｝/);
  assert.deepEqual(parseCaptions("srt", "1\n00:00:00,100 --> 00:00:01,700\nHello")[0],
    { startMs: 100, endMs: 1700, text: "Hello" });
  for (const text of ["WEBVTT\n\n00:00:02.000 --> 00:00:01.000\nBad",
    "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nBad\u0000text"]) {
    assert.throws(() => parseCaptions("vtt", text), CaptionError);
  }
  assert.throws(() => parseCaptions("srt", "1\n00:00:00,000 --> 00:02:01,000\nBeyond video"), CaptionError);
});

test("private claim files admit one renderer and isolate the same key by owner", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-caption-claims-"));
  const previous = process.env.MEDIA_DIR;
  process.env.MEDIA_DIR = directory;
  try {
    const owner = randomUUID();
    const other = randomUUID();
    const key = randomUUID();
    const digest = captionRequestDigest({ sourceAssetId: randomUUID(), format: "srt", text: "Hello" });
    const [first, second] = await Promise.all([
      beginCaptionClaim(owner, key, digest), beginCaptionClaim(owner, key, digest)
    ]);
    assert.deepEqual([first, second].sort(), [false, true]);
    assert.deepEqual(await readCaptionClaim(owner, key, digest), { state: "processing" });
    assert.deepEqual(await readCaptionClaim(owner, key, "another-digest"), { state: "conflict" });
    assert.equal(await beginCaptionClaim(other, key, digest), true);
    assert.deepEqual(await readCaptionClaim(other, key, digest), { state: "processing" });
    const assetId = randomUUID();
    await finishCaptionClaim(owner, key, { state: "completed", assetId });
    assert.deepEqual(await readCaptionClaim(owner, key, digest), { state: "completed", assetId });
    assert.deepEqual(await readCaptionClaim(other, key, digest), { state: "processing" });
  } finally {
    if (previous === undefined) delete process.env.MEDIA_DIR; else process.env.MEDIA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("FFmpeg burns mixed-script captions into pixels and retains source audio", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-caption-render-"));
  const sourcePath = join(directory, "source.mp4");
  const outputPath = join(directory, "captioned.mp4");
  const workDir = join(directory, "private-work");
  const before = { FFMPEG_PATH: process.env.FFMPEG_PATH, FFPROBE_PATH: process.env.FFPROBE_PATH };
  process.env.FFMPEG_PATH = ffmpeg;
  process.env.FFPROBE_PATH = ffprobe;
  try {
    const source = createClip(sourcePath);
    const cues = parseCaptions("srt", "1\n00:00:00,000 --> 00:00:01,900\nHello · سلام دنیا");
    const rendered = await renderBurnedCaptions({ sourcePath, outputPath, workDir,
      sourceBytes: source.length, cues });
    assert.equal(rendered.audioPreserved, true);
    assert.ok(rendered.sizeBytes > 0);
    assert.ok(Math.abs(rendered.durationSec - 2) < 0.3);
    const sourceFrame = frame(sourcePath);
    const captionedFrame = frame(outputPath);
    assert.equal(sourceFrame.length, captionedFrame.length);
    assert.ok(brightPixels(captionedFrame) > brightPixels(sourceFrame) + 25,
      `caption glyphs must appear in actual video pixels (${brightPixels(sourceFrame)} -> ${brightPixels(captionedFrame)})`);
    const persianOnlyPath = join(directory, "persian-only.mp4");
    await renderBurnedCaptions({ sourcePath, outputPath: persianOnlyPath,
      workDir: join(directory, "persian-work"), sourceBytes: source.length,
      cues: parseCaptions("srt", "1\n00:00:00,000 --> 00:00:01,900\nسلام دنیا") });
    assert.ok(brightPixels(frame(persianOnlyPath)) > brightPixels(sourceFrame) + 15,
      "Persian glyphs must render into actual video pixels");
    await assert.rejects(() => renderBurnedCaptions({ sourcePath,
      outputPath: join(directory, "invalid.mp4"), workDir: join(directory, "invalid-work"),
      sourceBytes: source.length,
      cues: parseCaptions("srt", "1\n00:00:00,000 --> 00:00:02,500\nToo long") }), CaptionError);
    process.env.FFMPEG_PATH = join(directory, "missing-ffmpeg");
    const failedPath = join(directory, "failed.mp4");
    const failedWork = join(directory, "failed-private-work");
    await assert.rejects(() => renderBurnedCaptions({ sourcePath,
      outputPath: failedPath, workDir: failedWork, sourceBytes: source.length, cues }), CaptionError);
    assert.equal(existsSync(failedPath), false);
    assert.equal(existsSync(failedWork), false, "private caption text must be removed after failure");
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("caption API requires an owner and stable key, keeps output private, and replays exactly once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-caption-route-"));
  const before = { DATABASE_PATH: process.env.DATABASE_PATH, MEDIA_DIR: process.env.MEDIA_DIR,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET, BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    FFMPEG_PATH: process.env.FFMPEG_PATH, FFPROBE_PATH: process.env.FFPROBE_PATH };
  process.env.DATABASE_PATH = join(directory, "test.sqlite");
  process.env.MEDIA_DIR = join(directory, "media");
  process.env.BETTER_AUTH_SECRET = "captions-test-secret-must-have-at-least-32-characters";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.FFMPEG_PATH = ffmpeg;
  process.env.FFPROBE_PATH = ffprobe;
  const { getDb, getSqlite } = await import("../src/server/db");
  const { user } = await import("../src/server/db/schema");
  const { createInvite } = await import("../src/server/auth/invites");
  const { createAsset, getOwnedAsset, listAssets } = await import("../src/server/content/assets");
  const { savePrivateFile } = await import("../src/server/storage/private-files");
  const authRoute = await import("../src/app/api/auth/[...all]/route");
  const captionRoute = await import("../src/app/api/video/captions/route");
  const assetRoute = await import("../src/app/api/assets/[id]/route");
  try {
    migrate(getDb(), { migrationsFolder: resolve("src/server/db/migrations") });
    const invitation = createInvite({ email: "captions@example.test" });
    const signup = await authRoute.POST(new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "Caption Tester", email: "captions@example.test",
        password: "Captions-test-password-123!", inviteToken: invitation.token })
    }));
    assert.equal(signup.status, 200);
    const cookie = signup.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const ownerId = (await signup.json()).user.id as string;
    const otherId = randomUUID();
    const now = new Date();
    getDb().insert(user).values({ id: otherId, name: "Other", email: "caption-other@example.test",
      role: "user", emailVerified: true, createdAt: now, updatedAt: now }).run();
    const clip = createClip(join(directory, "source.mp4"));
    const saved = await savePrivateFile(clip, "video/mp4");
    const source = createAsset(ownerId, { ...saved, source: "upload" });
    const foreign = createAsset(otherId, { ...saved, source: "upload", storageKey: "uploads/foreign/foreign.mp4" });
    const input = { sourceAssetId: source.id, format: "srt",
      text: "1\n00:00:00,000 --> 00:00:01,900\nPrivate caption · زیرنویس" };
    const key = randomUUID();
    const send = (payload: unknown, requestKey: string = key, headers: Record<string, string> = {}) =>
      captionRoute.POST(new Request("http://localhost:3000/api/video/captions", {
        method: "POST", headers: { cookie, origin: "http://localhost:3000",
          "content-type": "application/json", "Idempotency-Key": requestKey, ...headers },
        body: JSON.stringify(payload)
      }));
    assert.equal((await captionRoute.POST(new Request("http://localhost:3000/api/video/captions",
      { method: "POST", body: JSON.stringify(input) }))).status, 401);
    assert.equal((await send(input, key, { origin: "https://other.example.test" })).status, 403);
    assert.equal((await send(input, "invalid-key")).status, 400);
    assert.equal((await send({ ...input, sourceAssetId: foreign.id }, randomUUID())).status, 404);
    assert.equal((await send({ ...input, text: "1\n00:00:00,000 --> 00:00:02,500\nToo long" }, randomUUID())).status, 422);
    const generated = await send(input);
    assert.equal(generated.status, 201, JSON.stringify(await generated.clone().json()));
    const body = await generated.json();
    assert.equal(body.status, "completed");
    assert.equal(body.asset.visibility, "private");
    assert.equal(body.audioPreserved, true);
    const output = getOwnedAsset(ownerId, body.asset.id);
    assert.equal(output?.kind, "video");
    assert.equal(output?.mimeType, "video/mp4");
    assert.equal(getOwnedAsset(otherId, body.asset.id), null);
    assert.equal(listAssets(ownerId, { kind: "video" }).length, 2);
    const anonymousRead = await assetRoute.GET(new Request(`http://localhost:3000/api/assets/${body.asset.id}`),
      { params: Promise.resolve({ id: body.asset.id }) });
    assert.equal(anonymousRead.status, 404);
    const replay = await send(input);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).asset.id, body.asset.id);
    assert.equal(listAssets(ownerId, { kind: "video" }).length, 2);
    assert.equal((await send({ ...input, text: input.text + " changed" })).status, 409);
    assert.equal((await send({ ...input, sourceAssetId: foreign.id })).status, 409);
  } finally {
    getSqlite().close();
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
