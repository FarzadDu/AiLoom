import assert from "node:assert/strict";
import { test } from "node:test";
import { listMediaModels } from "../src/server/media/registry";
import { getMediaTask, MediaRequestError, prepareMediaRequest, submitMediaRequest } from "../src/server/media/service";

const imageUrl = "https://assets.example.com/reference.png";
const ids = {
  veo: "fal-ai/veo3.1",
  klingTurbo: "fal-ai/kling-video/v3/turbo/standard/text-to-video",
  hailuoText: "fal-ai/minimax/hailuo-2.3/standard/text-to-video",
  hailuoImage: "fal-ai/minimax/hailuo-2.3/standard/image-to-video",
  luma: "fal-ai/luma-dream-machine/ray-2-flash"
};

test("five documented video endpoints appear in their actual operations and map distinct controls", () => {
  for (const [name, id] of Object.entries(ids)) {
    const operation = name === "hailuoImage" ? "image_to_video" : "text_to_video";
    const model = listMediaModels(operation).find(item => item.id === id);
    assert.equal(model?.outputKind, "video", name);
    assert.ok(model?.docsUrl.startsWith("https://fal.ai/models/"), name);
  }

  const veo = prepareMediaRequest({ modelId: ids.veo, operation: "text_to_video",
    prompt: "A cinematic coastline", durationSec: 6, aspectRatio: "9:16", resolution: "4k", audio: false });
  assert.deepEqual(veo.providerInput, { prompt: "A cinematic coastline", duration: "6s",
    aspect_ratio: "9:16", resolution: "4k", generate_audio: false });
  assert.equal(veo.priceEstimate?.amountUsd, 2.4);

  const kling = prepareMediaRequest({ modelId: ids.klingTurbo, operation: "text_to_video",
    prompt: "A quiet city street", durationSec: 15, aspectRatio: "1:1" });
  assert.deepEqual(kling.providerInput, { prompt: "A quiet city street", duration: "15",
    aspect_ratio: "1:1" });
  assert.equal(kling.priceEstimate?.amountUsd, 1.68);

  const hailuoText = prepareMediaRequest({ modelId: ids.hailuoText, operation: "text_to_video",
    prompt: "A paper boat on a river", durationSec: 10, promptOptimizer: false });
  assert.deepEqual(hailuoText.providerInput, { prompt: "A paper boat on a river",
    prompt_optimizer: false, duration: "10" });
  assert.equal(hailuoText.priceEstimate?.amountUsd, 0.56);

  const hailuoImage = prepareMediaRequest({ modelId: ids.hailuoImage, operation: "image_to_video",
    prompt: "The boat drifts downstream", imageUrl });
  assert.deepEqual(hailuoImage.providerInput, { prompt: "The boat drifts downstream",
    image_url: imageUrl, prompt_optimizer: true, duration: "6" });
  assert.equal(hailuoImage.priceEstimate?.amountUsd, 0.28);

  const luma = prepareMediaRequest({ modelId: ids.luma, operation: "text_to_video",
    prompt: "Clouds roll across the mountain", durationSec: 9, aspectRatio: "21:9",
    resolution: "1080p", loop: true });
  assert.deepEqual(luma.providerInput, { prompt: "Clouds roll across the mountain",
    aspect_ratio: "21:9", resolution: "1080p", duration: "9s", loop: true });
  assert.equal(luma.priceEstimate?.amountUsd, 1.6);
});

test("new video model bounds and incompatible controls are rejected before submission", () => {
  const invalid = [
    { modelId: ids.veo, operation: "text_to_video", prompt: "A coast", durationSec: 5 },
    { modelId: ids.klingTurbo, operation: "text_to_video", prompt: "A coast", durationSec: 16 },
    { modelId: ids.klingTurbo, operation: "text_to_video", prompt: "A coast", audio: true },
    { modelId: ids.hailuoText, operation: "text_to_video", prompt: "A coast", durationSec: 8 },
    { modelId: ids.hailuoImage, operation: "image_to_video", prompt: "A coast" },
    { modelId: ids.hailuoImage, operation: "image_to_video", prompt: "A coast",
      imageUrl: "http://127.0.0.1/private.png" },
    { modelId: ids.luma, operation: "text_to_video", prompt: "A coast", durationSec: 10 },
    { modelId: ids.luma, operation: "text_to_video", prompt: "A coast", resolution: "4k" }
  ];
  for (const input of invalid) {
    assert.throws(() => prepareMediaRequest(input),
      (error: unknown) => error instanceof MediaRequestError && error.code === "invalid_input",
      input.modelId);
  }
});

test("new fal video family uses queue lifecycle and imports completed video", async () => {
  const modelId = ids.hailuoText;
  const queueBase = `https://queue.fal.run/${modelId}/requests/hailuo_1`;
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const address = String(url);
    calls.push(address);
    if (init?.method === "POST") return Response.json({ request_id: "hailuo_1",
      status_url: `${queueBase}/status`, response_url: queueBase });
    if (address.endsWith("/status?logs=0")) return Response.json({ request_id: "hailuo_1",
      status: "COMPLETED" });
    return Response.json({ video: { url: "https://cdn.example.com/hailuo.mp4",
      content_type: "video/mp4" } });
  };
  const submitted = await submitMediaRequest({ modelId, operation: "text_to_video",
    prompt: "A paper boat on a river" }, { fetcher, apiKeys: { fal: "test-key" } });
  const task = await getMediaTask({ modelId,
    providerTaskId: submitted.providerQueueReference! }, { fetcher, apiKeys: { fal: "test-key" } });
  assert.deepEqual(calls, [ `https://queue.fal.run/${modelId}`,
    `${queueBase}/status?logs=0`, queueBase ]);
  assert.equal(task.state, "completed");
  assert.deepEqual(task.assets, [{ kind: "video", url: "https://cdn.example.com/hailuo.mp4",
    contentType: "video/mp4" }]);
});
