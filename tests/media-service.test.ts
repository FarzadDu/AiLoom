import assert from "node:assert/strict";
import { test } from "node:test";
import { listMediaModels } from "../src/server/media/registry";
import {
  getMediaTask, MediaRequestError, prepareMediaRequest, submitMediaRequest
} from "../src/server/media/service";

const imageUrl = "https://assets.example.com/input.png";
const videoUrl = "https://assets.example.com/source.mp4";
const maskUrl = "https://assets.example.com/mask.mp4";

test("catalog exposes only documented model IDs and filters by operation", () => {
  const models = listMediaModels();
  assert.equal(new Set(models.map(model => model.id)).size, models.length);
  assert.deepEqual(listMediaModels("image_upscale").map(model => model.id), [
    "topaz/upscale/image/precision"
  ]);
  assert.deepEqual(listMediaModels("temporal_inpaint").map(model => model.id), [
    "fal-ai/ltx-2.3-quality/inpaint"
  ]);
  assert.equal(models.every(model => model.docsUrl.startsWith("https://")), true);
});

test("text-to-image mappings use exact Kie, WaveSpeed and fal payloads", () => {
  const kie = prepareMediaRequest({
    modelId: "nano-banana-2", operation: "text_to_image", prompt: " A cup "
  });
  assert.equal(kie.provider, "kie");
  assert.deepEqual(kie.providerInput, {
    prompt: "A cup", image_input: [], aspect_ratio: "auto",
    resolution: "1K", output_format: "png"
  });
  assert.equal(kie.priceEstimate, null);

  const wave = prepareMediaRequest({
    modelId: "wavespeed-ai/z-image/turbo", operation: "text_to_image",
    prompt: "A cup", width: 1024, height: 768, outputFormat: "webp"
  });
  assert.deepEqual(wave.providerInput, {
    prompt: "A cup", size: "1024*768", output_format: "webp"
  });
  const flux = prepareMediaRequest({
    modelId: "fal-ai/flux-2-pro", operation: "text_to_image",
    prompt: "A cup", imageSize: "square_hd"
  });
  assert.equal(flux.providerInput.image_size, "square_hd");
  assert.equal(flux.providerInput.enable_safety_checker, true);
});

test("image edit uses documented Qwen image URL and rejects private asset URLs", () => {
  const request = prepareMediaRequest({
    modelId: "fal-ai/qwen-image-edit", operation: "image_edit",
    prompt: "Change the cup to red", imageUrl
  });
  assert.equal(request.providerInput.image_url, imageUrl);
  assert.equal(request.providerInput.num_images, 1);
  assert.throws(
    () => prepareMediaRequest({
      modelId: "fal-ai/qwen-image-edit", operation: "image_edit",
      prompt: "Edit", imageUrl: "https://127.0.0.1/private"
    }),
    (error: unknown) => error instanceof MediaRequestError &&
      error.code === "invalid_input" && error.fields.includes("imageUrl")
  );
});

test("Topaz precision upscale uses documented fal fields and refuses invalid sources", () => {
  const request = prepareMediaRequest({
    modelId: "topaz/upscale/image/precision", operation: "image_upscale",
    imageUrl, upscaleFactor: 4, upscaleModel: "High Fidelity V3", outputFormat: "png"
  });
  assert.equal(request.provider, "fal");
  assert.deepEqual(request.providerInput, {
    image_url: imageUrl, model: "High Fidelity V3",
    upscale_factor: 4, output_format: "png"
  });
  assert.equal(request.priceEstimate, null);
  assert.deepEqual(prepareMediaRequest({
    modelId: "topaz/upscale/image/precision", operation: "image_upscale", imageUrl
  }).providerInput, {
    image_url: imageUrl, model: "Standard V2",
    upscale_factor: 2, output_format: "jpeg"
  });
  for (const invalid of [
    { imageUrl: "http://127.0.0.1/private" },
    { upscaleFactor: 8 },
    { upscaleModel: "Wonder 3" },
    { outputFormat: "webp" },
    { prompt: "unexpected" }
  ]) {
    assert.throws(() => prepareMediaRequest({
      modelId: "topaz/upscale/image/precision", operation: "image_upscale", imageUrl,
      ...invalid
    }), (error: unknown) => error instanceof MediaRequestError && error.code === "invalid_input");
  }
});

