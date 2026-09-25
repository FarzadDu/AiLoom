import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseStoryboardRenderRequest, storyboardAssetsFromPayload, storyboardFromPayload,
  storyboardRenderReadiness, storyboardRenderSnapshot, storyboardVideoModels,
  storyboardsFromPayload, normalizeShotControls, type StoryboardShot } from "../src/components/storyboard-ui-data";
import { storyboardCopy } from "../src/app/storyboards/copy";

const boardId = "f7669556-33fb-4fa3-a963-ce955b46bb0f";
const shotId = "b5df4085-d1d8-42ed-8220-d9c0bf8cdf4e";
const imageId = "2478e4e9-8744-4faf-a331-314967258e4a";
const videoId = "bf08f7d7-5943-4077-ac30-a187071afac1";
const board = { id: boardId, title: "A film", description: "A short story",
  projectId: null, updatedAt: "2026-09-25T00:00:00.000Z" };
const shot: StoryboardShot = { id: shotId, storyboardId: boardId, position: 0, title: "Opening",
  prompt: "Slow tracking shot", modelId: "fal-ai/veo3.1/fast", durationSec: 8,
  aspectRatio: "16:9", firstFrameAssetId: imageId, lastFrameAssetId: null,
  referenceAssetIds: [imageId], outputAssetId: videoId };

test("storyboard payloads require owned-looking IDs, ordered shots, and bounded fields", () => {
  assert.deepEqual(storyboardsFromPayload({ storyboards: [board] }), [board]);
  assert.deepEqual(storyboardFromPayload({ storyboard: { ...board, shots: [
    { ...shot, id: "0edf035f-6b11-4e67-94ac-57b98c46ac11", position: 1 }, shot
  ] } })?.shots.map(item => item.position), [0, 1]);
  assert.equal(storyboardFromPayload({ storyboard: { ...board, shots: [{ ...shot,
    storyboardId: "3a9765f5-40fc-4f3f-a1c8-2be8db147298" }] } }), null);
  assert.equal(storyboardFromPayload({ storyboard: { ...board, shots: [{ ...shot,
    outputAssetId: "https://third-party.example/video.mp4" }] } }), null);
  assert.equal(storyboardsFromPayload({ storyboards: [{ ...board, id: "unsafe" }] }), null);
});

test("private library parser excludes files and trusts local asset URLs only", () => {
  const parsed = storyboardAssetsFromPayload({ assets: [
    { id: imageId, kind: "image", source: "upload", originalName: "first.png",
      url: "https://outside.example/first.png" },
    { id: videoId, kind: "video", source: "generation", originalName: null },
    { id: "c4157132-72ef-4b24-aaf3-735cc4e209a9", kind: "file", source: "upload" },
    { id: "invalid", kind: "audio", source: "upload" }
  ], nextCursor: "abc_123" });
  assert.deepEqual(parsed?.assets.map(item => item.url), [
    `/api/assets/${imageId}`, `/api/assets/${videoId}`
  ]);
  assert.equal(parsed?.nextCursor, "abc_123");
});

test("planner shows video models and normalizes Veo controls", () => {
  const models = storyboardVideoModels({ models: [
    { id: "veo", name: "Veo", provider: "fal", outputKind: "video",
      operations: ["text_to_video"] },
    { id: "frame", name: "Frames", provider: "fal", outputKind: "video",
      operations: ["first_last_frame_to_video"] },
    { id: "image", name: "Image", provider: "fal", outputKind: "image",
      operations: ["text_to_image"] },
    { id: "inpaint", name: "Inpaint", provider: "fal", outputKind: "video",
      operations: ["temporal_inpaint"] }
  ] });
  assert.deepEqual(models.map(item => item.id), ["veo", "frame"]);
  assert.deepEqual(normalizeShotControls("fal-ai/veo3.1/fast", 15, "1:1"),
    { durationSec: 8, aspectRatio: "16:9" });
  assert.deepEqual(normalizeShotControls("other-model", 15, "1:1"),
    { durationSec: 15, aspectRatio: "1:1" });
});

test("render readiness requires an output asset on every nonempty shot", () => {
  assert.deepEqual(storyboardRenderReadiness([]), { completed: 0, total: 0, ready: false });
  assert.deepEqual(storyboardRenderReadiness([{ outputAssetId: videoId }, { outputAssetId: null }]),
    { completed: 1, total: 2, ready: false });
  assert.deepEqual(storyboardRenderReadiness([{ outputAssetId: videoId }]),
    { completed: 1, total: 1, ready: true });
  assert.equal(storyboardRenderReadiness([{ outputAssetId: "remote-url" }]).ready, false);
});

test("render request identity survives a lost response for the same shot snapshot", () => {
  const snapshot = storyboardRenderSnapshot({ id: boardId, shots: [shot] });
  let generated = 0;
  const first = chooseStoryboardRenderRequest(null, snapshot, () => {
    generated++;
    return "65329e38-c85c-4b7b-97de-3859f57aa706";
  });
  const retry = chooseStoryboardRenderRequest(JSON.stringify(first), snapshot, () => {
    generated++;
    return "9e7a21b0-4158-425a-9fbf-70ad4f5562a0";
  });
  assert.deepEqual(retry, first);
  assert.equal(generated, 1);
  const changed = storyboardRenderSnapshot({ id: boardId, shots: [
    { ...shot, outputAssetId: "347eb11a-c1bf-48cc-b250-f1e8307d7f71" }
  ] });
  assert.notEqual(changed, snapshot);
  assert.equal(chooseStoryboardRenderRequest(JSON.stringify(first), changed, () =>
    "9e7a21b0-4158-425a-9fbf-70ad4f5562a0").key,
  "9e7a21b0-4158-425a-9fbf-70ad4f5562a0");
  assert.equal(chooseStoryboardRenderRequest("broken", snapshot, () =>
    "9e7a21b0-4158-425a-9fbf-70ad4f5562a0").key,
  "9e7a21b0-4158-425a-9fbf-70ad4f5562a0");
});

test("English and Persian planner labels cover the same controls", () => {
  assert.deepEqual(Object.keys(storyboardCopy.en).sort(), Object.keys(storyboardCopy.fa).sort());
  for (const value of Object.values(storyboardCopy.en)) assert.ok(value.trim());
  for (const value of Object.values(storyboardCopy.fa)) assert.ok(value.trim());
});
