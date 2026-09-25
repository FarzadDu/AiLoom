import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareChatModelCatalog } from "../src/components/chat-model-catalog";

test("model chooser leads with real OpenAI and Claude models from the live catalog", () => {
  const models = prepareChatModelCatalog([
    { id: "aion-labs/aion-3.5", name: "AionLabs: Aion 3.5" },
    { id: "anthropic/claude-sonnet-5", name: "Anthropic: Claude Sonnet 5" },
    { id: "openai/gpt-6-sol", name: "OpenAI: GPT-6 Sol" },
    { id: "openrouter/auto", name: "Smart choice" },
    { id: "amazon/nova-lite-v1", name: "Amazon: Nova Lite 1.0" }
  ]);
  assert.deepEqual(models.map(model => model.id), [
    "openrouter/auto", "openai/gpt-6-sol", "anthropic/claude-sonnet-5",
    "aion-labs/aion-3.5", "amazon/nova-lite-v1"
  ]);
  assert.equal(models[1].name, "OpenAI: GPT-6 Sol");
});

test("model chooser excludes private aliases and batch endpoints without inventing missing models", () => {
  const models = prepareChatModelCatalog([
    { id: "~openai/gpt-astra-latest", name: "OpenAI: GPT Astra Latest" },
    { id: "anthropic/claude-sonnet-4.6:batch", name: "Claude batch" },
    { id: "anthropic/claude-opus-4.6", name: "Anthropic: Claude Opus 4.6" },
    { id: "anthropic/claude-opus-4.6", name: "Duplicate" }
  ]);
  assert.deepEqual(models.map(model => model.id), ["anthropic/claude-opus-4.6"]);
  assert.equal(models[0].name, "Anthropic: Claude Opus 4.6");
});

test("major providers remain visible when featured model IDs change", () => {
  const models = prepareChatModelCatalog([
    { id: "aion-labs/aion-3.5", name: "AionLabs" },
    { id: "anthropic/claude-next", name: "Anthropic: Claude Next" },
    { id: "openai/gpt-next", name: "OpenAI: GPT Next" },
    { id: "google/gemini-next", name: "Google: Gemini Next" }
  ]);
  assert.deepEqual(models.map(model => model.id), [
    "openai/gpt-next", "anthropic/claude-next", "google/gemini-next", "aion-labs/aion-3.5"
  ]);
});
