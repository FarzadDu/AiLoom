import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import type { ExploreTemplate } from "../src/components/content-api";
import { createWorkflowRun, executeWorkflow, resolveWorkflowPrompt, restoreWorkflowRun, resumeWorkflowRun, validateWorkflowRun } from "../src/components/explore-runner";
import { STARTER_TEMPLATES } from "../src/server/content/starter-templates";

function template(steps: ExploreTemplate["definition"]["steps"]): ExploreTemplate {
  return { id: randomUUID(), ownerId: "owner-1", title: "Test recipe", description: "",
    category: "test", visibility: "private", definition: { version: 1, inputs: [
      { key: "subject", label: "Subject", type: "text", required: true }
    ], steps } };
}

const imageId = "11111111-1111-4111-8111-111111111111";
const videoId = "22222222-2222-4222-8222-222222222222";
const imageJobId = "33333333-3333-4333-8333-333333333333";
const videoJobId = "44444444-4444-4444-8444-444444444444";

test("Explore runs chat, image and video in order using the prior private image asset", async () => {
  const recipe = template([
    { id: "brief", title: "Brief", kind: "chat", prompt: "Describe {{subject}}" },
    { id: "picture", title: "Picture", kind: "image", prompt: "Paint {{subject}}" },
    { id: "clip", title: "Clip", kind: "video", modelId: "fal-ai/veo3.1/fast/image-to-video", prompt: "Animate {{subject}}" }
  ]);
  const run = createWorkflowRun(recipe, "owner-1", { subject: "a kite" }, {});
  validateWorkflowRun(run);
  let latest = run;
  const calls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method || "GET"} ${url}`);
    if (init?.body) bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    if (url === "/api/chat") return new Response([
      'event: start\ndata: {"conversationId":"55555555-5555-4555-8555-555555555555","messageId":"m"}',
      'event: delta\ndata: {"text":"A bright red kite against blue sky."}',
      'event: done\ndata: {"messageId":"m"}', ""
    ].join("\n\n"), { headers: { "Content-Type": "text/event-stream" } });
    if (url === "/api/generations" && bodies.at(-1)?.operation === "text_to_image") {
      return Response.json({ job: { id: imageJobId, state: "queued" } }, { status: 202 });
    }
    if (url === `/api/generations/${imageJobId}`) {
      return Response.json({ job: { id: imageJobId, state: "succeeded", output: {
        assets: [{ id: imageId, kind: "image", url: `/api/assets/${imageId}` }]
      } } });
    }
    if (url === `/api/assets/${imageId}`) {
      return Response.json({ url: `https://example.com/api/assets/${imageId}?token=signed` });
    }
    if (url === "/api/generations" && bodies.at(-1)?.operation === "image_to_video") {
      return Response.json({ job: { id: videoJobId, state: "queued" } }, { status: 202 });
    }
    if (url === `/api/generations/${videoJobId}`) {
      return Response.json({ job: { id: videoJobId, state: "succeeded", output: {
        assets: [{ id: videoId, kind: "video", url: `/api/assets/${videoId}` }]
      } } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  await executeWorkflow(run, { fetcher, signal: new AbortController().signal, onUpdate: value => { latest = value; } });
  assert.equal(latest.status, "succeeded");
  assert.deepEqual(latest.steps.map(step => step.state), ["succeeded", "succeeded", "succeeded"]);
  assert.equal(latest.steps[1].asset?.id, imageId);
  assert.equal(latest.steps[2].asset?.id, videoId);
  assert.equal(bodies.find(body => body.operation === "image_to_video")?.imageUrl,
    `https://example.com/api/assets/${imageId}?token=signed`);
  assert.match(String(bodies.find(body => body.operation === "text_to_image")?.prompt), /Earlier creative direction/);
  assert.deepEqual(calls, ["POST /api/chat", "POST /api/generations", `GET /api/generations/${imageJobId}`,
    `POST /api/assets/${imageId}`, "POST /api/generations", `GET /api/generations/${videoJobId}`]);
});

test("Explore resumes a saved provider job without submitting another paid task", async () => {
  const recipe = template([{ id: "picture", title: "Picture", kind: "image", prompt: "Paint {{subject}}" }]);
  const original = createWorkflowRun(recipe, "owner-1", { subject: "a kite" }, {});
  const saved = { ...original, steps: [{ id: "picture", state: "running" as const, jobId: imageJobId }] };
  const restored = restoreWorkflowRun(JSON.stringify(saved), "owner-1");
  assert.ok(restored);
  assert.equal(restoreWorkflowRun(JSON.stringify(saved), "another-user"), null);
  let latest = restored;
  let requests = 0;
  await executeWorkflow(restored, {
    signal: new AbortController().signal,
    fetcher: (async (url: RequestInfo | URL) => {
      requests++;
      assert.equal(String(url), `/api/generations/${imageJobId}`);
      return Response.json({ job: { id: imageJobId, state: "succeeded", output: {
        assets: [{ id: imageId, kind: "image", url: `/api/assets/${imageId}` }]
      } } });
    }) as typeof fetch,
    onUpdate: value => { latest = value; }
  });
  assert.equal(requests, 1);
  assert.equal(latest.status, "succeeded");
});

test("starter image stage uses image edit with a reference and FLUX without one", async () => {
  const starter = STARTER_TEMPLATES[0];
  const hero = starter.definition.steps.find(step => step.id === "hero");
  assert.ok(hero);
  assert.equal(hero.modelId, undefined);
  const recipe: ExploreTemplate = {
    ...template([hero]), definition: { version: 1, inputs: starter.definition.inputs, steps: [hero] }
  };
  for (const withReference of [false, true]) {
    const run = createWorkflowRun(recipe, "owner-1", { product: "a ceramic mug", brand: "blue" },
      withReference ? { reference: { id: imageId, kind: "image", name: "mug.png" } } : {});
    validateWorkflowRun(run);
    let latest = run;
    const calls: string[] = [];
    let mediaBody: Record<string, unknown> | undefined;
    await executeWorkflow(run, {
      signal: new AbortController().signal,
      fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(url);
        if (url === `/api/assets/${imageId}`) return Response.json({ url: `https://example.com/api/assets/${imageId}?token=signed` });
        if (url === "/api/generations") {
          mediaBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Response.json({ job: { id: imageJobId, state: "queued" } }, { status: 202 });
        }
        if (url === `/api/generations/${imageJobId}`) {
          return Response.json({ job: { id: imageJobId, state: "succeeded", output: {
            assets: [{ id: videoId, kind: "image", url: `/api/assets/${videoId}` }]
          } } });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }) as typeof fetch,
      onUpdate: value => { latest = value; }
    });
    assert.equal(latest.status, "succeeded");
    assert.equal(mediaBody?.modelId, withReference ? "fal-ai/qwen-image-edit" : "fal-ai/flux-2-pro");
    assert.equal(mediaBody?.operation, withReference ? "image_edit" : "text_to_image");
    assert.equal(calls.includes(`/api/assets/${imageId}`), withReference);
    assert.equal(latest.steps[0].modelId, mediaBody?.modelId);
  }
});

