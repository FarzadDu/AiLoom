import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { renderStoryboardMontage, storyboardRenderJobSchema } from "../src/server/media/storyboard-render";

const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static") as string;
const ffprobe = (require("ffprobe-static") as { path: string }).path;

function createClip(path: string, color: string, audio: boolean): void {
  const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `color=c=${color}:s=320x180:r=15:d=2`];
  if (audio) args.push("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2");
  args.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p");
  if (audio) args.push("-c:a", "aac", "-shortest");
  args.push(path);
  const generated = spawnSync(ffmpeg, args, { timeout: 30_000 });
  assert.equal(generated.status, 0, generated.stderr?.toString("utf8").slice(0, 500));
}

test("storyboard montage joins private shots in order, pads timing, and preserves audio track", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-storyboard-render-"));
  const before = { MEDIA_DIR: process.env.MEDIA_DIR, FFMPEG_PATH: process.env.FFMPEG_PATH,
    FFPROBE_PATH: process.env.FFPROBE_PATH };
  process.env.MEDIA_DIR = directory;
  process.env.FFMPEG_PATH = ffmpeg;
  process.env.FFPROBE_PATH = ffprobe;
  try {
    const first = join(directory, "first.mp4");
    const second = join(directory, "second.mp4");
    createClip(first, "red", true);
    createClip(second, "blue", false);
    const result = await renderStoryboardMontage({
      shots: [{ sourcePath: first, durationSec: 4 }, { sourcePath: second, durationSec: 4 }],
      aspectRatio: "16:9", outputPath: join(directory, "output.mp4"),
      workDir: join(directory, "work")
    });
    assert.ok(result.sizeBytes > 0);
    assert.ok(Math.abs(result.durationSec - 8) < 0.5);
    assert.equal(result.width, 1280);
    assert.equal(result.height, 720);
    const probe = spawnSync(ffprobe, ["-v", "error", "-show_entries",
      "stream=codec_type", "-of", "json", join(directory, "output.mp4")],
    { timeout: 15_000 });
    assert.equal(probe.status, 0);
    const streams = JSON.parse(probe.stdout.toString("utf8")).streams as Array<{ codec_type: string }>;
    assert.deepEqual(streams.map(stream => stream.codec_type).sort(), ["audio", "video"]);
    const frame = (seconds: number) => spawnSync(ffmpeg, ["-hide_banner", "-nostdin", "-loglevel", "error",
      "-ss", String(seconds), "-i", join(directory, "output.mp4"),
      "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { timeout: 20_000, maxBuffer: 3_000_000 }).stdout;
    assert.notDeepEqual(frame(1), frame(5), "shot ordering must change the output pixels");
    assert.ok(readFileSync(join(directory, "output.mp4")).length > 0);
    assert.equal(storyboardRenderJobSchema.safeParse({ boardId: "not-a-uuid",
      aspectRatio: "16:9", shots: [] }).success, false);
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
