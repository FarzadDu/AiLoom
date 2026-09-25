import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { prepareTemporalRepair, spliceTemporalRepair, TemporalRepairError } from "../src/server/media/temporal-repair";
import { videoToolPaths } from "../src/server/media/binaries";

type CommandCall = { executable: string; args: readonly string[] };
type ProbeKind = "source" | "context" | "mask" | "repaired" | "output";

function probeVideo(
  durationSec: number,
  frameCount: number,
  options: { fps?: string; averageFps?: string; audio?: boolean; width?: number; height?: number } = {}
): string {
  const fps = options.fps ?? "30/1";
  const streams: Record<string, unknown>[] = [{
    index: 0,
    codec_type: "video",
    codec_name: "h264",
    width: options.width ?? 1280,
    height: options.height ?? 720,
    pix_fmt: "yuv420p",
    r_frame_rate: fps,
    avg_frame_rate: options.averageFps ?? fps,
    time_base: "1/15360",
    duration: String(durationSec),
    nb_frames: String(frameCount)
  }];
  if (options.audio !== false) {
    streams.push({
      index: 1, codec_type: "audio", codec_name: "aac",
      sample_rate: "48000", duration: String(durationSec)
    });
  }
  return JSON.stringify({ streams, format: { duration: String(durationSec) } });
}

