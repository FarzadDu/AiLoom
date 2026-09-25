import assert from "node:assert/strict";
import { test } from "node:test";
import { specialistChatTransition } from "../src/components/specialist-chat";

test("opening a specialist starts text chat with a real specialist id", () => {
  for (const id of ["general-health", "skin-and-hair", "mental-wellbeing"] as const) {
    assert.deepEqual(specialistChatTransition(id), {
      mode: "text", conversationId: null, specialistId: id
    });
  }
  assert.deepEqual(specialistChatTransition("unknown"), {
    mode: "text", conversationId: null, specialistId: null
  });
});
