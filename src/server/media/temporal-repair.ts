import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, stat, access, rm } from "node:fs/promises";
import path from "node:path";

/**
 * Local video preparation and splice for fal's LTX masked video inpaint model.
 * The API layer must first verify sourcePath belongs to the current user, upload
 * contextVideoPath and maskVideoPath, and download the provider result before splice.
 * Neither function calls a model API.
 */

export type CommandResult = {
  stdout: string;
  stderr?: string;
  exitCode: number;
};

export type CommandRunner = (
  executable: string,
  args: readonly string[],
  options?: { signal?: AbortSignal; timeoutMs?: number }
) => Promise<CommandResult>;

export type TemporalRepairOptions = {
  ffmpegPath?: string;
  ffprobePath?: string;
  runCommand?: CommandRunner;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type TemporalRepairInput = {
  sourcePath: string;
  workDir: string;
  startSec: number;
  endSec: number;
  prompt: string;
  contextSec?: number;
};

export type TemporalRepairPlan = {
  sourcePath: string;
  workDir: string;
  contextVideoPath: string;
  maskVideoPath: string;
  prompt: string;
  sourceDurationSec: number;
  fps: number;
  fpsRatio: string;
  width: number;
  height: number;
  totalFrames: number;
  startFrame: number;
  endFrame: number;
  contextStartFrame: number;
  contextEndFrame: number;
  frameCount: number;
  targetStartFrameInContext: number;
  targetEndFrameInContext: number;
  contextStartSec: number;
  contextEndSec: number;
  targetStartSec: number;
  targetEndSec: number;
  hasAudio: boolean;
};

export type TemporalRepairSpliceInput = {
  plan: TemporalRepairPlan;
  repairedContextPath: string;
  outputPath: string;
};

export type TemporalRepairSpliceResult = {
  outputPath: string;
  durationSec: number;
  audioPreserved: boolean;
};

export class TemporalRepairError extends Error {
  constructor(
    public readonly code:
      | "tool_missing"
      | "invalid_source"
      | "unsupported_source"
      | "invalid_interval"
      | "context_too_long"
      | "process_failed"
      | "invalid_repair"
      | "invalid_output",
    message: string
  ) {
    super(message);
    this.name = "TemporalRepairError";
  }
}

type Probe = {
  width: number;
  height: number;
  fps: number;
  fpsRatio: string;
  durationSec: number;
  frameCount: number;
  hasAudio: boolean;
};

const MAX_CONTEXT_FRAMES = 240;
const MAX_SOURCE_SECONDS = 3600;
const MAX_SOURCE_PIXELS = 3840 * 2160;
const MAX_STDOUT = 2 * 1024 * 1024;

const defaultCommandRunner: CommandRunner = (executable, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      shell: false,
      windowsHide: true,
      signal: options.signal,
      timeout: options.timeoutMs ?? 600_000
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_STDOUT) child.kill();
    });
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 32_768) stderr += chunk.slice(0, 32_768 - stderr.length);
    });
    child.once("error", reject);
    child.once("close", code => resolve({
      stdout: stdout.slice(0, MAX_STDOUT),
      stderr,
      exitCode: code ?? -1
    }));
  });

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function absolutePath(value: unknown, field: string): string {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.trim() === "") {
    throw new TemporalRepairError("invalid_source", field + " must be an absolute local path.");
  }
  return path.resolve(value);
}

async function existingFile(value: string, code: "invalid_source" | "invalid_repair"): Promise<void> {
  try {
    const details = await stat(value);
    if (details.isFile()) return;
  } catch {
    // The caller receives only a generic error; paths may contain private data.
  }
  throw new TemporalRepairError(code, "The required local video file is unavailable.");
}

async function unusedOutput(value: string, sourcePath: string, repairedPath?: string): Promise<void> {
  if (value === sourcePath || value === repairedPath) {
    throw new TemporalRepairError("invalid_output", "The output must not overwrite an input video.");
  }
  try {
    await access(value);
    throw new TemporalRepairError("invalid_output", "The output path already exists.");
  } catch (error) {
    if (error instanceof TemporalRepairError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new TemporalRepairError("invalid_output", "The output path cannot be checked.");
    }
  }
}

function executablePath(value: string | undefined, envValue: string | undefined, fallback: string): string {
  return value?.trim() || envValue?.trim() || fallback;
}

