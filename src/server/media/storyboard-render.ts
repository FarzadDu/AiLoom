import { spawn } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import { z } from "zod";
import { mediaRoot } from "../storage/private-files";
import { videoToolPaths } from "./binaries";

export type MontageShot = { sourcePath: string; durationSec: number };
export const storyboardRenderJobSchema = z.strictObject({
  boardId: z.uuid(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]),
  shots: z.array(z.strictObject({ assetId: z.uuid(), durationSec: z.number().int().min(4).max(30) }))
    .min(1).max(64)
}).refine(value => value.shots.reduce((sum, shot) => sum + shot.durationSec, 0) <= 600);
export type MontagePlan = {
  shots: readonly MontageShot[];
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";
  outputPath: string;
  workDir: string;
  signal?: AbortSignal;
};

export class StoryboardRenderError extends Error {
  constructor(public readonly code: "invalid_input" | "invalid_source" | "tool_unavailable" | "render_failed",
    message: string) {
    super(message);
    this.name = "StoryboardRenderError";
  }
}

const dimensions: Record<MontagePlan["aspectRatio"], readonly [number, number]> = {
  "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [720, 720],
  "4:3": [960, 720], "3:4": [720, 960], "21:9": [1512, 648]
};
const MAX_SHOTS = 64;
const MAX_TOTAL_SECONDS = 600;
const MAX_SOURCE_BYTES = 200_000_000;
const MAX_SEGMENT_BYTES = 200_000_000;
const MAX_TEMP_BYTES = 750_000_000;
const MAX_OUTPUT_BYTES = 1_000_000_000;

async function run(executable: string, args: readonly string[], cwd: string | undefined,
  timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((done, reject) => {
    const child = spawn(executable, [...args], { cwd, shell: false, windowsHide: true,
      signal, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let oversized = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (part: string) => {
      if (stdout.length + part.length > 65_536) {
        oversized = true;
        child.kill("SIGKILL");
      } else stdout += part;
    });
    // FFmpeg may echo private paths. Never return or log stderr.
    child.stderr?.resume();
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      if (code === 0 && !oversized) done(stdout);
      else reject(new Error("Local video processing failed."));
    });
  });
}

type VideoProbe = { duration: number; width: number; height: number; hasAudio: boolean };
async function probe(path: string, ffprobePath: string, signal?: AbortSignal): Promise<VideoProbe> {
  let raw: string;
  try {
    raw = await run(ffprobePath, ["-v", "error", "-show_entries",
      "format=duration:stream=codec_type,width,height", "-of", "json", path], undefined, 15_000, signal);
  } catch {
    throw new StoryboardRenderError("tool_unavailable", "Video tools could not read a storyboard shot.");
  }
  let parsed: { format?: { duration?: unknown }; streams?: Array<{
    codec_type?: string; width?: unknown; height?: unknown }> };
  try { parsed = JSON.parse(raw); }
  catch { throw new StoryboardRenderError("invalid_source", "A storyboard shot is not a readable video."); }
  const video = parsed.streams?.find(stream => stream.codec_type === "video");
  const duration = Number(parsed.format?.duration);
  const width = Number(video?.width);
  const height = Number(video?.height);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120 ||
      !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 64 || height < 64 || width * height > 3840 * 2160) {
    throw new StoryboardRenderError("invalid_source", "Use readable shot videos up to 120 seconds and 4K.");
  }
  return { duration, width, height,
    hasAudio: Boolean(parsed.streams?.some(stream => stream.codec_type === "audio")) };
}

