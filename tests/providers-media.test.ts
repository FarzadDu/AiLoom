import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeFalQueueReference, FalError, getFalResult, getFalTask, submitFalTask
} from "../src/server/providers/fal";
import {
  WaveSpeedError, getWaveSpeedTask, submitWaveSpeedTask
} from "../src/server/providers/wavespeed";

test("fal submits one async queue request with server key and webhook query", async () => {
  let calls = 0;
  let capturedUrl = "";
  let capturedBody = "";
  let capturedAuth = "";
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    capturedUrl = String(url);
    capturedBody = String(init?.body);
    capturedAuth = new Headers(init?.headers).get("Authorization") ?? "";
    assert.equal(init?.method, "POST");
    return Response.json({ request_id: "req_123", queue_position: 2 });
  };
  const task = await submitFalTask({
    endpoint: "bytedance/seedance-2.0/reference-to-video",
    input: { prompt: "a product ad", duration: 5 },
    webhookUrl: "https://ailoom.example/api/hooks/fal",
    apiKey: "fal-secret",
    fetcher
  });
  assert.equal(calls, 1);
  assert.equal(capturedAuth, "Key fal-secret");
  assert.equal(new URL(capturedUrl).pathname, "/bytedance/seedance-2.0/reference-to-video");
  assert.equal(new URL(capturedUrl).searchParams.get("fal_webhook"), "https://ailoom.example/api/hooks/fal");
  assert.deepEqual(JSON.parse(capturedBody), { prompt: "a product ad", duration: 5 });
  assert.equal(capturedBody.includes("fal-secret"), false);
  assert.deepEqual(task, {
    requestId: "req_123",
    endpoint: "bytedance/seedance-2.0/reference-to-video",
    state: "queued",
    queuePosition: 2,
    queueReference: null
  });
});

test("fal uses validated lifecycle URLs returned for a nested paid queue task", async () => {
  const id = "req_123";
  const queuePath = "fal-ai/veo3.1/fast/image-to-video";
  const base = `https://queue.fal.run/${queuePath}/requests/${id}`;
  const urls: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    urls.push(String(url));
    if (init?.method === "POST") return Response.json({ request_id: id,
      status_url: `${base}/status`, response_url: `${base}/response` });
    if (String(url).endsWith("/status?logs=0")) return Response.json({
      request_id: id, status: "COMPLETED" });
    return Response.json({ video: { url: "https://cdn.example/clip.mp4" } });
  };
  const submitted = await submitFalTask({ endpoint: queuePath,
    input: { prompt: "a clip" }, apiKey: "key", fetcher });
  assert.deepEqual(decodeFalQueueReference(submitted.queueReference!), {
    requestId: id, queuePath, resultSuffix: "/response"
  });
  const task = await getFalTask({ endpoint: queuePath, requestId: id,
    queueReference: submitted.queueReference!, apiKey: "key", fetcher });
  const result = await getFalResult({ endpoint: queuePath, requestId: id,
    queueReference: submitted.queueReference!, apiKey: "key", fetcher });
  assert.equal(task.state, "completed");
  assert.deepEqual(urls.slice(1), [`${base}/status?logs=0`, `${base}/response`]);
  assert.equal(result.outputs[0]?.url, "https://cdn.example/clip.mp4");
});

test("fal rejects cross-host or mismatched lifecycle URLs after an accepted POST", async () => {
  for (const responseUrl of [
    "https://evil.example/requests/req_123/response",
    "https://queue.fal.run/fal-ai/veo3.1/requests/another/response"
  ]) {
    const fetcher: typeof fetch = async () => Response.json({ request_id: "req_123",
      status_url: "https://queue.fal.run/fal-ai/veo3.1/requests/req_123/status",
      response_url: responseUrl });
    await assert.rejects(submitFalTask({ endpoint: "fal-ai/veo3.1/fast", input: { prompt: "x" },
      apiKey: "key", fetcher }), (error: unknown) =>
      error instanceof FalError && error.kind === "uncertain_submission");
  }
});

test("fal status maps queue, completion and redacts provider failure detail", async () => {
  const fetcher: typeof fetch = async () => Response.json({
    status: "COMPLETED",
    request_id: "req_123",
    error: "prompt or secret that must stay private",
    error_type: "request_timeout",
    metrics: { inference_time: 7.25 }
  });
  const task = await getFalTask({
    endpoint: "fal-ai/flux-2-pro", requestId: "req_123", apiKey: "key", fetcher
  });
  assert.equal(task.state, "failed");
  assert.equal(task.failureType, "request_timeout");
  assert.equal(task.inferenceSeconds, 7.25);
  assert.equal(JSON.stringify(task).includes("secret"), false);

  const queueFetcher: typeof fetch = async () => Response.json({
    status: "IN_QUEUE", request_id: "req_123", queue_position: 0
  });
  const queued = await getFalTask({
    endpoint: "fal-ai/flux-2-pro", requestId: "req_123", apiKey: "key", fetcher: queueFetcher
  });
  assert.equal(queued.state, "queued");
  assert.equal(queued.queuePosition, 0);
});

