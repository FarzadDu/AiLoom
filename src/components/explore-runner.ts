import { readChatStream, responseError } from "./chat-api";
import { mediaAssetsFromJob, mediaJobFromPayload, type MediaAsset } from "./media-api";
import type { ExploreStep, ExploreTemplate } from "./content-api";

export type WorkflowAsset = { id: string; kind: "image" | "video" | "audio" | "file"; name: string };
export type WorkflowStepState = {
  id: string;
  state: "waiting" | "running" | "succeeded" | "failed";
  modelId?: string;
  requestId?: string;
  jobId?: string;
  text?: string;
  asset?: WorkflowAsset;
  error?: string;
};
export type WorkflowRun = {
  version: 1;
  id: string;
  ownerId: string;
  template: ExploreTemplate;
  inputValues: Record<string, string>;
  inputAssets: Record<string, WorkflowAsset>;
  steps: WorkflowStepState[];
  status: "running" | "failed" | "succeeded" | "stopped";
  conversationId?: string;
  startedAt: string;
};

const defaultModel: Record<ExploreStep["kind"], string> = {
  chat: "openrouter/auto", image: "fal-ai/flux-2-pro",
  video: "fal-ai/veo3.1/fast", audio: "fal-ai/elevenlabs/tts/eleven-v3"
};
const supportedModels: Record<Exclude<ExploreStep["kind"], "chat">, readonly string[]> = {
  image: ["fal-ai/flux-2-pro", "nano-banana-2", "wavespeed-ai/z-image/turbo", "fal-ai/qwen-image-edit"],
  video: ["fal-ai/veo3.1/fast", "fal-ai/veo3.1/fast/image-to-video",
    "bytedance/seedance-2.5/text-to-video", "bytedance/seedance-2.5/reference-to-video"],
  audio: ["fal-ai/elevenlabs/tts/eleven-v3"]
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function createWorkflowRun(template: ExploreTemplate, ownerId: string,
  inputValues: Record<string, string>, inputAssets: Record<string, WorkflowAsset>): WorkflowRun {
  return {
    version: 1, id: crypto.randomUUID(), ownerId, template,
    inputValues, inputAssets,
    steps: template.definition.steps.map(step => ({ id: step.id, state: "waiting" })),
    status: "running", startedAt: new Date().toISOString()
  };
}

/** Catch static recipe mistakes before the first (potentially paid) provider call. */
export function validateWorkflowRun(run: WorkflowRun): void {
  const inputs = new Set(run.template.definition.inputs.map(input => input.key));
  const knownSteps = new Set<string>();
  let hasImage = Object.values(run.inputAssets).some(asset => asset.kind === "image");
  let hasVideo = Object.values(run.inputAssets).some(asset => asset.kind === "video");
  for (const step of run.template.definition.steps) {
    if (knownSteps.has(step.id)) throw new Error(`Duplicate workflow step ID: ${step.id}`);
    for (const match of step.prompt.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      const key = match[1].trim();
      if (inputs.has(key) || key === "previous" && knownSteps.size > 0 ||
        key.startsWith("step.") && knownSteps.has(key.slice(5))) continue;
      throw new Error(`Unknown or unavailable placeholder: ${key}`);
    }
    const model = step.modelId || defaultModel[step.kind];
    if (step.kind !== "chat" && model !== "fal-ai/ltx-2.3-quality/inpaint" &&
      !supportedModels[step.kind].includes(model)) {
      throw new Error(`${step.title}: this model cannot run as a ${step.kind} step.`);
    }
    if ((model === "fal-ai/qwen-image-edit" || model === "fal-ai/veo3.1/fast/image-to-video") && !hasImage) {
      throw new Error(`${step.title}: an earlier image or uploaded image is required.`);
    }
    if (model === "bytedance/seedance-2.5/reference-to-video" && !hasImage && !hasVideo) {
      throw new Error(`${step.title}: an earlier image/video or uploaded reference is required.`);
    }
    if (model === "fal-ai/ltx-2.3-quality/inpaint") {
      throw new Error(`${step.title}: temporal inpaint needs a mask and selected interval. Open it in Video Studio.`);
    }
    if (step.kind === "image") hasImage = true;
    if (step.kind === "video") hasVideo = true;
    knownSteps.add(step.id);
  }
}

export function restoreWorkflowRun(raw: string | null, ownerId: string): WorkflowRun | null {
  if (!raw || raw.length > 2_000_000) return null;
  try {
    const run = JSON.parse(raw) as WorkflowRun;
    if (run.version !== 1 || run.ownerId !== ownerId || !uuid.test(run.id) ||
      !run.template || run.template.definition.version !== 1 ||
      !Array.isArray(run.template.definition.steps) || !Array.isArray(run.steps) ||
      run.steps.length !== run.template.definition.steps.length ||
      !["running", "failed", "succeeded", "stopped"].includes(run.status) ||
      run.steps.some((step, index) => step.id !== run.template.definition.steps[index].id ||
        !["waiting", "running", "succeeded", "failed"].includes(step.state) ||
        step.requestId !== undefined && !uuid.test(step.requestId) ||
        step.jobId !== undefined && !uuid.test(step.jobId))) return null;
    return run;
  } catch { return null; }
}

export function resumeWorkflowRun(run: WorkflowRun): WorkflowRun {
  return { ...run, status: "running", steps: run.steps.map(step => {
    if (step.state !== "failed") return step;
    const terminal = step.error?.startsWith("Generation failed") ||
      step.error?.includes("without a private asset") ||
      step.error?.includes("unexpected asset type");
    return { ...step, state: "waiting", error: undefined,
      jobId: terminal ? undefined : step.jobId,
      requestId: terminal ? undefined : step.requestId };
  }) };
}

/** Resolve declared inputs and earlier step outputs. Unknown placeholders fail before provider submission. */
export function resolveWorkflowPrompt(run: WorkflowRun, stepIndex: number): string {
  const step = run.template.definition.steps[stepIndex];
  const inputs = new Map(run.template.definition.inputs.map(input => [input.key, input]));
  const earlier = run.template.definition.steps.slice(0, stepIndex);
  const last = run.steps[stepIndex - 1];
  let usedPriorOutput = false;
  const outputValue = (state: WorkflowStepState | undefined): string =>
    state?.text?.trim() || (state?.asset ? `[${state.asset.kind} output: ${state.asset.name}]` : "");
  let prompt = step.prompt.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_whole, rawKey: string) => {
    const key = rawKey.trim();
    if (key === "previous") { usedPriorOutput = true; return outputValue(last); }
    if (key.startsWith("step.")) {
      usedPriorOutput = true;
      const prior = earlier.find(item => item.id === key.slice(5));
      if (!prior) throw new Error(`Unknown earlier step: ${key}`);
      return outputValue(run.steps.find(item => item.id === prior.id));
    }
    const input = inputs.get(key);
    if (!input) throw new Error(`Unknown workflow input: ${key}`);
    return input.type === "text" ? run.inputValues[key]?.trim() || ""
      : run.inputAssets[key] ? `[${run.inputAssets[key].name}]` : "";
  }).trim();

  // Existing starter recipes describe the previous chat brief but did not use an explicit
  // output placeholder. Carry that brief into visual generation. For the voiceover recipe,
  // speak the polished previous script instead of the original raw input.
  const latestChat = [...earlier].reverse().find(item => item.kind === "chat" &&
    run.steps.find(state => state.id === item.id)?.text);
  const chatText = latestChat ? run.steps.find(state => state.id === latestChat.id)?.text?.trim() : undefined;
  if (chatText && !usedPriorOutput && (step.kind === "image" || step.kind === "video")) {
    prompt += `\n\nEarlier creative direction:\n${chatText.slice(0, 1800)}`;
  }
  if (chatText && !usedPriorOutput && step.kind === "audio" &&
    step.prompt.trim() === "{{script}}") prompt = chatText;

  if (!prompt) throw new Error("This workflow step needs a prompt.");
  const max = step.kind === "chat" ? 40_000 : step.kind === "audio" ? 5_000 : 4_000;
  if (prompt.length > max) throw new Error(`Step prompt exceeds the ${max.toLocaleString()} character limit.`);
  return prompt;
}