/** Render a private, fixed-frame-rate montage; missing audio is filled with silence. */
export async function renderStoryboardMontage(plan: MontagePlan): Promise<{
  sizeBytes: number; durationSec: number; width: number; height: number
}> {
  const target = dimensions[plan.aspectRatio];
  const total = plan.shots.reduce((sum, shot) => sum + shot.durationSec, 0);
  if (!target || plan.shots.length < 1 || plan.shots.length > MAX_SHOTS ||
      !plan.shots.every(shot => Number.isSafeInteger(shot.durationSec) &&
        shot.durationSec >= 4 && shot.durationSec <= 30) || total > MAX_TOTAL_SECONDS) {
    throw new StoryboardRenderError("invalid_input", "Use 1 to 64 shots with a total length up to 10 minutes.");
  }
  const root = mediaRoot();
  const outputPath = resolve(plan.outputPath);
  const workDir = resolve(plan.workDir);
  if (!outputPath.startsWith(root + sep) || !workDir.startsWith(root + sep) ||
      outputPath.startsWith(workDir + sep) || !basename(outputPath).endsWith(".mp4") ||
      !plan.shots.every(shot => resolve(shot.sourcePath).startsWith(root + sep) &&
        resolve(shot.sourcePath) !== outputPath)) {
    throw new StoryboardRenderError("invalid_input", "Invalid private montage paths.");
  }
  if (await stat(outputPath).catch(() => null)) {
    throw new StoryboardRenderError("invalid_input", "The montage output path already exists.");
  }
  const { ffmpegPath, ffprobePath } = videoToolPaths();
  await mkdir(workDir, { recursive: true, mode: 0o700 });
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  try {
    const segments: string[] = [];
    let tempBytes = 0;
    for (let index = 0; index < plan.shots.length; index++) {
      if (plan.signal?.aborted) throw new StoryboardRenderError("render_failed", "Storyboard render was interrupted.");
      const shot = plan.shots[index];
      const source = await stat(shot.sourcePath).catch(() => null);
      if (!source?.isFile() || source.size < 1 || source.size > MAX_SOURCE_BYTES) {
        throw new StoryboardRenderError("invalid_source", "A storyboard shot is missing or too large.");
      }
      const sourceProbe = await probe(shot.sourcePath, ffprobePath, plan.signal);
      const segmentName = `shot-${String(index).padStart(2, "0")}.mp4`;
      const segmentPath = resolve(workDir, segmentName);
      const [width, height] = target;
      const videoFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=24,` +
        `tpad=stop_mode=clone:stop_duration=${shot.durationSec},format=yuv420p`;
      const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-n", "-i", shot.sourcePath];
      if (!sourceProbe.hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
      args.push("-map", "0:v:0", "-map", sourceProbe.hasAudio ? "0:a:0" : "1:a:0",
        "-vf", videoFilter,
        ...(sourceProbe.hasAudio ? ["-af", "aresample=async=1,apad"] : []),
        "-t", String(shot.durationSec), "-r", "24", "-c:v", "libx264",
        "-preset", "veryfast", "-crf", "24", "-threads", "2",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
        "-fs", String(MAX_SEGMENT_BYTES), "-movflags", "+faststart", segmentPath);
      try { await run(ffmpegPath, args, undefined, Math.max(180_000, shot.durationSec * 20_000), plan.signal); }
      catch { throw new StoryboardRenderError("render_failed", "Could not normalize a storyboard shot."); }
      const segment = await stat(segmentPath).catch(() => null);
      tempBytes += segment?.size ?? 0;
      if (!segment?.isFile() || segment.size < 1 || segment.size > MAX_SEGMENT_BYTES ||
          tempBytes > MAX_TEMP_BYTES) {
        throw new StoryboardRenderError("render_failed", "The storyboard exceeds the private render space limit.");
      }
      const normalized = await probe(segmentPath, ffprobePath, plan.signal);
      if (!normalized.hasAudio || normalized.width !== width || normalized.height !== height ||
          Math.abs(normalized.duration - shot.durationSec) > 0.35) {
        throw new StoryboardRenderError("render_failed", "A storyboard shot lost its timing or audio.");
      }
      segments.push(segmentName);
    }
    await writeFile(resolve(workDir, "segments.txt"),
      segments.map(name => `file '${name}'\n`).join(""), { flag: "wx", mode: 0o600 });
    try {
      await run(ffmpegPath, ["-hide_banner", "-nostdin", "-loglevel", "error", "-n",
        "-f", "concat", "-safe", "1", "-i", "segments.txt",
        "-c", "copy", "-movflags", "+faststart", outputPath], workDir, 180_000, plan.signal);
    } catch { throw new StoryboardRenderError("render_failed", "Could not join the storyboard shots."); }
    const output = await stat(outputPath).catch(() => null);
    if (!output?.isFile() || output.size < 1 || output.size > MAX_OUTPUT_BYTES) {
      throw new StoryboardRenderError("render_failed", "The storyboard output is invalid or too large.");
    }
    const rendered = await probe(outputPath, ffprobePath, plan.signal);
    if (!rendered.hasAudio || rendered.width !== target[0] || rendered.height !== target[1] ||
        Math.abs(rendered.duration - total) > Math.max(0.5, plan.shots.length * 0.08)) {
      throw new StoryboardRenderError("render_failed", "The storyboard output lost its timing or audio.");
    }
    return { sizeBytes: output.size, durationSec: rendered.duration,
      width: rendered.width, height: rendered.height };
  } catch (error) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
