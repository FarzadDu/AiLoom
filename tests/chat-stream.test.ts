import assert from "node:assert/strict";
import test from "node:test";
import { streamOpenRouterText } from "../src/server/chat/stream";

test("OpenRouter SSE parser preserves deltas split across CRLF chunks", async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Hel',
    'lo"}}]}\r',
    '\n\r\ndata: {"choices":[{"delta":{"content":" world"}}]}\r\n\r\n',
    'data: [DONE]\n\n'
  ];
  const response = new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    }
  }));
  const values: string[] = [];
  for await (const value of streamOpenRouterText(response)) values.push(value);
  assert.deepEqual(values, ["Hello", " world"]);
});

test("OpenRouter SSE parser rejects a provider error without leaking its details", async () => {
  const response = new Response('data: {"error":{"message":"private provider payload"}}\n\n');
  await assert.rejects(async () => {
    for await (const _ of streamOpenRouterText(response)) { /* consume */ }
  }, /^Error: The model stream failed\.$/);
});

test("OpenRouter SSE parser rejects an interrupted reply without a completion marker", async () => {
  const response = new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
  const values: string[] = [];
  await assert.rejects(async () => {
    for await (const value of streamOpenRouterText(response)) values.push(value);
  }, /^Error: The model stream ended before completion\.$/);
  assert.deepEqual(values, ["partial"]);
});
