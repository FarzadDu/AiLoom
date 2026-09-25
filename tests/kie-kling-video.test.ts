import assert from "node:assert/strict";
import { test } from "node:test";
import { listMediaModels } from "../src/server/media/registry";
import { getMediaTask, MediaRequestError, prepareMediaRequest, submitMediaRequest } from "../src/server/media/service";

const modelId = "kling-3.0/video";
const imageUrl = "https://assets.example.com/first-frame.png";

test("Kie Kling 3.0 is available for both text and image video with the requested operation retained", () => {
  assert.ok(listMediaModels("text_to_video").some(model => model.id === modelId));
  assert.ok(listMediaModels("image_to_video").some(model => model.id === modelId));
  const text = prepareMediaRequest({ modelId, operation: "text_to_video", prompt: "A bird in flight",
    durationSec: 15, aspectRatio: "9:16", audio: false, mode: "4K" });
  assert.equal(text.provider, "kie");
  assert.equal(text.operation, "text_to_video");
  assert.deepEqual(text.providerInput, { prompt: "A bird in flight", duration: "15",
    aspect_ratio: "9:16", sound: false, mode: "4K", multi_shots: false });
  assert.equal(text.priceEstimate, null);

  const image = prepareMediaRequest({ modelId, operation: "image_to_video",
    prompt: "Animate the scene", imageUrl, durationSec: 3, audio: true, mode: "pro" });
  assert.equal(image.operation, "image_to_video");
  assert.deepEqual(image.providerInput, { prompt: "Animate the scene", image_urls: [imageUrl],
    duration: "3", sound: true, mode: "pro", multi_shots: false });
});

test("Kie Kling 3.0 rejects unsupported controls before a paid request", () => {
  const invalid = [
    { modelId, operation: "image_to_video", prompt: "Animate" },
    { modelId, operation: "text_to_video", prompt: "Animate", imageUrl },
    { modelId, operation: "image_to_video", prompt: "Animate", imageUrl: "http://127.0.0.1/x.png" },
    { modelId, operation: "text_to_video", prompt: "Animate", durationSec: 2 },
    { modelId, operation: "text_to_video", prompt: "Animate", durationSec: 16 },
    { modelId, operation: "text_to_video", prompt: "Animate", durationSec: 5.5 },
    { modelId, operation: "text_to_video", prompt: "Animate", aspectRatio: "4:3" },
    { modelId, operation: "text_to_video", prompt: "Animate", mode: "ultra" },
    { modelId, operation: "text_to_video", prompt: "Animate", multiShots: true }
  ];
  for (const input of invalid) {
    assert.throws(() => prepareMediaRequest(input),
      (error: unknown) => error instanceof MediaRequestError && error.code === "invalid_input",
      JSON.stringify(input));
  }
});

test("Kie Kling image video submits the exact model and imports a completed video", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (init?.method === "POST") return Response.json({ code: 200, data: { taskId: "kling_3" } });
    return Response.json({ code: 200, data: { taskId: "kling_3", model: modelId,
      state: "success", resultJson: JSON.stringify({
        resultUrls: ["https://cdn.example.com/kling-3.mp4"] }) } });
  };
  const submitted = await submitMediaRequest({ modelId, operation: "image_to_video",
    prompt: "Move the camera", imageUrl }, { fetcher, apiKeys: { kie: "test-key" } });
  assert.equal(submitted.operation, "image_to_video");
  assert.equal(submitted.providerTaskId, "kling_3");
  assert.deepEqual(calls[0], { url: "https://api.kie.ai/api/v1/jobs/createTask", body: {
    model: modelId, input: { prompt: "Move the camera", image_urls: [imageUrl], duration: "5",
      multi_shots: false } } });
  const task = await getMediaTask({ modelId, providerTaskId: submitted.providerTaskId },
    { fetcher, apiKeys: { kie: "test-key" } });
  assert.equal(calls[1]?.url, "https://api.kie.ai/api/v1/jobs/recordInfo?taskId=kling_3");
  assert.equal(task.state, "completed");
  assert.deepEqual(task.assets, [{ kind: "video", url: "https://cdn.example.com/kling-3.mp4",
    contentType: null }]);
});