function commandSetup(options: TemporalRepairOptions) {
  return {
    ffmpeg: executablePath(options.ffmpegPath, process.env.FFMPEG_PATH, "ffmpeg"),
    ffprobe: executablePath(options.ffprobePath, process.env.FFPROBE_PATH, "ffprobe"),
    run: options.runCommand ?? defaultCommandRunner,
    signal: options.signal,
    timeoutMs: options.timeoutMs
  };
}

async function checkedCommand(
  setup: ReturnType<typeof commandSetup>,
  executable: string,
  args: readonly string[],
  role: "preflight" | "probe" | "render"
): Promise<CommandResult> {
  let result: CommandResult;
  try {
    result = await setup.run(executable, args, {
      signal: setup.signal,
      timeoutMs: setup.timeoutMs
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || role === "preflight") {
      throw new TemporalRepairError("tool_missing", "FFmpeg and FFprobe must be installed and executable.");
    }
    throw new TemporalRepairError("process_failed", "The local video tool failed.");
  }
  if (result.exitCode !== 0) {
    throw new TemporalRepairError(role === "preflight" ? "tool_missing" : "process_failed",
      role === "preflight" ? "FFmpeg and FFprobe must be installed and executable."
        : "The local video tool could not process this video.");
  }
  if (result.stdout.length > MAX_STDOUT) {
    throw new TemporalRepairError("process_failed", "The local video tool produced an oversized response.");
  }
  return result;
}

async function preflight(setup: ReturnType<typeof commandSetup>): Promise<void> {
  await checkedCommand(setup, setup.ffmpeg, ["-hide_banner", "-version"], "preflight");
  await checkedCommand(setup, setup.ffprobe, ["-hide_banner", "-version"], "preflight");
}

function parseRate(value: unknown): { ratio: string; number: number } | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!denominator || !Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) return null;
  return { ratio: value, number: numerator / denominator };
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = positiveNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

async function probeMetadata(
  setup: ReturnType<typeof commandSetup>,
  filePath: string
): Promise<{ streams: Record<string, unknown>[]; format: Record<string, unknown> }> {
  const args = [
    "-v", "error",
    "-show_entries",
    "format=duration:stream=codec_type,width,height,r_frame_rate,avg_frame_rate,nb_frames,nb_read_frames,duration",
    "-of", "json", filePath
  ];
  const result = await checkedCommand(setup, setup.ffprobe, args, "probe");
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    throw new TemporalRepairError("unsupported_source", "The video metadata is invalid.");
  }
  const info = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const streams = Array.isArray(info.streams) ? info.streams as Record<string, unknown>[] : [];
  const format = info.format && typeof info.format === "object"
    ? info.format as Record<string, unknown> : {};
  return { streams, format };
}

async function probeVideo(
  setup: ReturnType<typeof commandSetup>,
  filePath: string
): Promise<Probe> {
  const { streams, format } = await probeMetadata(setup, filePath);
  const video = streams.find(stream => stream.codec_type === "video");
  if (!video) throw new TemporalRepairError("unsupported_source", "The file has no video stream.");
  const rate = parseRate(video.r_frame_rate);
  const averageRate = parseRate(video.avg_frame_rate);
  const width = positiveInteger(video.width);
  const height = positiveInteger(video.height);
  const durationSec = positiveNumber(format.duration) ?? positiveNumber(video.duration);
  if (!rate || !averageRate || !width || !height || !durationSec ||
      rate.number < 1 || rate.number > 60 ||
      Math.abs(rate.number - averageRate.number) / rate.number > 0.002) {
    throw new TemporalRepairError("unsupported_source",
      "A constant-frame-rate video with valid dimensions and duration is required.");
  }
  let frameCount = positiveInteger(video.nb_frames);
  if (!frameCount) {
    const counted = await checkedCommand(setup, setup.ffprobe, [
      "-v", "error", "-count_frames", "-select_streams", "v:0",
      "-show_entries", "stream=nb_read_frames", "-of", "json", filePath
    ], "probe");
    try {
      const parsed = JSON.parse(counted.stdout) as { streams?: { nb_read_frames?: unknown }[] };
      frameCount = positiveInteger(parsed.streams?.[0]?.nb_read_frames);
    } catch {
      // Unsupported containers may not expose a dependable frame count.
    }
  }
  if (!frameCount || Math.abs(frameCount / rate.number - durationSec) > Math.max(0.12, 3 / rate.number)) {
    throw new TemporalRepairError("unsupported_source",
      "An exact constant-frame-rate frame count is required.");
  }
  return {
    width,
    height,
    fps: rate.number,
    fpsRatio: rate.ratio,
    durationSec,
    frameCount,
    hasAudio: streams.some(stream => stream.codec_type === "audio")
  };
}