test("Topaz upscale submits through fal queue and reads the single image result", async () => {
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    const address = String(url);
    calls.push({ url: address, method: init?.method ?? "GET",
      ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}) });
    if (init?.method === "POST") return Response.json({ request_id: "topaz_1", queue_position: 0 });
    if (address.endsWith("/status?logs=0")) {
      return Response.json({ request_id: "topaz_1", status: "COMPLETED" });
    }
    return Response.json({ image: {
      url: "https://cdn.example/upscaled.png", content_type: "image/png"
    } });
  };
  const input = {
    modelId: "topaz/upscale/image/precision", operation: "image_upscale",
    imageUrl, upscaleFactor: 2
  };
  const submitted = await submitMediaRequest(input, { fetcher, apiKeys: { fal: "test-key" } });
  const result = await getMediaTask({
    modelId: submitted.modelId, providerTaskId: submitted.providerTaskId
  }, { fetcher, apiKeys: { fal: "test-key" } });
  assert.equal(calls[0].url, "https://queue.fal.run/topaz/upscale/image/precision");
  assert.deepEqual(calls[0].body, {
    image_url: imageUrl, model: "Standard V2", upscale_factor: 2, output_format: "jpeg"
  });
  assert.equal(calls[1].url, "https://queue.fal.run/topaz/upscale/requests/topaz_1/status?logs=0");
  assert.equal(calls[2].url, "https://queue.fal.run/topaz/upscale/requests/topaz_1");
  assert.deepEqual(result.assets, [{
    kind: "image", url: "https://cdn.example/upscaled.png", contentType: "image/png"
  }]);
});

test("Veo text and image routes allow only documented 4, 6 and 8 second durations", () => {
  const text = prepareMediaRequest({
    modelId: "fal-ai/veo3.1/fast", operation: "text_to_video",
    prompt: "A kite in the sky", durationSec: 6, resolution: "1080p", audio: false
  });
  assert.deepEqual(text.providerInput, {
    prompt: "A kite in the sky", duration: "6s",
    aspect_ratio: "16:9", resolution: "1080p", generate_audio: false
  });
  assert.equal(text.priceEstimate?.amountUsd, 0.6);

  const image = prepareMediaRequest({
    modelId: "fal-ai/veo3.1/fast/image-to-video", operation: "image_to_video",
    prompt: "Move the camera slowly", imageUrl, durationSec: 8
  });
  assert.equal(image.providerInput.image_url, imageUrl);
  assert.equal(image.providerInput.aspect_ratio, "auto");
  assert.equal(image.priceEstimate?.amountUsd, 1.2);

  assert.throws(
    () => prepareMediaRequest({
      modelId: "fal-ai/veo3.1/fast", operation: "text_to_video",
      prompt: "Too long", durationSec: 15
    }),
    (error: unknown) => error instanceof MediaRequestError && error.code === "invalid_input"
  );
});

test("temporal inpaint maps an aligned source segment and mask without regenerating audio", () => {
  const request = prepareMediaRequest({
    modelId: "fal-ai/ltx-2.3-quality/inpaint",
    operation: "temporal_inpaint",
    prompt: "Repair the masked two seconds",
    videoUrl, maskVideoUrl: maskUrl, frameCount: 97, fps: 24
  });
  assert.deepEqual(request.providerInput, {
    prompt: "Repair the masked two seconds",
    video_url: videoUrl,
    mask_video_url: maskUrl,
    num_frames: 97,
    frames_per_second: 24,
    generate_audio: false,
    enable_safety_checker: true
  });
  assert.equal(request.priceEstimate, null);
  assert.throws(
    () => prepareMediaRequest({
      modelId: "fal-ai/ltx-2.3-quality/inpaint",
      operation: "temporal_inpaint",
      prompt: "Repair", videoUrl, frameCount: 97, fps: 24
    }),
    (error: unknown) => error instanceof MediaRequestError &&
      error.fields.includes("maskVideoUrl")
  );
});

test("speech maps Persian locale and marks character cost as estimate", () => {
  const request = prepareMediaRequest({
    modelId: "fal-ai/elevenlabs/tts/eleven-v3",
    operation: "text_to_speech",
    text: "ا".repeat(1000), voice: "Aria", languageCode: "fa"
  });
  assert.equal(request.providerInput.language_code, "fa");
  assert.equal(request.providerInput.voice, "Aria");
  assert.equal(request.priceEstimate?.amountUsd, 0.1);
  assert.match(request.priceEstimate?.caveat ?? "", /estimate only/i);
});

