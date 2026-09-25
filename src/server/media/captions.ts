import { spawn } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { videoToolPaths } from "./binaries";

export type CaptionFormat = "srt" | "vtt";
export type CaptionCue = { startMs: number; endMs: number; text: string };
export type CaptionSource = { durationSec: number; width: number; height: number; hasAudio: boolean };

const MAX_CUES = 300;
const MAX_SOURCE_BYTES = 75_000_000;
const MAX_OUTPUT_BYTES = 180_000_000;
const MAX_DURATION_SEC = 120;
const MAX_PIXELS = 1920 * 1080;
const RENDER_TIMEOUT_MS = 180_000;

export class CaptionError extends Error {
  constructor(public readonly code: "invalid_captions" | "unsupported_video" | "tool_unavailable" | "render_failed",
    message: string) {
    super(message);
    this.name = "CaptionError";
  }
}

function timestamp(value: string): number | null {
  const match = /^(?:(\d{1,2}):)?(\d{2}):(\d{2})[,.](\d{3})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4]);
  if (minutes > 59 || seconds > 59) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

/** Parse a deliberately small, plain-text subset of SRT/WebVTT. Styling and cue settings are ignored. */
export function parseCaptions(format: CaptionFormat, input: string): CaptionCue[] {
  if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > 48_000 ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(input)) {
    throw new CaptionError("invalid_captions", "Use a plain SRT or VTT file under 48 KB.");
  }
  let text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (format === "vtt") {
    const match = /^WEBVTT(?:[^\n]*)\n(?:\n)*/.exec(text);
    if (!match) throw new CaptionError("invalid_captions", "A WEBVTT header is required.");
    text = text.slice(match[0].length).trim();
  }
  const blocks = text.split(/\n[ \t]*\n+/);
  if (!text || blocks.length > MAX_CUES) {
    throw new CaptionError("invalid_captions", `Use 1 to ${MAX_CUES} caption cues.`);
  }
  const cues: CaptionCue[] = [];
  let previousStart = -1;
  for (const block of blocks) {
    const lines = block.split("\n").map(line => line.trim());
    let timingIndex = 0;
    if (!lines[0]?.includes("-->")) timingIndex = 1;
    if (timingIndex > 0 && (!lines[0] || lines[0].length > 80)) {
      throw new CaptionError("invalid_captions", "A caption identifier is invalid.");
    }
    const timing = /^(\S+)\s+-->\s+(\S+)(?:\s+[^\n]*)?$/.exec(lines[timingIndex] ?? "");
    const startMs = timing ? timestamp(timing[1]) : null;
    const endMs = timing ? timestamp(timing[2]) : null;
    const textLines = lines.slice(timingIndex + 1);
    const cueText = textLines.join("\n").trim();
    if (startMs === null || endMs === null || endMs <= startMs || startMs < previousStart ||
        textLines.length < 1 || textLines.length > 3 || cueText.length < 1 ||
        [...cueText].length > 280 || endMs > MAX_DURATION_SEC * 1000) {
      throw new CaptionError("invalid_captions", "Caption timing or text is invalid.");
    }
    previousStart = startMs;
    cues.push({ startMs, endMs, text: cueText });
  }
  return cues;
}

