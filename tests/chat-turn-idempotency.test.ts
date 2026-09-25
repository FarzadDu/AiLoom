import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePendingChatTurn, samePendingTurn, type PendingChatTurn } from "../src/components/chat-turn-idempotency";

const requestId = "8a3c765a-945b-4f52-b8e3-98962051f975";
const pending: PendingChatTurn = {
  requestId,
  input: { projectId: "project-a", text: "Explain the design", model: "openrouter/auto", webSearch: false },
  resultConversationId: "conversation-created"
};

test("a retried text turn keeps the original request after the stream begins", () => {
  assert.equal(samePendingTurn(pending, pending.input, null, "project-a"), true);
  assert.equal(samePendingTurn(pending, { conversationId: "conversation-created", text: "Explain the design",
    model: "openrouter/auto", webSearch: false }, "conversation-created", "project-a"), true);
  assert.equal(samePendingTurn(pending, { conversationId: "different", text: "Explain the design",
    model: "openrouter/auto", webSearch: false }, "different", "project-a"), false);
  assert.equal(samePendingTurn(pending, { conversationId: "conversation-created", text: "Changed",
    model: "openrouter/auto", webSearch: false }, "conversation-created", "project-a"), false);
  assert.equal(samePendingTurn(pending, { conversationId: "conversation-created", text: "Explain the design",
    model: "openrouter/auto", webSearch: false }, "conversation-created", "project-b"), false);
});

test("pending turn records validate the request key and input", () => {
  assert.deepEqual(parsePendingChatTurn(JSON.stringify(pending)), pending);
  assert.equal(parsePendingChatTurn(JSON.stringify({ ...pending, requestId: "bad" })), null);
  assert.equal(parsePendingChatTurn(JSON.stringify({ ...pending, input: { text: "x" } })), null);
});