function fixture(options: {
  sourceDuration?: number;
  sourceFrames?: number;
  sourceFps?: string;
  sourceAverageFps?: string;
  sourceAudio?: boolean;
  contextFrames?: number;
  contextDuration?: number;
  repairedFrames?: number;
  repairedDuration?: number;
  repairedFps?: string;
  repairedAverageFps?: string;
  repairedWidth?: number;
  repairedHeight?: number;
  failTool?: "ffmpeg" | "ffprobe";
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-temporal-test-"));
  const sourcePath = join(directory, "source.mp4");
  const workDir = join(directory, "work");
  const repairedContextPath = join(directory, "repaired.mp4");
  const outputPath = join(directory, "final.mp4");
  mkdirSync(workDir);
  writeFileSync(sourcePath, "source fixture");
  writeFileSync(repairedContextPath, "repaired fixture");
  const calls: CommandCall[] = [];
  const sourceDuration = options.sourceDuration ?? 10;
  const sourceFrames = options.sourceFrames ?? 300;
  const sourceProbe = probeVideo(sourceDuration, sourceFrames, {
    fps: options.sourceFps,
    averageFps: options.sourceAverageFps,
    audio: options.sourceAudio
  });
  const contextProbe = probeVideo(options.contextDuration ?? 3, options.contextFrames ?? 90,
    { audio: false, fps: options.sourceFps });
  const repairedProbe = probeVideo(
    options.repairedDuration ?? 3,
    options.repairedFrames ?? 90,
    { audio: false, fps: options.repairedFps, averageFps: options.repairedAverageFps,
      width: options.repairedWidth, height: options.repairedHeight }
  );
  const outputProbe = probeVideo(sourceDuration, sourceFrames, {
    audio: options.sourceAudio, fps: options.sourceFps
  });
  const runCommand = async (executable: string, args: readonly string[]) => {
    calls.push({ executable, args: [...args] });
    const tool = basename(executable).toLowerCase();
    if (options.failTool && tool.includes(options.failTool)) {
      throw Object.assign(new Error("tool unavailable"), { code: "ENOENT" });
    }
    if (args.includes("-version")) {
      return { stdout: tool + " version mock", stderr: "", exitCode: 0 };
    }
    if (tool.includes("ffprobe")) {
      const path = args.at(-1) ?? "";
      let kind: ProbeKind = "source";
      if (path === repairedContextPath) kind = "repaired";
      else if (path === outputPath) kind = "output";
      else if (path.includes("mask")) kind = "mask";
      else if (path !== sourcePath) kind = "context";
      return {
        stdout: kind === "source" ? sourceProbe
          : kind === "repaired" ? repairedProbe
            : kind === "output" ? outputProbe : contextProbe,
        stderr: "",
        exitCode: 0
      };
    }
    if (tool.includes("ffmpeg")) {
      const path = args.at(-1) ?? "";
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "generated fixture");
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    throw new Error("Unexpected command: " + executable);
  };
  return {
    directory, sourcePath, workDir, repairedContextPath, outputPath,
    calls, runCommand,
    commandOptions: { ffmpegPath: "mock-ffmpeg", ffprobePath: "mock-ffprobe", runCommand },
    cleanup: () => rmSync(directory, { recursive: true, force: true })
  };
}

test("prepares a CFR context and mask at exact source frame boundaries", async () => {
  const f = fixture();
  try {
    const plan = await prepareTemporalRepair({
      sourcePath: f.sourcePath,
      workDir: f.workDir,
      startSec: 3,
      endSec: 4,
      contextSec: 1,
      prompt: "Restore a scratch on the subject"
    }, f.commandOptions);
    const values = plan as unknown as Record<string, unknown>;
    assert.equal(values.fps, 30);
    assert.equal(values.frameCount, 90);
    assert.equal(values.contextStartFrame, 60);
    assert.equal(values.contextEndFrame, 150);
    assert.equal(values.startFrame, 90);
    assert.equal(values.endFrame, 120);
    assert.equal(values.targetStartFrameInContext, 30);
    assert.equal(values.targetEndFrameInContext, 60);
    assert.ok(String(plan.contextVideoPath).startsWith(f.workDir));
    assert.ok(String(plan.maskVideoPath).startsWith(f.workDir));
    assert.notEqual(plan.contextVideoPath, plan.maskVideoPath);
    const ffmpeg = f.calls.filter(call => call.executable.includes("ffmpeg") && !call.args.includes("-version"));
    assert.equal(ffmpeg.length, 2);
    const extraction = ffmpeg.find(call => call.args.at(-1) === plan.contextVideoPath);
    const mask = ffmpeg.find(call => call.args.at(-1) === plan.maskVideoPath);
    assert.ok(extraction, "context video should be extracted");
    assert.ok(mask, "mask video should be generated");
    assert.ok(extraction.args.includes(f.sourcePath));
    assert.match(mask.args.join(" "), /30/);
    assert.match(mask.args.join(" "), /60|59/);
  } finally {
    f.cleanup();
  }
});

test("splices only repaired interval and keeps audio mapped from original source", async () => {
  const f = fixture();
  try {
    const plan = await prepareTemporalRepair({
      sourcePath: f.sourcePath,
      workDir: f.workDir,
      startSec: 3,
      endSec: 4,
      contextSec: 1,
      prompt: "Restore a scratch"
    }, f.commandOptions);
    const result = await spliceTemporalRepair({
      plan,
      repairedContextPath: f.repairedContextPath,
      outputPath: f.outputPath
    }, f.commandOptions);
    assert.equal(result.outputPath, f.outputPath);
    assert.equal(result.durationSec, 10);
    assert.equal(result.audioPreserved, true);
    const splice = f.calls.filter(call =>
      call.executable.includes("ffmpeg") && call.args.at(-1) === f.outputPath
    );
    assert.equal(splice.length, 1);
    const joined = splice[0].args.join(" ");
    assert.ok(splice[0].args.includes(f.sourcePath));
    assert.ok(splice[0].args.includes(f.repairedContextPath));
    assert.match(joined, /trim|select/);
    assert.match(joined, /concat/);
    assert.match(joined, /trim=start_frame=0:end_frame=90/);
    assert.match(joined, /trim=start_frame=30:end_frame=60/);
    assert.match(joined, /trim=start_frame=120:end_frame=300/);
    assert.match(joined, /0:a/);
    assert.deepEqual(splice[0].args.flatMap((arg, index) => arg === "-map" ? [splice[0].args[index + 1]] : []), ["[video]", "0:a?"]);
    const outputRateIndex = splice[0].args.indexOf("-r");
    assert.ok(outputRateIndex > splice[0].args.indexOf("-map"));
    assert.equal(splice[0].args[outputRateIndex + 1], plan.fpsRatio);
    assert.ok(outputRateIndex < splice[0].args.indexOf("-frames:v"));
  } finally {
    f.cleanup();
  }
});

test("invalid ranges fail before running media commands", async () => {
  const f = fixture();
  try {
    for (const [startSec, endSec] of [[-1, 1], [4, 4], [5, 4], [0, 11]]) {
      await assert.rejects(prepareTemporalRepair({
        sourcePath: f.sourcePath, workDir: f.workDir,
        startSec, endSec, prompt: "Repair"
      }, f.commandOptions));
    }
    assert.equal(f.calls.some(call => call.executable.includes("ffmpeg") && !call.args.includes("-version")), false);
  } finally {
    f.cleanup();
  }
});

test("variable frame rate source and excessive context frames are rejected", async () => {
  const variable = fixture({ sourceAverageFps: "25/1" });
  try {
    await assert.rejects(prepareTemporalRepair({
      sourcePath: variable.sourcePath, workDir: variable.workDir,
      startSec: 3, endSec: 4, prompt: "Repair"
    }, variable.commandOptions));
    assert.equal(variable.calls.some(call => call.executable.includes("ffmpeg") && !call.args.includes("-version")), false);
  } finally {
    variable.cleanup();
  }

  const oversized = fixture({ sourceDuration: 20, sourceFrames: 600 });
  try {
    await assert.rejects(prepareTemporalRepair({
      sourcePath: oversized.sourcePath, workDir: oversized.workDir,
      startSec: 4, endSec: 13, contextSec: 2, prompt: "Repair"
    }, oversized.commandOptions));
    assert.equal(oversized.calls.some(call => call.executable.includes("ffmpeg") && !call.args.includes("-version")), false);
  } finally {
    oversized.cleanup();
  }
});

test("missing ffprobe or ffmpeg fails explicitly through the injected runner", async () => {
  for (const failTool of ["ffprobe", "ffmpeg"] as const) {
    const f = fixture({ failTool });
    try {
      await assert.rejects(prepareTemporalRepair({
        sourcePath: f.sourcePath, workDir: f.workDir,
        startSec: 3, endSec: 4, prompt: "Repair"
      }, f.commandOptions));
      assert.ok(f.calls.some(call => call.executable.includes(failTool)));
    } finally {
      f.cleanup();
    }
  }
});

test("splicing retimes a provider clip with rounded frames and a different frame rate", async () => {
  const f = fixture({ repairedFrames: 121, repairedDuration: 121 / 24,
    repairedFps: "24/1", repairedAverageFps: "25/1" });
  try {
    const plan = await prepareTemporalRepair({
      sourcePath: f.sourcePath, workDir: f.workDir,
      startSec: 3, endSec: 4, contextSec: 1, prompt: "Repair"
    }, f.commandOptions);
    await spliceTemporalRepair({
      plan, repairedContextPath: f.repairedContextPath, outputPath: f.outputPath
    }, f.commandOptions);
    const render = f.calls.find(call => call.executable.includes("ffmpeg") &&
      call.args.at(-1) === f.outputPath);
    assert.ok(render);
    const filter = render.args[render.args.indexOf("-filter_complex") + 1];
    assert.match(filter, /setpts=\(PTS-STARTPTS\)\*0\.595/);
    assert.match(filter, /fps=fps=30\/1:start_time=0/);
    assert.match(filter, /tpad=stop_mode=clone/);
    assert.match(filter, /trim=start_frame=30:end_frame=60/);
  } finally {
    f.cleanup();
  }
});

test("accepts LTX's 1280x768 alignment for a 1280x720 repair with only 6.25% center crop", async () => {
  const f = fixture({ sourceDuration: 4, sourceFrames: 96, sourceFps: "24/1",
    contextDuration: 3.5, contextFrames: 84,
    repairedDuration: 3.5, repairedFrames: 84, repairedFps: "24/1",
    repairedWidth: 1280, repairedHeight: 768 });
  try {
    const plan = await prepareTemporalRepair({
      sourcePath: f.sourcePath, workDir: f.workDir,
      startSec: 0.75, endSec: 2.75, contextSec: 0.75,
      prompt: "Repair only the selected part"
    }, f.commandOptions);
    assert.equal(plan.frameCount, 84);
    assert.equal(plan.targetStartFrameInContext, 18);
    assert.equal(plan.targetEndFrameInContext, 66);
    await spliceTemporalRepair({ plan, repairedContextPath: f.repairedContextPath,
      outputPath: f.outputPath }, f.commandOptions);
    const render = f.calls.find(call => call.executable.includes("ffmpeg") &&
      call.args.at(-1) === f.outputPath);
    assert.ok(render);
    const filter = render.args[render.args.indexOf("-filter_complex") + 1];
    assert.match(filter, /scale=1280:720:force_original_aspect_ratio=increase/);
    assert.match(filter, /crop=1280:720,trim=start_frame=18:end_frame=66/);
  } finally {
    f.cleanup();
  }
});

test("rejects provider dimensions that would crop over 10% of the generated frame", async () => {
  const f = fixture({ repairedWidth: 1280, repairedHeight: 960 });
  try {
    const plan = await prepareTemporalRepair({
      sourcePath: f.sourcePath, workDir: f.workDir,
      startSec: 3, endSec: 4, contextSec: 1, prompt: "Repair"
    }, f.commandOptions);
    await assert.rejects(spliceTemporalRepair({
      plan, repairedContextPath: f.repairedContextPath, outputPath: f.outputPath
    }, f.commandOptions), error => error instanceof TemporalRepairError &&
      error.code === "invalid_repair" &&
      error.diagnostic?.reason === "provider_aspect_crop_fraction" &&
      Math.abs((error.diagnostic.actual ?? 0) - 0.25) < 0.000001);
  } finally {
    f.cleanup();
  }
});

test("splicing rejects a provider clip far outside the requested context duration", async () => {
  const f = fixture({ repairedFrames: 180, repairedDuration: 6 });
  try {
    const plan = await prepareTemporalRepair({
      sourcePath: f.sourcePath, workDir: f.workDir,
      startSec: 3, endSec: 4, contextSec: 1, prompt: "Repair"
    }, f.commandOptions);
    await assert.rejects(spliceTemporalRepair({
      plan, repairedContextPath: f.repairedContextPath, outputPath: f.outputPath
    }, f.commandOptions), error => error instanceof TemporalRepairError &&
      error.code === "invalid_repair" && error.diagnostic?.reason === "provider_duration" &&
      error.diagnostic.actual === 6 && error.diagnostic.expected === 3);
    assert.equal(f.calls.some(call => call.executable.includes("ffmpeg") &&
      call.args.at(-1) === f.outputPath), false);
  } finally {
    f.cleanup();
  }
});

test("real FFmpeg splice preserves source frames and audio after provider retiming", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ailoom-temporal-ffmpeg-"));
  const sourcePath = join(directory, "source.mp4");
  const repairedContextPath = join(directory, "provider.mp4");
  const outputPath = join(directory, "final.mp4");
  const paths = videoToolPaths();
  const run = (executable: string, args: string[]) => new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString().slice(0, 500); });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(`Media command failed: ${stderr}`)));
  });
  try {
    await run(paths.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", sourcePath]);
    await run(paths.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x192:rate=25",
      "-t", "3", "-c:v", "libx264", "-preset", "ultrafast", repairedContextPath]);
    const plan = await prepareTemporalRepair({
      sourcePath, workDir: join(directory, "work"), startSec: 1,
      endSec: 2, contextSec: 0.5, prompt: "Replace the marked second"
    }, paths);
    const result = await spliceTemporalRepair({ plan, repairedContextPath, outputPath }, paths);
    assert.equal(result.audioPreserved, true);
    assert.equal(result.durationSec, 4);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});