test("Explore catches missing references and unresolved placeholders before running", () => {
  const recipe = template([{ id: "clip", title: "Clip", kind: "video",
    modelId: "fal-ai/veo3.1/fast/image-to-video", prompt: "Animate {{subject}}" }]);
  const run = createWorkflowRun(recipe, "owner-1", { subject: "a kite" }, {});
  assert.throws(() => validateWorkflowRun(run), /earlier image/);
  recipe.definition.steps[0].prompt = "Animate {{unknown}}";
  assert.throws(() => validateWorkflowRun(run), /Unknown or unavailable placeholder/);
  recipe.definition.steps[0].prompt = "{{previous}}";
  assert.throws(() => resolveWorkflowPrompt(run, 0), /This workflow step needs a prompt/);
});

test("Explore stops after a failed generation and does not start later steps", async () => {
  const recipe = template([
    { id: "picture", title: "Picture", kind: "image", prompt: "Paint {{subject}}" },
    { id: "voice", title: "Voice", kind: "audio", prompt: "Read {{subject}}" }
  ]);
  const run = createWorkflowRun(recipe, "owner-1", { subject: "a kite" }, {});
  let latest = run;
  const calls: string[] = [];
  await executeWorkflow(run, {
    signal: new AbortController().signal,
    fetcher: (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === "/api/generations") return Response.json({ job: { id: imageJobId, state: "queued" } }, { status: 202 });
      return Response.json({ job: { id: imageJobId, state: "failed", errorCode: "provider_failure" } });
    }) as typeof fetch,
    onUpdate: value => { latest = value; }
  });
  assert.deepEqual(calls, ["/api/generations", `/api/generations/${imageJobId}`]);
  assert.equal(latest.status, "failed");
  assert.equal(latest.steps[0].state, "failed");
  assert.equal(latest.steps[1].state, "waiting");
});