function latestAsset(run: WorkflowRun, stepIndex: number, kind: WorkflowAsset["kind"]): WorkflowAsset | null {
  for (let index = stepIndex - 1; index >= 0; index--) {
    const asset = run.steps[index].asset;
    if (asset?.kind === kind) return asset;
  }
  return Object.values(run.inputAssets).find(asset => asset.kind === kind) ?? null;
}

async function jsonOrThrow(fetcher: typeof fetch, url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, { ...init, signal, credentials: "same-origin" });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

async function signedReference(fetcher: typeof fetch, asset: WorkflowAsset, signal: AbortSignal): Promise<string> {
  const data = asRecord(await jsonOrThrow(fetcher, `/api/assets/${encodeURIComponent(asset.id)}`,
    { method: "POST" }, signal));
  if (typeof data?.url !== "string" || !data.url.startsWith("https://")) {
    throw new Error("The public HTTPS site cannot serve this private reference yet.");
  }
  return data.url;
}

function requestForMedia(step: ExploreStep, modelId: string, prompt: string,
  languageCode: "en" | "fa" | undefined,
  reference: { image?: string; video?: string; audio?: string }): Record<string, unknown> {
  if (step.kind === "image") {
    if (modelId === "fal-ai/qwen-image-edit") {
      if (!reference.image) throw new Error("This image edit needs a previous or uploaded image.");
      return { modelId, operation: "image_edit", prompt, imageUrl: reference.image };
    }
    if (!["fal-ai/flux-2-pro", "nano-banana-2", "wavespeed-ai/z-image/turbo"].includes(modelId)) {
      throw new Error("This image model is unavailable for workflow execution.");
    }
    return { modelId, operation: "text_to_image", prompt };
  }
  if (step.kind === "video") {
    if (modelId === "fal-ai/veo3.1/fast/image-to-video") {
      if (!reference.image) throw new Error("This video step needs a previous or uploaded image.");
      return { modelId, operation: "image_to_video", prompt, imageUrl: reference.image };
    }
    if (modelId === "bytedance/seedance-2.5/reference-to-video") {
      if (!reference.image && !reference.video) throw new Error("This video step needs an image or video reference.");
      return { modelId, operation: "reference_to_video", prompt,
        ...(reference.image ? { imageUrls: [reference.image] } : {}),
        ...(reference.video ? { videoUrls: [reference.video] } : {}),
        ...(reference.audio ? { audioUrls: [reference.audio] } : {}) };
    }
    if (modelId === "fal-ai/ltx-2.3-quality/inpaint") {
      throw new Error("Temporal inpaint needs a mask and selected interval. Open this step in Video Studio.");
    }
    if (!["fal-ai/veo3.1/fast", "bytedance/seedance-2.5/text-to-video"].includes(modelId)) {
      throw new Error("This video model is unavailable for workflow execution.");
    }
    return { modelId, operation: "text_to_video", prompt };
  }
  if (modelId !== "fal-ai/elevenlabs/tts/eleven-v3") {
    throw new Error("This audio model is unavailable for workflow execution.");
  }
  return { modelId, operation: "text_to_speech", text: prompt,
    ...(languageCode ? { languageCode } : {}) };
}

