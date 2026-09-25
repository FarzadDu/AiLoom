import assert from "node:assert/strict";
import { test } from "node:test";
import { listMediaModels } from "../src/server/media/registry";
import { getMediaTask, MediaRequestError, prepareMediaRequest, submitMediaRequest } from "../src/server/media/service";

const imageUrl = "https://assets.example.com/frame.png";
const videoUrl = "https://assets.example.com/clip.mp4";

test("video catalog exposes only documented modes and maps their distinct provider fields", () => {
  const ids = {
    klingText: "fal-ai/kling-video/v3/standard/text-to-video",
    klingImage: "fal-ai/kling-video/v3/standard/image-to-video",
    wanText: "fal-ai/wan/v2.7/text-to-video",
    wanImage: "fal-ai/wan/v2.7/image-to-video",
    wanReference: "fal-ai/wan/v2.7/reference-to-video",
    openVideo: "wavespeed-ai/open-video/image-to-video"
  };
  for (const [mode, modelId] of Object.entries(ids)) {
    const operation = mode.endsWith("Text") ? "text_to_video"
      : mode === "wanReference" ? "reference_to_video" : "image_to_video";
    const model = listMediaModels(operation).find(item => item.id === modelId);
    assert.equal(model?.outputKind, "video", `${mode} should have an importable video output`);
    assert.ok(model?.docsUrl.startsWith("https://"));
  }

  const klingText = prepareMediaRequest({ modelId: ids.klingText, operation: "text_to_video",
    prompt: "A moving train", durationSec: 8, aspectRatio: "9:16", audio: false });
  assert.deepEqual(klingText.providerInput, { prompt: "A moving train", duration: "8",
    aspect_ratio: "9:16", generate_audio: false });
  assert.equal(klingText.priceEstimate?.amountUsd, 0.672);

  const klingImage = prepareMediaRequest({ modelId: ids.klingImage, operation: "image_to_video",
    prompt: "A slow push in", imageUrl });
  assert.deepEqual(klingImage.providerInput, { prompt: "A slow push in", start_image_url: imageUrl,
    duration: "5", generate_audio: true });
  assert.equal(klingImage.priceEstimate?.amountUsd, 0.63);

  const wanText = prepareMediaRequest({ modelId: ids.wanText, operation: "text_to_video",
    prompt: "A moving train", durationSec: 4, aspectRatio: "4:3", resolution: "1080p" });
  assert.deepEqual(wanText.providerInput, { prompt: "A moving train", duration: 4,
    aspect_ratio: "4:3", resolution: "1080p", enable_safety_checker: true });
  assert.equal(wanText.priceEstimate?.amountUsd, 0.6);

  const wanImage = prepareMediaRequest({ modelId: ids.wanImage, operation: "image_to_video",
    prompt: "A slow push in", imageUrl, durationSec: 3 });
  assert.deepEqual(wanImage.providerInput, { prompt: "A slow push in", image_url: imageUrl,
    duration: 3, resolution: "720p", enable_safety_checker: true });
  assert.equal(wanImage.priceEstimate?.amountUsd, 0.3);

  const wanReference = prepareMediaRequest({ modelId: ids.wanReference,
    operation: "reference_to_video", prompt: "Follow this character", imageUrls: [imageUrl],
    durationSec: 6, aspectRatio: "1:1" });
  assert.deepEqual(wanReference.providerInput, { prompt: "Follow this character",
    reference_image_urls: [imageUrl], duration: 6, aspect_ratio: "1:1", resolution: "720p",
    enable_safety_checker: true });
  assert.equal(wanReference.priceEstimate?.amountUsd, 0.6);
  const withVideo = prepareMediaRequest({ modelId: ids.wanReference,
    operation: "reference_to_video", prompt: "Follow this motion", videoUrls: [videoUrl] });
  assert.deepEqual(withVideo.providerInput.reference_video_urls, [videoUrl]);
  assert.equal(withVideo.priceEstimate, null, "input-video seconds are billed but unknown from its URL");

  const openVideo = prepareMediaRequest({ modelId: ids.openVideo, operation: "image_to_video",
    prompt: "A slow push in", imageUrl, durationSec: 20, resolution: "1080p", preset: "original" });
  assert.equal(openVideo.provider, "wavespeed");
  assert.deepEqual(openVideo.providerInput, { image: imageUrl, prompt: "A slow push in",
    preset: "original", resolution: "1080p", duration: 20 });
  assert.equal(openVideo.priceEstimate?.amountUsd, 1.2);
});

