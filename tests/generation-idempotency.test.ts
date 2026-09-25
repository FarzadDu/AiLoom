import assert from "node:assert/strict";
import { test } from "node:test";
import { generationRequestIdentity, parsePendingGeneration, uncertainGenerationMatches } from "../src/components/generation-idempotency";

test("same private asset request retains identity across renewed signed URLs", () => {
  const common = { modelId: "fal-ai/qwen-image-edit", operation: "image_edit", prompt: "Keep the product red" };
  const first = generationRequestIdentity("/api/generations", { ...common,
    imageUrl: "https://ailoom.example/api/assets/a?token=one" }, ["asset-a"]);
  const renewed = generationRequestIdentity("/api/generations", { ...common,
    imageUrl: "https://ailoom.example/api/assets/a?token=two" }, ["asset-a"]);
  assert.equal(first, renewed);
  assert.notEqual(first, generationRequestIdentity("/api/generations", { ...common,
    imageUrl: "https://ailoom.example/api/assets/a?token=two" }, ["asset-b"]));
  assert.notEqual(first, generationRequestIdentity("/api/generations", { ...common,
    prompt: "Keep the product blue", imageUrl: "https://ailoom.example/api/assets/a?token=two" }, ["asset-a"]));
});

test("pending request reuse requires identical input and valid UUID", () => {
  const identity = generationRequestIdentity("/api/generations", { modelId: "m", prompt: "A kite" });
  const key = "8a3c765a-945b-4f52-b8e3-98962051f975";
  assert.deepEqual(parsePendingGeneration(JSON.stringify({ identity, key }), identity), { identity, key });
  assert.equal(parsePendingGeneration(JSON.stringify({ identity: "another", key }), identity), null);
  assert.equal(parsePendingGeneration(JSON.stringify({ identity, key: "bad" }), identity), null);
});

test("project assignment changes media request identity", () => {
  const input = { modelId: "fal-ai/flux-2-pro", operation: "text_to_image", prompt: "A kite" };
  const unfiled = generationRequestIdentity("/api/generations", { ...input, projectId: null });
  const first = generationRequestIdentity("/api/generations", { ...input, projectId: "66e79992-3fda-44e9-b909-b3ec5cb09685" });
  const second = generationRequestIdentity("/api/generations", { ...input, projectId: "79a833da-13f7-451e-aac9-62605704bf36" });
  assert.notEqual(unfiled, first);
  assert.notEqual(first, second);
});

test("unknown provider outcome blocks only the matching retained media request", () => {
  const pending = { identity: "request A", key: "8a3c765a-945b-4f52-b8e3-98962051f975" };
  const job = { id: pending.key, state: "failed", errorCode: "submission_uncertain" };
  assert.equal(uncertainGenerationMatches(job, pending, "request A"), true);
  assert.equal(uncertainGenerationMatches(job, pending, "request B"), false);
  assert.equal(uncertainGenerationMatches({ ...job, errorCode: "provider_rejected" }, pending, "request A"), false);
  assert.equal(uncertainGenerationMatches(job, { ...pending, key: "another" }, "request A"), false);
});