function assTime(ms: number, roundUp = false): string {
  const centiseconds = roundUp ? Math.ceil(ms / 10) : Math.floor(ms / 10);
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor(centiseconds / 6_000) % 60;
  const seconds = Math.floor(centiseconds / 100) % 60;
  const fraction = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`;
}

function assText(value: string): string {
  // ASS override tags use braces and backslashes. Full-width equivalents remain legible
  // while preventing user input from changing the renderer's style or timing.
  return value.replace(/\\/g, "＼").replace(/\{/g, "｛").replace(/\}/g, "｝")
    .replace(/\n/g, "\\N");
}

export function captionsToAss(cues: readonly CaptionCue[], width: number, height: number): string {
  const fontSize = Math.max(18, Math.min(58, Math.round(height * 0.052)));
  const margin = Math.max(18, Math.round(height * 0.065));
  const outline = Math.max(2, Math.round(height * 0.0028));
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Noto Sans,${fontSize},&H00FFFFFF,&H00FFFFFF,&H90000000,&H70000000,0,0,0,0,100,100,0,0,1,${outline},1,2,${margin},${margin},${margin},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return header + cues.map(cue => `Dialogue: 0,${assTime(cue.startMs)},${assTime(cue.endMs, true)},Default,,0,0,0,,${assText(cue.text)}\n`).join("");
}

async function run(executable: string, args: readonly string[], cwd: string | undefined,
  timeoutMs: number, maxStdout = 65_536): Promise<string> {
  return new Promise((done, reject) => {
    const child = spawn(executable, [...args], { cwd, shell: false, windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let oversized = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (part: string) => {
      if (stdout.length + part.length > maxStdout) {
        oversized = true;
        child.kill("SIGKILL");
      } else stdout += part;
    });
    // FFmpeg can echo private paths and subtitle details here; never return or log it.
    child.stderr?.resume();
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      if (code === 0 && !oversized) done(stdout);
      else reject(new Error("Local video processing failed."));
    });
  });
}

function validPositiveNumber(value: unknown): number | null {
  const n = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function probe(path: string, ffprobePath: string): Promise<CaptionSource> {
  let output: string;
  try {
    output = await run(ffprobePath, ["-v", "error", "-show_entries",
      "format=duration:stream=codec_type,width,height", "-of", "json", path], undefined, 10_000);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CaptionError("tool_unavailable", "The video tools are unavailable.");
    }
    throw new CaptionError("unsupported_video", "The video format is unsupported.");
  }
  let parsed: { streams?: Array<{ codec_type?: string; width?: unknown; height?: unknown }>;
    format?: { duration?: unknown } };
  try { parsed = JSON.parse(output); }
  catch { throw new CaptionError("unsupported_video", "The video format is unsupported."); }
  const video = parsed.streams?.find(stream => stream.codec_type === "video");
  const width = validPositiveNumber(video?.width);
  const height = validPositiveNumber(video?.height);
  const durationSec = validPositiveNumber(parsed.format?.duration);
  if (!video || !width || !height || !durationSec ||
      !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 64 || height < 64 || width * height > MAX_PIXELS ||
      durationSec > MAX_DURATION_SEC) {
    throw new CaptionError("unsupported_video", "Use a video up to 120 seconds, 1080p, and 75 MB.");
  }
  return { width, height, durationSec, hasAudio: Boolean(parsed.streams?.some(stream => stream.codec_type === "audio")) };
}

export async function renderBurnedCaptions(input: {
  sourcePath: string; outputPath: string; workDir: string; sourceBytes: number;
  cues: readonly CaptionCue[];
}): Promise<{ sizeBytes: number; durationSec: number; audioPreserved: boolean }> {
  if (![input.sourcePath, input.outputPath, input.workDir].every(path => isAbsolute(path)) ||
      resolve(input.sourcePath) === resolve(input.outputPath) ||
      basename(input.outputPath).toLowerCase().endsWith(".mp4") === false) {
    throw new CaptionError("unsupported_video", "Invalid private video location.");
  }
  const source = await stat(input.sourcePath).catch(() => null);
  if (!source?.isFile() || source.size !== input.sourceBytes || source.size < 1 ||
      source.size > MAX_SOURCE_BYTES) {
    throw new CaptionError("unsupported_video", "Use a video up to 120 seconds, 1080p, and 75 MB.");
  }
  const { ffmpegPath, ffprobePath } = videoToolPaths();
  const metadata = await probe(input.sourcePath, ffprobePath);
  if (input.cues.length < 1 || input.cues.length > MAX_CUES ||
      input.cues.some(cue => cue.endMs > (metadata.durationSec + 0.05) * 1000)) {
    throw new CaptionError("invalid_captions", "All captions must end within the video.");
  }
  const workDir = resolve(input.workDir);
  const outputPath = resolve(input.outputPath);
  await mkdir(workDir, { recursive: true, mode: 0o700 });
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  const assPath = join(workDir, "captions.ass");
  try {
    await writeFile(assPath, captionsToAss(input.cues, metadata.width, metadata.height),
      { flag: "wx", mode: 0o600 });
    try {
      await run(ffmpegPath, ["-hide_banner", "-nostdin", "-loglevel", "error", "-n",
        "-i", input.sourcePath,
        "-vf", "ass=filename=captions.ass:shaping=complex",
        "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
        "-maxrate", "8M", "-bufsize", "16M", "-threads", "2",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart", outputPath], workDir, RENDER_TIMEOUT_MS, 16_384);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new CaptionError("tool_unavailable", "The video tools are unavailable.");
      }
      throw new CaptionError("render_failed", "Could not render captions on this video.");
    }
    const output = await stat(outputPath).catch(() => null);
    if (!output?.isFile() || output.size < 1 || output.size > MAX_OUTPUT_BYTES) {
      throw new CaptionError("render_failed", "The captioned video was not valid.");
    }
    const completed = await probe(outputPath, ffprobePath);
    if (Math.abs(completed.durationSec - metadata.durationSec) > 0.5 ||
        (metadata.hasAudio && !completed.hasAudio)) {
      throw new CaptionError("render_failed", "The captioned video lost its timing or audio.");
    }
    return { sizeBytes: output.size, durationSec: completed.durationSec,
      audioPreserved: metadata.hasAudio && completed.hasAudio };
  } catch (error) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
