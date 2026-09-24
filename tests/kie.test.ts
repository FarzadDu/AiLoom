import assert from "node:assert/strict";
import { test } from "node:test";
import { createKieTask, getKieTask, KieError } from "../src/server/providers/kie";

test("Kie create response is a queued task ID, not a finished asset", async () => {
  let requestBody: any;
  const fetcher: typeof fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ code: 200, msg: "success", data: { taskId: "task_123" } });
  };
  const taskId = await createKieTask({
    apiKey: "test-key", model: "bytedance/seedance-2-5", input: { prompt: "Scene" }, fetcher
  });
  assert.equal(taskId, "task_123");
  assert.equal(requestBody.model, "bytedance/seedance-2-5");
  assert.deepEqual(requestBody.input, { prompt: "Scene" });
  assert.equal(JSON.stringify(requestBody).includes("test-key"), false);
});

test("Kie task detail parses result URLs only after successful completion", async () => {
  const fetcher: typeof fetch = async () => Response.json({
    code: 505, msg: "success", data: {
      taskId: "task_123", model: "bytedance/seedance-2-5", state: "success",
      resultJson: JSON.stringify({ resultUrls: ["https://cdn.example/video.mp4"] }),
      creditsConsumed: 50, progress: 100
    }
  });
  const task = await getKieTask({ apiKey: "test-key", taskId: "task_123", fetcher });
  assert.equal(task.state, "success");
  assert.deepEqual(task.resultUrls, ["https://cdn.example/video.mp4"]);
  assert.equal(task.creditsConsumed, 50);
});

test("Kie status cannot be confused across task IDs", async () => {
  const fetcher: typeof fetch = async () => Response.json({
    data: { taskId: "task_other", state: "success", resultJson: "{}" }
  });
  await assert.rejects(getKieTask({
    apiKey: "test-key", taskId: "task_123", fetcher
  }), /invalid task status/);
});

test("Kie errors redact provider response body", async () => {
  const fetcher: typeof fetch = async () => new Response("private input echoed here", { status: 429 });
  await assert.rejects(createKieTask({
    apiKey: "test-key", model: "some/model", input: {}, fetcher
  }), (error: unknown) => error instanceof KieError && error.status === 429 &&
    !error.message.includes("private input"));
});
