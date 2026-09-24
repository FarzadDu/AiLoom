import assert from "node:assert/strict";
import test from "node:test";
import { upscalePresets, upscaleRequest, upscaleRequestIdentity } from "../src/components/upscale-request";

test("upscale request maps the chosen Topaz controls without a prompt", () => {
  const settings = { factor: 4 as const, preset: "High Fidelity V3" as const, outputFormat: "png" as const };
  assert.deepEqual(upscaleRequest("https://ailoom.example/api/assets/source?token=one", settings), {
    modelId: "topaz/upscale/image/precision",
    operation: "image_upscale",
    imageUrl: "https://ailoom.example/api/assets/source?token=one",
    upscaleFactor: 4,
    upscaleModel: "High Fidelity V3",
    outputFormat: "png"
  });
  assert.ok(upscalePresets.includes("Faces"));
});

test("retry identity changes with source or controls, not renewed signed URL", () => {
  const settings = { factor: 2 as const, preset: "Standard V2" as const, outputFormat: "jpeg" as const };
  const original = upscaleRequestIdentity("asset-one", settings);
  assert.equal(original, upscaleRequestIdentity("asset-one", { ...settings }));
  assert.notEqual(original, upscaleRequestIdentity("asset-two", settings));
  assert.notEqual(original, upscaleRequestIdentity("asset-one", { ...settings, factor: 4 }));
});
