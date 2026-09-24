export const upscalePresets = [
  "Standard V2", "High Fidelity V3", "High Fidelity V2", "Low Resolution V2",
  "CGI", "Text Refine", "Faces"
] as const;

export type UpscalePreset = typeof upscalePresets[number];
export type UpscaleSettings = {
  factor: 2 | 4;
  preset: UpscalePreset;
  outputFormat: "jpeg" | "png";
};

export function upscaleRequest(imageUrl: string, settings: UpscaleSettings) {
  return {
    modelId: "topaz/upscale/image/precision",
    operation: "image_upscale",
    imageUrl,
    upscaleFactor: settings.factor,
    upscaleModel: settings.preset,
    outputFormat: settings.outputFormat
  } as const;
}

export function upscaleRequestIdentity(sourceAssetId: string, settings: UpscaleSettings): string {
  return JSON.stringify({ sourceAssetId, ...settings });
}