test("Explore passes private image and PDF inputs to its first chat step", async () => {
  const recipe: ExploreTemplate = {
    ...template([{ id: "brief", title: "Brief", kind: "chat", prompt: "Summarize {{subject}} using {{document}} and {{reference}}" }]),
    definition: { version: 1, inputs: [
      { key: "subject", label: "Subject", type: "text", required: true },
      { key: "document", label: "Document", type: "file", required: true },
      { key: "reference", label: "Reference", type: "image", required: true }
    ], steps: [{ id: "brief", title: "Brief", kind: "chat", prompt: "Summarize {{subject}} using {{document}} and {{reference}}" }] }
  };
  const run = createWorkflowRun(recipe, "owner-1", { subject: "the design" }, {
    document: { id: videoId, kind: "file", name: "brief.pdf" },
    reference: { id: imageId, kind: "image", name: "photo.png" }
  });
  let body: Record<string, unknown> | undefined;
  let latest = run;
  await executeWorkflow(run, {
    signal: new AbortController().signal,
    fetcher: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response('event: delta\ndata: {"text":"A design summary."}\n\nevent: done\ndata: {"messageId":"m"}\n\n');
    }) as typeof fetch,
    onUpdate: value => { latest = value; }
  });
  assert.equal(latest.status, "succeeded");
  assert.deepEqual(body?.attachmentIds, [videoId, imageId]);
});

test("a lost POST response replays the saved request key; terminal failure rotates it", async () => {
  const recipe = template([{ id: "picture", title: "Picture", kind: "image", prompt: "Paint {{subject}}" }]);
  const run = createWorkflowRun(recipe, "owner-1", { subject: "a kite" }, {});
  let latest = run;
  let originalKey = "";
  await executeWorkflow(run, {
    signal: new AbortController().signal,
    fetcher: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      originalKey = new Headers(init?.headers).get("Idempotency-Key") || "";
      throw new Error("Network response lost");
    }) as typeof fetch,
    onUpdate: value => { latest = value; }
  });
  assert.match(originalKey, /^[0-9a-f-]{36}$/i);
  assert.equal(latest.status, "failed");
  assert.equal(latest.steps[0].requestId, originalKey);
  assert.equal(latest.steps[0].jobId, undefined);

  const restored = restoreWorkflowRun(JSON.stringify(latest), "owner-1");
  assert.ok(restored);
  const resumed = resumeWorkflowRun(restored);
  let replayKey = "";
  await executeWorkflow(resumed, {
    signal: new AbortController().signal,
    fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/generations") {
        replayKey = new Headers(init?.headers).get("Idempotency-Key") || "";
        return Response.json({ job: { id: imageJobId, state: "queued" } }, { status: 202 });
      }
      return Response.json({ job: { id: imageJobId, state: "succeeded", output: {
        assets: [{ id: imageId, kind: "image", url: `/api/assets/${imageId}` }]
      } } });
    }) as typeof fetch,
    onUpdate: value => { latest = value; }
  });
  assert.equal(replayKey, originalKey);
  assert.equal(latest.status, "succeeded");

  const failed = { ...latest, status: "failed" as const, steps: [{ ...latest.steps[0],
    state: "failed" as const, error: "Generation failed: provider_failure" }] };
  const retry = resumeWorkflowRun(failed);
  assert.equal(retry.steps[0].requestId, undefined);
  assert.equal(retry.steps[0].jobId, undefined);
});

test("Social launch audio speaks generated words rather than directions", () => {
  const starter = STARTER_TEMPLATES.find(item => item.title === "Social launch clip");
  assert.ok(starter);
  const recipe: ExploreTemplate = { ...template(starter.definition.steps),
    definition: starter.definition };
  const run = createWorkflowRun(recipe, "owner-1", { offer: "the new camera", audience: "travelers", brand: "warm" }, {});
  const voiceIndex = recipe.definition.steps.findIndex(step => step.id === "voice");
  const scriptIndex = recipe.definition.steps.findIndex(step => step.id === "voice-script");
  assert.ok(scriptIndex >= 0 && voiceIndex === scriptIndex + 1);
  run.steps[scriptIndex] = { id: "voice-script", state: "succeeded", text: "Take the journey with you." };
  assert.equal(resolveWorkflowPrompt(run, voiceIndex), "Take the journey with you.");
});
