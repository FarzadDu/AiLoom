import assert from "node:assert/strict";
import { test } from "node:test";
import { listMediaModels } from "../src/server/media/registry";
import { MediaRequestError, prepareMediaRequest, submitMediaRequest } from "../src/server/media/service";

const imageUrl = "https://assets.example.com/source.png";

test("image catalog lists provider-backed create and edit endpoints", () => {
  const create = listMediaModels("text_to_image");
  const edit = listMediaModels("image_edit");
  assert.equal(create.length, 19);
  assert.equal(edit.length, 8);
  assert.deepEqual(new Set(create.map(model => model.provider)), new Set(["kie", "fal", "wavespeed"]));
  for (const model of [...create, ...edit]) {
    assert.equal(model.outputKind, "image");
    assert.match(model.docsUrl, /^https:\/\//);
  }
});

test("each new image endpoint accepts a minimal request for its declared operation", () => {
  for (const model of listMediaModels("text_to_image")) {
    const prepared = prepareMediaRequest({ modelId: model.id, operation: "text_to_image", prompt: "A blue cup" });
    assert.equal(prepared.provider, model.provider);
    assert.equal(prepared.modelId, model.id);
    assert.equal(prepared.providerInput.prompt, "A blue cup");
  }
  for (const model of listMediaModels("image_edit")) {
    const prepared = prepareMediaRequest({
      modelId: model.id, operation: "image_edit", prompt: "Make it red", imageUrl
    });
    assert.equal(prepared.provider, model.provider);
    assert.equal(prepared.modelId, model.id);
    assert.equal(prepared.providerInput.prompt, "Make it red");
  }
});

test("new Kie and WaveSpeed image models map to their documented payloads", () => {
  assert.deepEqual(prepareMediaRequest({
    modelId: "nano-banana-pro", operation: "text_to_image", prompt: "A cup"
  }).providerInput, {
    prompt: "A cup", image_input: [], aspect_ratio: "auto", resolution: "1K", output_format: "png"
  });
  assert.deepEqual(prepareMediaRequest({
    modelId: "google/imagen4-fast", operation: "text_to_image", prompt: "A cup", aspectRatio: "16:9"
  }).providerInput, { prompt: "A cup", negative_prompt: "", aspect_ratio: "16:9" });
  assert.deepEqual(prepareMediaRequest({
    modelId: "wavespeed-ai/flux-2-flash/text-to-image", operation: "text_to_image",
    prompt: "A cup", width: 1280, height: 720
  }).providerInput, { prompt: "A cup", size: "1280*720" });
  assert.throws(() => prepareMediaRequest({
    modelId: "wavespeed-ai/flux-2-flash/text-to-image", operation: "text_to_image",
    prompt: "A cup", width: 300, height: 300
  }), (error: unknown) => error instanceof MediaRequestError && error.fields.includes("width"));
});

test("new fal image families use their distinct size and source conventions", () => {
  const gpt = prepareMediaRequest({
    modelId: "openai/gpt-image-2.5/flare/text-to-image", operation: "text_to_image",
    prompt: "A cup", imageSize: "portrait_4_3", quality: "medium"
  });
  assert.deepEqual(gpt.providerInput, {
    prompt: "A cup", image_size: "portrait_4_3", quality: "medium",
    num_images: 1, output_format: "png"
  });
  const seedream = prepareMediaRequest({
    modelId: "bytedance/seedream/v5/lite/text-to-image", operation: "text_to_image", prompt: "A cup"
  });
  assert.equal(seedream.providerInput.image_size, "auto_2K");
  assert.equal("output_format" in seedream.providerInput, false);
  const recraft = prepareMediaRequest({
    modelId: "fal-ai/recraft/v3/text-to-image", operation: "text_to_image", prompt: "A logo"
  });
  assert.equal(recraft.providerInput.image_size, "square_hd");
  assert.equal("num_images" in recraft.providerInput, false);
  const qwen = prepareMediaRequest({
    modelId: "alibaba/qwen-image-3/edit", operation: "image_edit",
    prompt: "Change the cup", imageUrl
  });
  assert.deepEqual(qwen.providerInput.image_urls, [imageUrl]);
  assert.equal("image_size" in qwen.providerInput, false);
  const fluxEdit = prepareMediaRequest({
    modelId: "fal-ai/flux-2-pro/edit", operation: "image_edit", prompt: "Change the cup", imageUrl
  });
  assert.equal(fluxEdit.providerInput.image_size, "auto");
  assert.equal("num_images" in fluxEdit.providerInput, false);
});

test("new image edits reject non-public source URLs and unexpected provider fields", () => {
  for (const model of listMediaModels("image_edit")) {
    assert.throws(() => prepareMediaRequest({
      modelId: model.id, operation: "image_edit", prompt: "Change it",
      imageUrl: "https://127.0.0.1/private.png"
    }), (error: unknown) => error instanceof MediaRequestError && error.fields.includes("imageUrl"));
  }
  assert.throws(() => prepareMediaRequest({
    modelId: "openai/gpt-image-2.5/flare/edit", operation: "image_edit",
    prompt: "Change it", imageUrl, num_images: 50
  }), (error: unknown) => error instanceof MediaRequestError && error.code === "invalid_input");
});

test("nested fal image endpoint submits to queue without exposing request text", async () => {
  let submittedUrl = "";
  const submittedBodies: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    submittedUrl = String(url);
    submittedBodies.push(JSON.parse(String(options?.body)) as Record<string, unknown>);
    return Response.json({ request_id: "image_123", queue_position: 0 });
  };
  const submitted = await submitMediaRequest({
    modelId: "openai/gpt-image-2.5/flare/edit", operation: "image_edit",
    prompt: "Change this private product", imageUrl
  }, { fetcher, apiKeys: { fal: "test-key" } });
  assert.equal(submittedUrl, "https://queue.fal.run/openai/gpt-image-2.5/flare/edit");
  assert.deepEqual(submittedBodies[0]?.image_urls, [imageUrl]);
  assert.equal(JSON.stringify(submitted).includes("private product"), false);
});
