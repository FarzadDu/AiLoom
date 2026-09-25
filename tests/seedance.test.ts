import assert from "node:assert/strict";
import { test } from "node:test";
import { listMediaModels } from "../src/server/media/registry";
import { MediaRequestError, prepareMediaRequest, submitMediaRequest } from "../src/server/media/service";

const textModel = "bytedance/seedance-2.5/text-to-video";
const referenceModel = "bytedance/seedance-2.5/reference-to-video";
const imageUrl = "https://assets.example.com/character.png";
const videoUrl = "https://assets.example.com/motion.mp4";
const audioUrl = "https://assets.example.com/music.mp3";

test("Seedance 2.5 catalog exposes distinct documented text and reference endpoints", () => {
  assert.equal(listMediaModels("text_to_video").some(model => model.id === textModel), true);
  assert.equal(listMediaModels("reference_to_video").some(model => model.id === referenceModel), true);
  assert.equal(listMediaModels().find(model => model.id === referenceModel)?.docsUrl,
    "https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api");
});

test("Seedance text request maps only documented controls and estimates fixed 720p output", () => {
  const request = prepareMediaRequest({
    modelId: textModel, operation: "text_to_video", prompt: " A cinematic train ",
    durationSec: 5, aspectRatio: "16:9", resolution: "720p", audio: false, bitrateMode: "high"
  });
  assert.equal(request.provider, "fal");
  assert.deepEqual(request.providerInput, {
    prompt: "A cinematic train", duration: "5", aspect_ratio: "16:9",
    resolution: "720p", generate_audio: false, bitrate_mode: "high"
  });
  assert.equal(request.priceEstimate?.amountUsd, 2.3112);
  const auto = prepareMediaRequest({
    modelId: textModel, operation: "text_to_video", prompt: "A forest",
    durationSec: "auto", aspectRatio: "auto", resolution: "1080p"
  });
  assert.equal(auto.priceEstimate, null);
  assert.equal(auto.providerInput.duration, "auto");
  assert.equal(auto.providerInput.resolution, "1080p");
});

test("Seedance references map image, video and audio lists to fal's reference endpoint", () => {
  const request = prepareMediaRequest({
    modelId: referenceModel, operation: "reference_to_video",
    prompt: "Character from @Image1 moves like @Video1 to @Audio1",
    imageUrls: [imageUrl], videoUrls: [videoUrl], audioUrls: [audioUrl],
    durationSec: 10, aspectRatio: "9:16", resolution: "480p", audio: true
  });
  assert.deepEqual(request.providerInput, {
    prompt: "Character from @Image1 moves like @Video1 to @Audio1",
    task: "reference", image_urls: [imageUrl], video_urls: [videoUrl], audio_urls: [audioUrl],
    duration: "10", aspect_ratio: "9:16", resolution: "480p", generate_audio: true
  });
  assert.equal(request.priceEstimate, null, "input-video duration cannot be inferred from URL");
});

test("Seedance reference input requires image or video and enforces documented counts", () => {
  for (const invalid of [
    { audioUrls: [audioUrl] },
    { imageUrls: Array(31).fill(imageUrl) },
    { imageUrls: [imageUrl], videoUrls: Array(11).fill(videoUrl) },
    { imageUrls: ["http://127.0.0.1/file.jpg"] }
  ]) {
    assert.throws(() => prepareMediaRequest({
      modelId: referenceModel, operation: "reference_to_video", prompt: "Test", ...invalid
    }), (error: unknown) => error instanceof MediaRequestError && error.code === "invalid_input");
  }
  assert.throws(() => prepareMediaRequest({
    modelId: textModel, operation: "text_to_video", prompt: "Test", durationSec: 31
  }), (error: unknown) => error instanceof MediaRequestError && error.fields.includes("durationSec"));
  assert.throws(() => prepareMediaRequest({
    modelId: textModel, operation: "text_to_video", prompt: "Test", aspectRatio: "2:1"
  }), (error: unknown) => error instanceof MediaRequestError && error.fields.includes("aspectRatio"));
  assert.throws(() => prepareMediaRequest({
    modelId: textModel, operation: "text_to_video", prompt: "Test", resolution: "4K"
  }), (error: unknown) => error instanceof MediaRequestError && error.fields.includes("resolution"));
});

test("Seedance submits exact endpoint to fal queue with no live generation", async () => {
  let endpoint = "";
  const submitted: Record<string, unknown>[] = [];
  const job = await submitMediaRequest({
    modelId: referenceModel, operation: "reference_to_video", prompt: "Animate @Image1",
    imageUrls: [imageUrl], durationSec: 4, aspectRatio: "1:1", resolution: "480p"
  }, {
    apiKeys: { fal: "fake-key" },
    fetcher: async (url, init) => {
      endpoint = String(url);
      submitted.push(JSON.parse(String(init?.body)));
      return Response.json({ request_id: "fal_seedance_1" });
    }
  });
  assert.equal(endpoint, "https://queue.fal.run/bytedance/seedance-2.5/reference-to-video");
  assert.equal(submitted[0]?.task, "reference");
  assert.equal(job.providerTaskId, "fal_seedance_1");
  assert.equal(JSON.stringify(job).includes("fake-key"), false);
});