function speechLanguage(value: string | undefined): "en" | "fa" | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (/^(fa|persian|farsi|فارسی|پارسی)$/.test(normalized)) return "fa";
  if (/^(en|english|انگلیسی)$/.test(normalized)) return "en";
  return undefined;
}

async function pollJob(fetcher: typeof fetch, jobId: string, signal: AbortSignal,
  onJobState: (state: string) => void): Promise<MediaAsset> {
  for (;;) {
    if (signal.aborted) throw new DOMException("Workflow paused.", "AbortError");
    const payload = await jsonOrThrow(fetcher, `/api/generations/${encodeURIComponent(jobId)}`,
      { method: "GET", cache: "no-store" }, signal);
    const job = mediaJobFromPayload(payload);
    if (!job) throw new Error("The generation response was invalid.");
    onJobState(job.state);
    if (job.state === "failed" || job.state === "cancelled") {
      throw new Error(job.errorCode ? `Generation failed: ${job.errorCode}` : "Generation failed.");
    }
    if (job.state === "succeeded") {
      const asset = mediaAssetsFromJob(job).find(item => item.id);
      if (!asset?.id) throw new Error("The generation completed without a private asset.");
      return asset;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, 2500);
      const aborted = () => { clearTimeout(timer); reject(new DOMException("Workflow paused.", "AbortError")); };
      signal.addEventListener("abort", aborted, { once: true });
    });
  }
}