/** Provider MP4s may use a different frame rate or omit reliable nb_frames. */
async function probeProviderVideo(setup: ReturnType<typeof commandSetup>, filePath: string) {
  const { streams, format } = await probeMetadata(setup, filePath);
  const video = streams.find(stream => stream.codec_type === "video");
  if (!video) throw new TemporalRepairError("invalid_repair", "The provider returned no video stream.");
  const width = positiveInteger(video.width);
  const height = positiveInteger(video.height);
  const durationSec = positiveNumber(video.duration) ?? positiveNumber(format.duration);
  if (!width || !height || !durationSec || width * height > MAX_SOURCE_PIXELS ||
      durationSec > 30) {
    throw new TemporalRepairError("invalid_repair", "The provider video has invalid dimensions or duration.");
  }
  return { width, height, durationSec };
}

function sameFrameRate(a: Probe, b: Probe): boolean {
  return Math.abs(a.fps - b.fps) / a.fps <= 0.002;
}

function exactFrameSeconds(frame: number, fps: number): number {
  return Math.round((frame / fps) * 1_000_000) / 1_000_000;
}

function filterTimebase(fpsRatio: string): string {
  return "setpts=N/((" + fpsRatio + ")*TB)";
}

export async function prepareTemporalRepair(
  input: TemporalRepairInput,
  options: TemporalRepairOptions = {}
): Promise<TemporalRepairPlan> {
  const sourcePath = absolutePath(input.sourcePath, "sourcePath");
  const workDir = absolutePath(input.workDir, "workDir");
  if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 4000) {
    throw new TemporalRepairError("invalid_interval", "A repair prompt of at most 4,000 characters is required.");
  }
  if (!finiteNumber(input.startSec) || !finiteNumber(input.endSec) ||
      input.startSec < 0 || input.endSec <= input.startSec) {
    throw new TemporalRepairError("invalid_interval", "Choose a valid start and end time.");
  }
  const contextSec = input.contextSec ?? 0.75;
  if (!finiteNumber(contextSec) || contextSec < 0.25 || contextSec > 2) {
    throw new TemporalRepairError("invalid_interval", "Context must be between 0.25 and 2 seconds.");
  }
  await existingFile(sourcePath, "invalid_source");
  const setup = commandSetup(options);
  await preflight(setup);
  const source = await probeVideo(setup, sourcePath);
  if (source.durationSec > MAX_SOURCE_SECONDS || source.width * source.height > MAX_SOURCE_PIXELS ||
      source.width % 2 !== 0 || source.height % 2 !== 0) {
    throw new TemporalRepairError("unsupported_source",
      "Source video exceeds the supported one-hour or 4K envelope, or has odd dimensions.");
  }
  if (input.endSec > source.durationSec + 1 / source.fps) {
    throw new TemporalRepairError("invalid_interval", "The selected interval is outside the source video.");
  }
  const startFrame = Math.floor(input.startSec * source.fps + 0.000001);
  const endFrame = Math.min(source.frameCount, Math.ceil(input.endSec * source.fps - 0.000001));
  const targetFrames = endFrame - startFrame;
  if (startFrame < 0 || endFrame > source.frameCount || targetFrames < 1) {
    throw new TemporalRepairError("invalid_interval", "The selected interval contains no valid frames.");
  }
  if (targetFrames > MAX_CONTEXT_FRAMES - 2) {
    throw new TemporalRepairError("context_too_long",
      "Shorten the selected interval so the inpaint model has context frames.");
  }
  const desired = Math.max(1, Math.round(contextSec * source.fps));
  const spare = MAX_CONTEXT_FRAMES - targetFrames;
  const before = Math.min(desired, startFrame, Math.floor(spare / 2));
  const after = Math.min(desired, source.frameCount - endFrame, spare - before);
  if (before + after < 2) {
    throw new TemporalRepairError("context_too_long",
      "The selected interval needs at least two surrounding source frames.");
  }
  const contextStartFrame = startFrame - before;
  const contextEndFrame = endFrame + after;
  const frameCount = contextEndFrame - contextStartFrame;
  const targetStartFrameInContext = startFrame - contextStartFrame;
  const targetEndFrameInContext = endFrame - contextStartFrame;
  const fileId = randomUUID();
  const contextVideoPath = path.join(workDir, "context-" + fileId + ".mp4");
  const maskVideoPath = path.join(workDir, "mask-" + fileId + ".mp4");
  await mkdir(workDir, { recursive: true });
  try {
    const contextFilter = [
      "trim=start_frame=" + contextStartFrame + ":end_frame=" + contextEndFrame,
      filterTimebase(source.fpsRatio),
      "format=yuv420p"
    ].join(",");
    await checkedCommand(setup, setup.ffmpeg, [
      "-hide_banner", "-nostdin", "-loglevel", "error", "-n",
      "-i", sourcePath,
      "-map", "0:v:0", "-vf", contextFilter,
      "-frames:v", String(frameCount), "-an",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      contextVideoPath
    ], "render");
    const maskFilter = "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='gte(n," +
      targetStartFrameInContext + ")*lt(n," + targetEndFrameInContext +
      ")',format=yuv420p";
    await checkedCommand(setup, setup.ffmpeg, [
      "-hide_banner", "-nostdin", "-loglevel", "error", "-n",
      "-f", "lavfi", "-i",
      "color=c=black:s=" + source.width + "x" + source.height + ":r=" + source.fpsRatio,
      "-vf", maskFilter, "-frames:v", String(frameCount), "-an",
      "-c:v", "libx264", "-preset", "medium", "-crf", "0",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      maskVideoPath
    ], "render");
    await existingFile(contextVideoPath, "invalid_source");
    await existingFile(maskVideoPath, "invalid_source");
    const [context, mask] = await Promise.all([
      probeVideo(setup, contextVideoPath),
      probeVideo(setup, maskVideoPath)
    ]);
    if (context.frameCount !== frameCount || mask.frameCount !== frameCount ||
        context.width !== source.width || mask.width !== source.width ||
        context.height !== source.height || mask.height !== source.height ||
        !sameFrameRate(source, context) || !sameFrameRate(source, mask)) {
      throw new TemporalRepairError("process_failed", "Context video and mask are not frame aligned.");
    }
  } catch (error) {
    await Promise.allSettled([
      rm(contextVideoPath, { force: true }),
      rm(maskVideoPath, { force: true })
    ]);
    throw error;
  }
  return {
    sourcePath, workDir, contextVideoPath, maskVideoPath,
    prompt: input.prompt.trim(),
    sourceDurationSec: exactFrameSeconds(source.frameCount, source.fps),
    fps: source.fps, fpsRatio: source.fpsRatio,
    width: source.width, height: source.height,
    totalFrames: source.frameCount, startFrame, endFrame,
    contextStartFrame, contextEndFrame, frameCount,
    targetStartFrameInContext, targetEndFrameInContext,
    contextStartSec: exactFrameSeconds(contextStartFrame, source.fps),
    contextEndSec: exactFrameSeconds(contextEndFrame, source.fps),
    targetStartSec: exactFrameSeconds(startFrame, source.fps),
    targetEndSec: exactFrameSeconds(endFrame, source.fps),
    hasAudio: source.hasAudio
  };
}