test("unsupported model, operation and native params are rejected before provider submission", () => {
  assert.throws(
    () => prepareMediaRequest({
      modelId: "fal-ai/invented", operation: "text_to_image", prompt: "x"
    }),
    (error: unknown) => error instanceof MediaRequestError && error.code === "unsupported_model"
  );
  assert.throws(
    () => prepareMediaRequest({
      modelId: "fal-ai/veo3.1/fast", operation: "image_edit", prompt: "x"
    }),
    (error: unknown) => error instanceof MediaRequestError && error.code === "unsupported_operation"
  );
  assert.throws(
    () => prepareMediaRequest({
      modelId: "fal-ai/flux-2-pro", operation: "text_to_image", prompt: "x",
      safety_tolerance: "6"
    }),
    (error: unknown) => error instanceof MediaRequestError && error.code === "invalid_input"
  );
});

test("submit dispatches to Kie, fal and WaveSpeed once without returning prompts", async () => {
  const calls: Array<{ url: string; auth: string; body: unknown }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({
      url: String(url),
      auth: new Headers(init?.headers).get("Authorization") ?? "",
      body: JSON.parse(String(init?.body))
    });
    if (String(url).includes("api.kie.ai")) {
      return Response.json({ code: 200, data: { taskId: "kie_1" } });
    }
    if (String(url).includes("queue.fal.run")) {
      return Response.json({ request_id: "fal_1", queue_position: 0 });
    }
    return Response.json({ code: 200, data: { id: "wave_1", status: "created" } });
  };
  const options = {
    fetcher, apiKeys: { kie: "k", fal: "f", wavespeed: "w" }
  };
  const kie = await submitMediaRequest({
    modelId: "nano-banana-2", operation: "text_to_image", prompt: "A cup"
  }, options);
  const fal = await submitMediaRequest({
    modelId: "fal-ai/veo3.1/fast", operation: "text_to_video", prompt: "A train"
  }, options);
  const wave = await submitMediaRequest({
    modelId: "wavespeed-ai/z-image/turbo", operation: "text_to_image", prompt: "A tree"
  }, options);
  assert.deepEqual(calls.map(call => call.auth), ["Bearer k", "Key f", "Bearer w"]);
  assert.deepEqual([kie.providerTaskId, fal.providerTaskId, wave.providerTaskId], [
    "kie_1", "fal_1", "wave_1"
  ]);
  assert.equal(JSON.stringify([kie, fal, wave]).includes("A train"), false);
  assert.equal("providerInput" in fal, false);
});

test("status mapping returns provider media URLs through one service contract", async () => {
  const kieFetcher: typeof fetch = async () => Response.json({ data: {
    taskId: "kie_1", model: "nano-banana-2", state: "success",
    resultJson: JSON.stringify({ resultUrls: ["https://cdn.example/image.png"] })
  } });
  const kie = await getMediaTask({
    modelId: "nano-banana-2", providerTaskId: "kie_1"
  }, { fetcher: kieFetcher, apiKeys: { kie: "key" } });
  assert.equal(kie.state, "completed");
  assert.deepEqual(kie.assets.map(asset => asset.kind), ["image"]);

  let falCalls = 0;
  const falFetcher: typeof fetch = async (url) => {
    falCalls++;
    return Response.json(new URL(String(url)).pathname.endsWith("/status")
      ? { request_id: "fal_1", status: "COMPLETED" }
      : { video: { url: "https://cdn.example/repair.mp4" } });
  };
  const fal = await getMediaTask({
    modelId: "fal-ai/ltx-2.3-quality/inpaint", providerTaskId: "fal_1"
  }, { fetcher: falFetcher, apiKeys: { fal: "key" } });
  assert.equal(falCalls, 2);
  assert.equal(fal.assets[0].kind, "video");

  const waveFetcher: typeof fetch = async () => Response.json({ code: 200, data: {
    id: "wave_1", status: "completed", outputs: ["https://cdn.example/output.png"]
  } });
  const wave = await getMediaTask({
    modelId: "wavespeed-ai/z-image/turbo", providerTaskId: "wave_1"
  }, { fetcher: waveFetcher, apiKeys: { wavespeed: "key" } });
  assert.equal(wave.assets[0].kind, "image");
});