test("fal nested endpoint uses app alias for queue status", async () => {
  let capturedUrl = "";
  const fetcher: typeof fetch = async (url) => {
    capturedUrl = String(url);
    return Response.json({ status: "IN_PROGRESS", request_id: "req_123" });
  };
  const task = await getFalTask({
    endpoint: "bytedance/seedance-2.5/text-to-video", requestId: "req_123", apiKey: "key", fetcher
  });
  assert.equal(task.state, "running");
  assert.equal(capturedUrl, "https://queue.fal.run/bytedance/seedance-2.5/requests/req_123/status?logs=0");
});

test("fal result normalizes image, video and audio without returning source prompt", async () => {
  let capturedUrl = "";
  const fetcher: typeof fetch = async (url) => {
    capturedUrl = String(url);
    return Response.json({
      images: [{ url: "https://cdn.example/img.png", width: 1024, height: 1024, content_type: "image/png" }],
      video: { url: "https://cdn.example/clip.mp4" },
      audio_url: "https://cdn.example/speech.mp3",
      prompt: "private source prompt",
      seed: 42
    });
  };
  const result = await getFalResult({
    endpoint: "fal-ai/multi/media", requestId: "req_123", apiKey: "key", fetcher
  });
  assert.equal(capturedUrl, "https://queue.fal.run/fal-ai/multi/requests/req_123");
  assert.deepEqual(result.outputs.map(output => output.kind), ["image", "video", "audio"]);
  assert.equal(result.outputs[0].contentType, "image/png");
  assert.equal(result.outputs[0].width, 1024);
  assert.equal(result.seed, 42);
  assert.equal(JSON.stringify(result).includes("private source prompt"), false);
});

test("fal protects against duplicate submissions and unsafe inputs", async () => {
  let calls = 0;
  const dropped: typeof fetch = async () => { calls++; throw new Error("secret network URL"); };
  await assert.rejects(
    submitFalTask({ endpoint: "fal-ai/flux-2-pro", input: { prompt: "x" }, apiKey: "secret", fetcher: dropped }),
    (error: unknown) => error instanceof FalError && error.kind === "uncertain_submission" &&
      !error.message.includes("secret")
  );
  assert.equal(calls, 1);
  await assert.rejects(
    submitFalTask({ endpoint: "../bad", input: {}, apiKey: "key", fetcher: dropped }),
    /Invalid Fal endpoint/
  );
  await assert.rejects(
    submitFalTask({ endpoint: "fal-ai/flux-2-pro", input: { sync_mode: true }, apiKey: "key", fetcher: dropped }),
    /sync_mode/
  );
  assert.equal(calls, 1);
});

test("fal HTTP failure never echoes upstream body", async () => {
  const fetcher: typeof fetch = async () => new Response('{"detail":"private prompt"}', { status: 429 });
  await assert.rejects(
    submitFalTask({ endpoint: "fal-ai/flux-2-pro", input: {}, apiKey: "key", fetcher }),
    (error: unknown) => error instanceof FalError && error.status === 429 &&
      !error.message.includes("private")
  );
});

test("WaveSpeed submits once to the exact model path with Bearer key", async () => {
  let calls = 0;
  let capturedUrl = "";
  let capturedBody = "";
  let capturedAuth = "";
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    capturedUrl = String(url);
    capturedBody = String(init?.body);
    capturedAuth = new Headers(init?.headers).get("Authorization") ?? "";
    assert.equal(init?.method, "POST");
    return Response.json({ code: 200, data: {
      id: "pred_abc", status: "created",
      urls: { get: "https://evil.example/ignore-this" }
    } });
  };
  const task = await submitWaveSpeedTask({
    model: "wavespeed-ai/z-image/turbo",
    input: { prompt: "a cat", size: "1024*1024" },
    webhookUrl: "https://ailoom.example/api/hooks/wavespeed",
    apiKey: "wave-secret",
    fetcher
  });
  assert.equal(calls, 1);
  assert.equal(capturedAuth, "Bearer wave-secret");
  assert.equal(new URL(capturedUrl).pathname, "/api/v3/wavespeed-ai/z-image/turbo");
  assert.equal(new URL(capturedUrl).searchParams.get("webhook"), "https://ailoom.example/api/hooks/wavespeed");
  assert.equal(capturedBody.includes("wave-secret"), false);
  assert.equal(task.predictionId, "pred_abc");
  assert.equal(task.model, "wavespeed-ai/z-image/turbo");
  assert.equal(task.state, "queued");
});