function validatePlan(plan: TemporalRepairPlan): void {
  const planRate = parseRate(plan.fpsRatio);
  const wholeFrames = [
    plan.totalFrames, plan.startFrame, plan.endFrame,
    plan.contextStartFrame, plan.contextEndFrame, plan.frameCount,
    plan.targetStartFrameInContext, plan.targetEndFrameInContext
  ];
  if (wholeFrames.some(value => !Number.isSafeInteger(value)) ||
      !finiteNumber(plan.fps) || plan.fps < 1 || plan.fps > 60 ||
      plan.startFrame < 0 || plan.startFrame >= plan.endFrame ||
      plan.endFrame > plan.totalFrames ||
      plan.contextStartFrame > plan.startFrame ||
      plan.contextEndFrame < plan.endFrame ||
      plan.frameCount !== plan.contextEndFrame - plan.contextStartFrame ||
      plan.frameCount > MAX_CONTEXT_FRAMES ||
      plan.targetStartFrameInContext !== plan.startFrame - plan.contextStartFrame ||
      plan.targetEndFrameInContext !== plan.endFrame - plan.contextStartFrame ||
      !planRate || Math.abs(planRate.number - plan.fps) > 0.001) {
    throw new TemporalRepairError("invalid_repair", "The repair plan is invalid.");
  }
}