test("video model constraints fail before any billable submission", () => {
  const base = { prompt: "Move the camera" };
  const invalid = [
    { ...base, modelId: "fal-ai/kling-video/v3/standard/text-to-video",
      operation: "text_to_video", durationSec: 16 },
    { ...base, modelId: "fal-ai/kling-video/v3/standard/image-to-video",
      operation: "image_to_video", imageUrl: "http://127.0.0.1/private.png" },
    { ...base, modelId: "fal-ai/wan/v2.7/text-to-video",
      operation: "text_to_video", audio: false },
    { ...base, modelId: "fal-ai/wan/v2.7/reference-to-video",
      operation: "reference_to_video", imageUrls: [] },
    { ...base, modelId: "fal-ai/wan/v2.7/reference-to-video",
      operation: "reference_to_video", imageUrls: [imageUrl], durationSec: 11 },
    { ...base, modelId: "wavespeed-ai/open-video/image-to-video",
      operation: "image_to_video", imageUrl, durationSec: 21 },
    { ...base, modelId: "wavespeed-ai/open-video/image-to-video",
      operation: "image_to_video", imageUrl, audio: false }
  ];
  for (const input of invalid) {
    assert.throws(() => prepareMediaRequest(input),
      (error: unknown) => error instanceof MediaRequestError && error.code === "invalid_input",
      input.modelId);
  }
});

test("new fal video endpoints retain queue URLs and import the completed private video", async () => {
  const modelId = "fal-ai/kling-video/v3/standard/text-to-video";
  const queueBase = "https://queue.fal.run/fal-ai/kling-video/v3/standard/text-to-video/requests/kling_1";
  const calls: Array<{ url: string; method: string }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    const address = String(url);
    calls.push({ url: address, method: init?.method ?? "GET" });
    if (init?.method === "POST") return Response.json({ request_id: "kling_1",
      status_url: queueBase + "/status", response_url: queueBase });
    if (address.endsWith("/status?logs=0")) return Response.json({ request_id: "kling_1",
      status: "COMPLETED" });
    return Response.json({ video: { url: "https://cdn.example.com/kling.mp4",
      content_type: "video/mp4" } });
  };
  const submitted = await submitMediaRequest({ modelId, operation: "text_to_video",
    prompt: "A moving train", durationSec: 3 }, { fetcher, apiKeys: { fal: "test-key" } });
  assert.ok(submitted.providerQueueReference);
  const task = await getMediaTask({ modelId,
    providerTaskId: submitted.providerQueueReference! }, { fetcher, apiKeys: { fal: "test-key" } });
  assert.deepEqual(calls.map(call => call.url), [
    "https://queue.fal.run/" + modelId,
    queueBase + "/status?logs=0", queueBase
  ]);
  assert.equal(task.state, "completed");
  assert.deepEqual(task.assets, [{ kind: "video", url: "https://cdn.example.com/kling.mp4",
    contentType: "video/mp4" }]);
});

test("OpenVideo uses WaveSpeed prediction lifecycle and imports its video", async () => {
  const modelId = "wavespeed-ai/open-video/image-to-video";
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (init?.method === "POST") return Response.json({ code: 200, data: {
      id: "open_video_1", status: "created", model: modelId, outputs: [] } });
    return Response.json({ code: 200, data: { id: "open_video_1", status: "completed",
      model: modelId, outputs: ["https://cdn.example.com/open-video.mp4"] } });
  };
  const submitted = await submitMediaRequest({ modelId, operation: "image_to_video",
    prompt: "A slow push in", imageUrl, durationSec: 5 },
  { fetcher, apiKeys: { wavespeed: "test-key" } });
  assert.equal(submitted.providerTaskId, "open_video_1");
  const task = await getMediaTask({ modelId, providerTaskId: submitted.providerTaskId },
    { fetcher, apiKeys: { wavespeed: "test-key" } });
  assert.equal(calls[0]?.url, "https://api.wavespeed.ai/api/v3/" + modelId);
  assert.deepEqual(calls[0]?.body, { image: imageUrl, prompt: "A slow push in", preset: "tuned",
    resolution: "480p", duration: 5 });
  assert.equal(calls[1]?.url, "https://api.wavespeed.ai/api/v3/predictions/open_video_1/result");
  assert.deepEqual(task.assets, [{ kind: "video", url: "https://cdn.example.com/open-video.mp4",
    contentType: null }]);
});
