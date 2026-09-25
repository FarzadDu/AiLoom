import assert from "node:assert/strict";
import { test } from "node:test";
import { createChatCompletion, listChatModels, OpenRouterError } from "../src/server/providers/openrouter";
import { generateImage, listImageModels } from "../src/server/providers/openrouter-image";

test("chat request keeps the key in the Authorization header and preserves multimodal content", async () => {
  let body: any;
  let authorization = "";
  const fetcher: typeof fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get("Authorization") || "";
    body = JSON.parse(String(init?.body));
    return new Response("data: [DONE]\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
  const response = await createChatCompletion({
    apiKey: "test-key",
    model: "openrouter/auto",
    messages: [{ role: "user", content: [
      { type: "text", text: "Describe this" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } }
    ] }],
    fetcher
  });
  assert.equal(authorization, "Bearer test-key");
  assert.equal(body.model, "openrouter/auto");
  assert.equal(body.stream, true);
  assert.equal(body.messages[0].content[1].type, "image_url");
  assert.equal(response.headers.get("Content-Type"), "text/event-stream");
  assert.equal(JSON.stringify(body).includes("test-key"), false);
  assert.equal(body.plugins, undefined);
});

test("private PDF chat sends a file part with the free PDF parser", async () => {
  let body: any;
  const fetcher: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response("data: [DONE]\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
  await createChatCompletion({
    apiKey: "test-key", model: "openrouter/auto", fetcher,
    messages: [{ role: "user", content: [
      { type: "text", text: "Summarize the private document" },
      { type: "file", file: { filename: "document.pdf", file_data: "data:application/pdf;base64,JVBERi0=" } }
    ] }]
  });
  assert.deepEqual(body.plugins, [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }]);
  assert.equal(body.messages[0].content[1].file.filename, "document.pdf");
  assert.match(body.messages[0].content[1].file.file_data, /^data:application\/pdf;base64,/);
});

test("provider errors expose status without echoing provider data or secrets", async () => {
  const fetcher: typeof fetch = async () => new Response('{"error":{"message":"secret or prompt leak"}}', { status: 429 });
  await assert.rejects(
    createChatCompletion({ apiKey: "test-key", model: "openrouter/auto", messages: [], fetcher }),
    (error: unknown) => error instanceof OpenRouterError &&
      error.status === 429 &&
      !error.message.includes("secret") &&
      !error.message.includes("prompt")
  );
});

test("text catalog excludes image-only output models", async () => {
  const fetcher: typeof fetch = async () => Response.json({ data: [
    { id: "text/a", name: "A", architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
    { id: "image/b", name: "B", architecture: { input_modalities: ["text"], output_modalities: ["image"] } }
  ] });
  const models = await listChatModels({ apiKey: "test-key", fetcher });
  assert.deepEqual(models.map(model => model.id), ["text/a"]);
});

test("image generation preflights the model and reads raster output", async () => {
  const calls: string[] = [];
  const rasterFetch: typeof fetch = async (input, init) => {
    calls.push(`${init?.method || "GET"} ${input}`);
    if (!init?.method) return Response.json({ data: [
      { id: "openai/gpt-image-1", name: "GPT Image 1", supported_parameters: {} }
    ] });
    return Response.json({
      data: [{ b64_json: Buffer.from("image bytes").toString("base64"), media_type: "image/png" }],
      usage: { cost: 0.04 }
    });
  };
  const result = await generateImage({
    apiKey: "test-key", model: "openai/gpt-image-1", prompt: "A room", fetcher: rasterFetch
  });
  assert.equal(result.images[0].bytes.toString(), "image bytes");
  assert.equal(result.costUsd, 0.04);
  assert.deepEqual(calls, [
    "GET https://openrouter.ai/api/v1/images/models",
    "POST https://openrouter.ai/api/v1/images"
  ]);
});

test("SVG-only image models are hidden and rejected before a billable request", async () => {
  const calls: string[] = [];
  const svgFetch: typeof fetch = async (input, init) => {
    calls.push(`${init?.method || "GET"} ${input}`);
    return Response.json({ data: [
      { id: "recraft/recraft-v4-vector", name: "Recraft Vector",
        supported_parameters: { output_format: { type: "enum", values: ["svg"] } } },
      { id: "recraft/recraft-v4", name: "Recraft Raster", supported_parameters: {} }
    ] });
  };
  const catalog = await listImageModels({ apiKey: "test-key", fetcher: svgFetch });
  assert.deepEqual(catalog.map(model => model.id), ["recraft/recraft-v4"]);
  await assert.rejects(generateImage({
    apiKey: "test-key", model: "recraft/recraft-v4-vector", prompt: "A logo", fetcher: svgFetch
  }), (error: unknown) => error instanceof OpenRouterError && error.status === 422);
  assert.equal(calls.filter(call => call.startsWith("POST ")).length, 0);
});

test("mixed SVG and raster models request a supported raster format", async () => {
  let body: any;
  const fetcher: typeof fetch = async (_input, init) => {
    if (!init?.method) return Response.json({ data: [{
      id: "mixed/model", name: "Mixed Model",
      supported_parameters: { output_format: { type: "enum", values: ["svg", "webp"] } }
    }] });
    body = JSON.parse(String(init.body));
    return Response.json({ data: [{ b64_json: Buffer.from("image bytes").toString("base64"),
      media_type: "image/webp" }] });
  };
  await generateImage({ apiKey: "test-key", model: "mixed/model", prompt: "A logo", fetcher });
  assert.equal(body.output_format, "webp");
});

test("unexpected SVG response is still rejected rather than saved as browser content", async () => {
  const fetcher: typeof fetch = async (_input, init) => !init?.method
    ? Response.json({ data: [{ id: "raster/model", name: "Raster Model", supported_parameters: {} }] })
    : Response.json({ data: [{ b64_json: Buffer.from("<svg></svg>").toString("base64"),
      media_type: "image/svg+xml" }] });
  await assert.rejects(generateImage({
    apiKey: "test-key", model: "raster/model", prompt: "A logo", fetcher
  }), /Unsupported generated image format/);
});
