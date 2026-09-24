export type FirstLastControls = {
  prompt: string;
  durationSec: 4 | 6 | 8;
  aspectRatio: "16:9" | "9:16";
  resolution: "720p" | "1080p";
  audio: boolean;
};

export function firstLastRequestIdentity(firstAssetId: string, lastAssetId: string, controls: FirstLastControls): string {
  // Signed access URLs are deliberately absent: renewing them must replay the
  // same paid generation when the original HTTP response was lost.
  return JSON.stringify({ firstAssetId, lastAssetId, ...controls });
}