export async function executeWorkflow(initial: WorkflowRun, options: {
  fetcher?: typeof fetch;
  signal: AbortSignal;
  onUpdate: (run: WorkflowRun) => void;
  onJobState?: (stepId: string, state: string) => void;
}): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  let run = initial;
  const update = (patch: Partial<WorkflowRun>) => {
    run = { ...run, ...patch };
    options.onUpdate(run);
  };
  const patchStep = (index: number, patch: Partial<WorkflowStepState>) => {
    update({ steps: run.steps.map((state, position) => position === index ? { ...state, ...patch } : state) });
  };

  for (let index = 0; index < run.template.definition.steps.length; index++) {
    if (options.signal.aborted) return;
    const step = run.template.definition.steps[index];
    const previousState = run.steps[index];
    if (previousState.state === "succeeded") continue;
    const modelId = step.modelId || (step.kind === "image" && latestAsset(run, index, "image")
      ? "fal-ai/qwen-image-edit" : defaultModel[step.kind]);
    patchStep(index, { state: "running", error: undefined, modelId });
    try {
      if (step.kind === "chat") {
        const prompt = resolveWorkflowPrompt(run, index);
        const inputAttachments = !run.conversationId
          ? Object.values(run.inputAssets).filter(asset => asset.kind === "image" || asset.kind === "file") : [];
        const latestGeneratedImage = [...run.steps.slice(0, index)].reverse()
          .map(state => state.asset).find(asset => asset?.kind === "image");
        const attachmentIds = [...new Set([
          ...inputAttachments.map(asset => asset.id),
          ...(latestGeneratedImage ? [latestGeneratedImage.id] : [])
        ])];
        if (attachmentIds.length > 8) throw new Error("Chat steps can attach at most eight images or PDFs.");
        const response = await fetcher("/api/chat", {
          method: "POST", credentials: "same-origin", signal: options.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: prompt, model: modelId,
            ...(run.conversationId ? { conversationId: run.conversationId } : {}),
            ...(attachmentIds.length ? { attachmentIds } : {}) })
        });
        let text = "";
        await readChatStream(response, event => {
          if (event.type === "start" && event.conversationId) update({ conversationId: event.conversationId });
          if (event.type === "delta") text += event.text;
        });
        if (options.signal.aborted) return;
        if (!text.trim()) throw new Error("The chat step returned no text.");
        patchStep(index, { state: "succeeded", text: text.slice(0, 40_000) });
      } else {
        let jobId = previousState.jobId;
        if (!jobId) {
          // Save the request UUID before submission. A refresh after the POST but
          // before its response can safely replay this key and recover the job.
          const requestId = previousState.requestId || crypto.randomUUID();
          if (!previousState.requestId) patchStep(index, { requestId });
          const prompt = resolveWorkflowPrompt(run, index);
          const image = latestAsset(run, index, "image");
          const video = latestAsset(run, index, "video");
          const audio = latestAsset(run, index, "audio");
          const needsImage = modelId === "fal-ai/qwen-image-edit" ||
            modelId === "fal-ai/veo3.1/fast/image-to-video";
          const needsReference = modelId === "bytedance/seedance-2.5/reference-to-video";
          if (needsImage && !image) throw new Error("This step needs a previous or uploaded image.");
          if (needsReference && !image && !video) throw new Error("This step needs an image or video reference.");
          const reference = {
            image: (needsImage || needsReference) && image ? await signedReference(fetcher, image, options.signal) : undefined,
            video: needsReference && video ? await signedReference(fetcher, video, options.signal) : undefined,
            audio: needsReference && audio ? await signedReference(fetcher, audio, options.signal) : undefined
          };
          const payload = requestForMedia(step, modelId, prompt,
            speechLanguage(run.inputValues.language), reference);
          const queued = asRecord(await jsonOrThrow(fetcher, "/api/generations", {
            method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
            body: JSON.stringify(payload)
          }, options.signal));
          const job = mediaJobFromPayload(queued);
          if (!job) throw new Error("The generation could not be queued.");
          jobId = job.id;
          patchStep(index, { jobId });
        }
        const asset = await pollJob(fetcher, jobId, options.signal,
          state => options.onJobState?.(step.id, state));
        if (options.signal.aborted) return;
        if (!asset.id || (asset.kind !== step.kind && !(step.kind === "image" && asset.kind === "image"))) {
          throw new Error("The generation returned an unexpected asset type.");
        }
        patchStep(index, { state: "succeeded", asset: { id: asset.id, kind: step.kind, name: `${step.title} ${step.kind}` } });
      }
    } catch (error) {
      if (options.signal.aborted) return;
      patchStep(index, { state: "failed", error: error instanceof Error ? error.message : "Workflow step failed." });
      update({ status: "failed" });
      return;
    }
  }
  if (!options.signal.aborted) update({ status: "succeeded" });
}
