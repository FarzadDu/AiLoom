import assert from "node:assert/strict";
import { test } from "node:test";
import { captureChatContext } from "../src/components/chat-context-lease";

test("late stream events cannot change a newly selected chat", () => {
  let epoch = 4;
  const context = captureChatContext(() => epoch);
  const updates: string[] = [];
  assert.equal(context.run(() => updates.push("original start")), true);
  epoch++;
  assert.equal(context.isCurrent(), false);
  assert.equal(context.run(() => updates.push("late delta")), false);
  assert.equal(context.run(() => updates.push("late completion")), false);
  assert.deepEqual(updates, ["original start"]);
});