test("WaveSpeed result normalizes URL, text and structured outputs", async () => {
  let capturedUrl = "";
  const fetcher: typeof fetch = async (url, init) => {
    capturedUrl = String(url);
    assert.equal(init?.method, "GET");
    return Response.json({ code: 200, data: {
      id: "pred_abc", model: "wavespeed-ai/z-image/turbo", status: "completed",
      outputs: [
        "https://cdn.example/image.png",
        { url: "https://cdn.example/video.mp4", content_type: "video/mp4" },
        "caption text",
        { score: 0.9 }
      ],
      timings: { inference: 2500 }
    } });
  };
  const task = await getWaveSpeedTask({ predictionId: "pred_abc", apiKey: "key", fetcher });
  assert.equal(capturedUrl, "https://api.wavespeed.ai/api/v3/predictions/pred_abc/result");
  assert.equal(task.state, "completed");
  assert.deepEqual(task.outputs.map(output => output.kind), ["media", "media", "text", "data"]);
  assert.equal(task.inferenceMs, 2500);
});

test("WaveSpeed terminal failures are normalized without exposing provider error", async () => {
  const fetcher: typeof fetch = async () => Response.json({ code: 200, data: {
    id: "pred_abc", status: "timeout", error: "private prompt or key", outputs: []
  } });
  const task = await getWaveSpeedTask({ predictionId: "pred_abc", apiKey: "key", fetcher });
  assert.equal(task.state, "failed");
  assert.equal(task.providerStatus, "timeout");
  assert.deepEqual(task.outputs, []);
  assert.equal(JSON.stringify(task).includes("private"), false);
});

test("WaveSpeed rejects application errors and treats dropped POST as uncertain", async () => {
  const applicationFailure: typeof fetch = async () =>
    Response.json({ code: 4005, message: "private provider body" });
  await assert.rejects(
    submitWaveSpeedTask({ model: "wavespeed-ai/z-image/turbo", input: {}, apiKey: "key", fetcher: applicationFailure }),
    (error: unknown) => error instanceof WaveSpeedError && error.providerCode === 4005 &&
      !error.message.includes("private")
  );
  let calls = 0;
  const dropped: typeof fetch = async () => { calls++; throw new Error("secret"); };
  await assert.rejects(
    submitWaveSpeedTask({ model: "wavespeed-ai/z-image/turbo", input: {}, apiKey: "key", fetcher: dropped }),
    (error: unknown) => error instanceof WaveSpeedError && error.kind === "uncertain_submission"
  );
  assert.equal(calls, 1);
  await assert.rejects(
    submitWaveSpeedTask({
      model: "wavespeed-ai/z-image/turbo", input: { enable_sync_mode: true }, apiKey: "key", fetcher: dropped
    }),
    /enable_sync_mode/
  );
  assert.equal(calls, 1);
});

test("malformed successful POST responses remain uncertain rather than safe to retry", async () => {
  const falFetcher: typeof fetch = async () => Response.json({ response_url: "https://provider.example/task" });
  await assert.rejects(
    submitFalTask({ endpoint: "fal-ai/flux-2-pro", input: {}, apiKey: "key", fetcher: falFetcher }),
    (error: unknown) => error instanceof FalError && error.kind === "uncertain_submission"
  );
  const waveFetcher: typeof fetch = async () => Response.json({ code: 200, data: { status: "created" } });
  await assert.rejects(
    submitWaveSpeedTask({ model: "wavespeed-ai/z-image/turbo", input: {}, apiKey: "key", fetcher: waveFetcher }),
    (error: unknown) => error instanceof WaveSpeedError && error.kind === "uncertain_submission"
  );
});

test("unknown WaveSpeed provider status stays nonterminal and is not echoed", async () => {
  const fetcher: typeof fetch = async () => Response.json({ code: 200, data: {
    id: "pred_abc", status: "secret prompt in unknown status", outputs: []
  } });
  const task = await getWaveSpeedTask({ predictionId: "pred_abc", apiKey: "key", fetcher });
  assert.equal(task.state, "running");
  assert.equal(task.providerStatus, "unknown");
  assert.equal(JSON.stringify(task).includes("secret"), false);
});

test("fal masks unknown machine error types while preserving failed state", async () => {
  const fetcher: typeof fetch = async () => Response.json({
    status: "COMPLETED", request_id: "req_123", error_type: "privateprompt"
  });
  const task = await getFalTask({
    endpoint: "fal-ai/flux-2-pro", requestId: "req_123", apiKey: "key", fetcher
  });
  assert.equal(task.state, "failed");
  assert.equal(task.failureType, "unknown");
  assert.equal(JSON.stringify(task).includes("privateprompt"), false);
});
