import assert from "node:assert/strict";
import { test } from "node:test";
import { appendOptimisticChatTurn, chatScrollAfterPrepend, chatScrollIsNearBottom, createSerialAsyncQueue } from "../src/components/chat-ui-state";
import type { ChatMessage } from "../src/components/chat-api";

test("chat follows streaming replies only while the reader is near the bottom", () => {
  assert.equal(chatScrollIsNearBottom(804, 400, 1200), true);
  assert.equal(chatScrollIsNearBottom(705, 400, 1200), true);
  assert.equal(chatScrollIsNearBottom(700, 400, 1200), false);
});

test("prepending older messages preserves the reader's scroll position", () => {
  assert.equal(chatScrollAfterPrepend(120, 1000, 1450), 570);
  assert.equal(chatScrollAfterPrepend(0, 1000, 1200), 200);
  assert.equal(chatScrollAfterPrepend(20, 1000, 960), 0);
});

test("retry replaces only the matching failed local bubble", () => {
  const failed: ChatMessage = { id: "failed", role: "user", text: "hello", status: "error" };
  const unrelated: ChatMessage = { id: "other", role: "user", text: "another", status: "error" };
  const fresh: ChatMessage = { id: "fresh", role: "user", text: "hello" };
  const reply: ChatMessage = { id: "reply", role: "assistant", text: "", status: "streaming" };
  const retried = appendOptimisticChatTurn([failed, unrelated], { id: "failed", identity: "same" }, "same", fresh, reply);
  assert.deepEqual(retried.map(item => item.id), ["other", "fresh", "reply"]);
  assert.deepEqual(appendOptimisticChatTurn([failed], { id: "failed", identity: "same" }, "different", fresh, reply)
    .map(item => item.id), ["failed", "fresh", "reply"]);
});

test("model saves run in choice order and keep running after a rejected save", async () => {
  const enqueue = createSerialAsyncQueue();
  const events: string[] = [];
  let finishFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { finishFirst = resolve; });
  const first = enqueue(async () => { events.push("A start"); await firstGate; events.push("A end"); });
  const second = enqueue(async () => { events.push("B start"); throw new Error("temporary failure"); });
  const third = enqueue(async () => { events.push("C start"); });
  await Promise.resolve();
  assert.deepEqual(events, ["A start"]);
  finishFirst();
  await first;
  await assert.rejects(second, /temporary failure/);
  await third;
  assert.deepEqual(events, ["A start", "A end", "B start", "C start"]);
});