test("Kie task failures do not expose raw provider failure messages", async () => {
  const fetcher: typeof fetch = async () => Response.json({ data: {
    taskId: "kie_1", state: "fail", failMsg: "secret source prompt"
  } });
  const task = await getMediaTask({
    modelId: "nano-banana-2", providerTaskId: "kie_1"
  }, { fetcher, apiKeys: { kie: "key" } });
  assert.equal(task.state, "failed");
  assert.equal(task.failureCode, "provider_failed");
  assert.equal(JSON.stringify(task).includes("secret"), false);
});

test("music catalog and payloads follow the documented fal schemas", () => {
  assert.deepEqual(listMediaModels("text_to_music").map(model => model.id), [
    "elevenlabs/music/v2", "elevenlabs/music/v2.5",
    "fal-ai/stable-audio-3/small/music/text-to-audio",
    "fal-ai/stable-audio-3/medium/text-to-audio"
  ]);
  const eleven = prepareMediaRequest({
    modelId: "elevenlabs/music/v2", operation: "text_to_music",
    prompt: "  An original Persian pop chorus  ", durationSec: 120,
    forceInstrumental: false
  });
  assert.deepEqual(eleven.providerInput, {
    prompt: "An original Persian pop chorus", music_length_ms: 120_000,
    force_instrumental: false, output_format: "mp3_48000_192"
  });
  assert.equal(eleven.priceEstimate?.amountUsd, 1.2);
  assert.equal(prepareMediaRequest({
    modelId: "elevenlabs/music/v2", operation: "text_to_music",
    prompt: "A string quartet", durationSec: 30, forceInstrumental: true
  }).priceEstimate?.amountUsd, 0.6);

  const stable = prepareMediaRequest({
    modelId: "fal-ai/stable-audio-3/small/music/text-to-audio",
    operation: "text_to_music", prompt: "Minimal piano", durationSec: 60
  });
  assert.deepEqual(stable.providerInput, {
    prompt: "Minimal piano", duration: 60, output_format: "mp3", bitrate: "192k"
  });
  assert.equal(stable.priceEstimate, null);
  for (const invalid of [
    { modelId: "elevenlabs/music/v2", durationSec: 601 },
    { modelId: "fal-ai/stable-audio-3/small/music/text-to-audio", durationSec: 121 },
    { modelId: "fal-ai/stable-audio-3/small/music/text-to-audio", forceInstrumental: true }
  ]) {
    assert.throws(() => prepareMediaRequest({
      operation: "text_to_music", prompt: "A short tune", ...invalid
    }), (error: unknown) => error instanceof MediaRequestError && error.code === "invalid_input");
  }
});

test("music request submits once through fal queue and imports an audio result", async () => {
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    const address = String(url);
    calls.push({ url: address, method: init?.method ?? "GET",
      ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}) });
    if (init?.method === "POST") return Response.json({ request_id: "music_1", queue_position: 0 });
    if (address.endsWith("/status?logs=0")) {
      return Response.json({ request_id: "music_1", status: "COMPLETED" });
    }
    return Response.json({ audio: {
      url: "https://cdn.example.com/song.mp3", content_type: "audio/mpeg"
    } });
  };
  const submitted = await submitMediaRequest({
    modelId: "elevenlabs/music/v2", operation: "text_to_music",
    prompt: "Original jazz trio", durationSec: 30, forceInstrumental: true
  }, { fetcher, apiKeys: { fal: "test-key" } });
  const result = await getMediaTask({
    modelId: submitted.modelId, providerTaskId: submitted.providerTaskId
  }, { fetcher, apiKeys: { fal: "test-key" } });
  assert.equal(calls[0].url, "https://queue.fal.run/elevenlabs/music/v2");
  assert.equal(calls[1].url, "https://queue.fal.run/elevenlabs/music/requests/music_1/status?logs=0");
  assert.equal(calls[2].url, "https://queue.fal.run/elevenlabs/music/requests/music_1");
  assert.deepEqual(calls[0].body, {
    prompt: "Original jazz trio", music_length_ms: 30_000,
    force_instrumental: true, output_format: "mp3_48000_192"
  });
  assert.deepEqual(result.assets, [{
    kind: "audio", url: "https://cdn.example.com/song.mp3", contentType: "audio/mpeg"
  }]);
});
