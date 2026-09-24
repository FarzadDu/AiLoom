import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function bundledPath(packageName: string, field?: string): string | null {
  try {
    const packageValue: unknown = require(packageName);
    const value = field && packageValue && typeof packageValue === "object" && field in packageValue
      ? (packageValue as Record<string, unknown>)[field] : packageValue;
    return typeof value === "string" && existsSync(value) ? value : null;
  } catch { return null; }
}

export function videoToolPaths() {
  return {
    ffmpegPath: process.env.FFMPEG_PATH?.trim() || bundledPath("ffmpeg-static") || "ffmpeg",
    ffprobePath: process.env.FFPROBE_PATH?.trim() || bundledPath("ffprobe-static", "path") || "ffprobe"
  };
}
