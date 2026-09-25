import assert from "node:assert/strict";
import { test } from "node:test";
import { generationRequestIdentity, parsePendingGeneration } from "../src/components/generation-idempotency";

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