export async function spliceTemporalRepair(
  input: TemporalRepairSpliceInput,
  options: TemporalRepairOptions = {}
): Promise<TemporalRepairSpliceResult> {
  validatePlan(input.plan);
  const sourcePath = absolutePath(input.plan.sourcePath, "sourcePath");
  const repairedContextPath = absolutePath(input.repairedContextPath, "repairedContextPath");
  const outputPath = absolutePath(input.outputPath, "outputPath");
  await existingFile(sourcePath, "invalid_source");
  await existingFile(repairedContextPath, "invalid_repair");
  await unusedOutput(outputPath, sourcePath, repairedContextPath);
  const setup = commandSetup(options);
  await preflight(setup);
  const [source, repaired] = await Promise.all([
    probeVideo(setup, sourcePath),
    probeProviderVideo(setup, repairedContextPath)
  ]);
  const plan = input.plan;
  const contextDurationSec = plan.frameCount / plan.fps;
  if (source.frameCount !== plan.totalFrames ||
      source.width !== plan.width || source.height !== plan.height ||
      !sameFrameRate(source, { ...source, fps: plan.fps }) ||
      repaired.durationSec < contextDurationSec * 0.5 ||
      repaired.durationSec > contextDurationSec * 1.75 ||
      Math.abs(repaired.width / repaired.height - plan.width / plan.height) > 0.1) {
    throw new TemporalRepairError("invalid_repair",
      "The repaired clip does not match the source timeline.");
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  const timebase = filterTimebase(plan.fpsRatio);
  const segments: string[] = [];
  const labels: string[] = [];
  if (plan.startFrame > 0) {
    segments.push("[0:v:0]trim=start_frame=0:end_frame=" + plan.startFrame +
      "," + timebase + ",setsar=1,format=yuv420p[before]");
    labels.push("[before]");
  }
  // Retiming the whole provider clip keeps its masked region at the same
  // relative position even when the model rounds num_frames or changes FPS.
  const retime = contextDurationSec / repaired.durationSec;
  segments.push("[1:v:0]setpts=(PTS-STARTPTS)*" + retime.toFixed(9) +
    ",fps=fps=" + plan.fpsRatio + ":start_time=0" +
    ",tpad=stop_mode=clone:stop_duration=" + (2 / plan.fps).toFixed(9) +
    ",scale=" + plan.width + ":" + plan.height +
    ":force_original_aspect_ratio=increase:flags=lanczos" +
    ",crop=" + plan.width + ":" + plan.height +
    ",trim=start_frame=" + plan.targetStartFrameInContext +
    ":end_frame=" + plan.targetEndFrameInContext +
    "," + timebase + ",setsar=1,format=yuv420p[repaired]");
  labels.push("[repaired]");
  if (plan.endFrame < plan.totalFrames) {
    segments.push("[0:v:0]trim=start_frame=" + plan.endFrame +
      ":end_frame=" + plan.totalFrames +
      "," + timebase + ",setsar=1,format=yuv420p[after]");
    labels.push("[after]");
  }
  segments.push(labels.join("") + "concat=n=" + labels.length + ":v=1:a=0,format=yuv420p[video]");
  const filterComplex = segments.join(";");
  try {
    await checkedCommand(setup, setup.ffmpeg, [
      "-hide_banner", "-nostdin", "-loglevel", "error", "-n",
      "-i", sourcePath, "-i", repairedContextPath,
      "-filter_complex", filterComplex,
      "-map", "[video]", "-map", "0:a?",
      "-frames:v", String(plan.totalFrames),
      "-c:v", "libx264", "-preset", "medium", "-crf", "18",
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
      "-map_metadata", "0", "-movflags", "+faststart",
      outputPath
    ], "render");
    await existingFile(outputPath, "invalid_repair");
    const completed = await probeVideo(setup, outputPath);
    if (completed.frameCount !== plan.totalFrames ||
        completed.width !== plan.width || completed.height !== plan.height ||
        !sameFrameRate(source, completed) ||
        (plan.hasAudio && !completed.hasAudio)) {
      throw new TemporalRepairError("process_failed",
        "The spliced output failed frame or audio validation.");
    }
  } catch (error) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return {
    outputPath,
    durationSec: exactFrameSeconds(plan.totalFrames, plan.fps),
    audioPreserved: plan.hasAudio
  };
}


