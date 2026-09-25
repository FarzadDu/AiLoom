import assert from "node:assert/strict";
import { test } from "node:test";
import { listMediaModels } from "../src/server/media/registry";
import { MediaRequestError, prepareMediaRequest, submitMediaRequest } from "../src/server/media/service";

const modelId = "bytedance/seedance-2-5";

test("Kie Seedance 2.5 exposes only its documented text-to-video path", () => {
  const model = listMediaModels("text_to_video").find(item => item.id === modelId);
  assert.equal(model?.provider, "kie");
  assert.equal(model?.outputKind, "video");
  assert.deepEqual(model?.operations, ["text_to_video"]);
  const request = prepareMediaRequest({ modelId, operation: "text_to_video", prompt: "  A camera tracks a fox  " });
  assert.equal(request.provider, "kie");
  assert.deepEqual(request.providerInput, { prompt: "A camera tracks a fox" });
  assert.equal(request.priceEstimate, null);
});

test("Kie Seedance 2.5 rejects unsupported operations and undocumented controls before submission", () => {
  assert.throws(() => prepareMediaRequest({ modelId, operation: "image_to_video", prompt: "A fox" }),
    (error: unknown) => error instanceof MediaRequestError && error.code === "unsupported_operation");
  assert.throws(() => prepareMediaRequest({ modelId, operation: "text_to_video", prompt: "A fox", durationSec: 30 }),
    (error: unknown) => error instanceof MediaRequestError && error.code === "invalid_input");
});

test("Kie Seedance 2.5 submits exact documented model ID without a real provider call", async () => {
  let body: unknown;
  const fetcher: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ code: 200, data: { taskId: "seedance_task_1" } });
  };
  const result = await submitMediaRequest({ modelId, operation: "text_to_video", prompt: "A fox runs" },
    { fetcher, apiKeys: { kie: "test-key" } });
  assert.deepEqual(body, { model: modelId, input: { prompt: "A fox runs" } });
  assert.equal(result.provider, "kie");
  assert.equal(result.providerTaskId, "seedance_task_1");
});
