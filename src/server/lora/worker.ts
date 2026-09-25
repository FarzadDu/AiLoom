import { randomUUID } from "node:crypto";
import { getWaveSpeedTask, submitWaveSpeedTask, WaveSpeedError,
  type WaveSpeedTask } from "../providers/wavespeed";
import { importProviderMedia } from "../storage/provider-import";
import { createAsset, deleteAsset } from "../content/assets";
import { deletePrivateFile } from "../storage/private-files";
import { claimInferenceTask, claimModelTask, getDataset, getModel,
  markStaleSubmissionsUncertain, updateInferenceTask, updateModelTask } from "./store";
import { importLoraWeights, removeLoraFile, signedLoraFileUrl } from "./private-files";

export const TRAINER_MODEL = "wavespeed-ai/flux-dev-lora-trainer";
export const INFERENCE_MODEL = "wavespeed-ai/flux-dev-lora";

type Dependencies = {
  submit?: typeof submitWaveSpeedTask;
  get?: typeof getWaveSpeedTask;
  importWeights?: typeof importLoraWeights;
  importImage?: typeof importProviderMedia;
};

function safeFailure(error: unknown): string {
  if (error instanceof WaveSpeedError) {
    if (error.kind === "uncertain_submission") return "submission_unknown";
    if (error.status === 401 || error.status === 403) return "provider_auth";
    if (error.status === 402) return "provider_credit";
    if (error.status === 429) return "provider_rate_limit";
    return "provider_rejected";
  }
  return "request_failed";
}

function outputUrls(task: WaveSpeedTask): string[] {
  const urls: string[] = [];
  function visit(value: unknown, depth: number): void {
    if (depth > 3 || urls.length >= 12) return;
    if (typeof value === "string") {
      if (/^https:\/\//i.test(value)) urls.push(value);
    } else if (Array.isArray(value)) {
      value.slice(0, 12).forEach(part => visit(part, depth + 1));
    } else if (value && typeof value === "object") {
      Object.values(value).slice(0, 12).forEach(part => visit(part, depth + 1));
    }
  }
  task.outputs.forEach(item => visit(item.kind === "media" ? item.url
    : item.kind === "data" ? item.value : null, 0));
  return urls;
}

function weightOutputUrl(task: WaveSpeedTask): string | null {
  const urls = outputUrls(task);
  return urls.find(url => /\.safetensors(?:[?#]|$)/i.test(url)) ?? urls[0] ?? null;
}

async function processModel(workerId: string, dependencies: Dependencies): Promise<void> {
  const task = claimModelTask(workerId);
  if (!task) return;
  const release = { leaseOwner: null, leaseExpiresAt: null };
  if (task.state === "submitting") {
    try {
      const dataset = getDataset(task.datasetId);
      if (!dataset || dataset.ownerId !== task.ownerId) throw new Error("Training dataset unavailable.");
      const provider = await (dependencies.submit ?? submitWaveSpeedTask)({
        model: TRAINER_MODEL,
        input: { data: signedLoraFileUrl("dataset", dataset.id),
          trigger_word: task.triggerWord ?? "", steps: task.steps,
          lora_rank: task.rank, learning_rate: 0.0004 },
        signal: AbortSignal.timeout(45_000)
      });
      if (provider.model && provider.model !== TRAINER_MODEL) {
        updateModelTask(task.id, workerId, { state: "uncertain", providerTaskId: provider.predictionId,
          errorCode: "prediction_model_mismatch", ...release });
        return;
      }
      updateModelTask(task.id, workerId, { state: "running", providerTaskId: provider.predictionId,
        errorCode: null, ...release });
    } catch (error) {
      const code = safeFailure(error);
      updateModelTask(task.id, workerId, { state: code === "submission_unknown" ? "uncertain" : "failed",
        errorCode: code, ...release });
    }
    return;
  }
  if (!task.providerTaskId) {
    updateModelTask(task.id, workerId, { state: "uncertain", errorCode: "prediction_missing", ...release });
    return;
  }
  try {
    const provider = await (dependencies.get ?? getWaveSpeedTask)({ predictionId: task.providerTaskId,
      signal: AbortSignal.timeout(45_000) });
    if (provider.model && provider.model !== TRAINER_MODEL) {
      updateModelTask(task.id, workerId, { state: "failed", errorCode: "prediction_model_mismatch", ...release });
      return;
    }
    if (provider.state === "failed") {
      updateModelTask(task.id, workerId, { state: "failed", errorCode: provider.providerStatus, ...release });
      return;
    }
    if (provider.state !== "completed") {
      updateModelTask(task.id, workerId, { state: "running", errorCode: null, ...release });
      return;
    }
    const url = weightOutputUrl(provider);
    if (!url) throw new Error("Trainer returned no LoRA weights.");
    updateModelTask(task.id, workerId, { state: "importing", errorCode: null });
    const weights = await (dependencies.importWeights ?? importLoraWeights)(url, task.id);
    if (!updateModelTask(task.id, workerId, { state: "ready", weightStorageKey: weights.storageKey,
      weightSizeBytes: weights.sizeBytes, errorCode: null, ...release })) {
      await removeLoraFile(weights.storageKey).catch(() => undefined);
      throw new Error("Training lease was lost.");
    }
  } catch {
    // Result queries and downloads are read-only and safe to retry. The paid
    // trainer POST is never repeated after an uncertain response or crash.
    updateModelTask(task.id, workerId, { errorCode: "poll_or_import_failed", ...release });
  }
}

async function processInference(workerId: string, dependencies: Dependencies): Promise<void> {
  const task = claimInferenceTask(workerId);
  if (!task) return;
  const release = { leaseOwner: null, leaseExpiresAt: null };
  if (task.state === "submitting") {
    try {
      const model = getModel(task.modelId);
      if (!model || model.ownerId !== task.ownerId || model.state !== "ready" || !model.weightStorageKey) {
        throw new Error("LoRA model unavailable.");
      }
      const prompt = model.triggerWord && !task.prompt.toLowerCase().includes(model.triggerWord.toLowerCase())
        ? `${model.triggerWord}, ${task.prompt}` : task.prompt;
      const provider = await (dependencies.submit ?? submitWaveSpeedTask)({
        model: INFERENCE_MODEL,
        input: { prompt, loras: [{ path: signedLoraFileUrl("weights", model.id), scale: task.scale / 1000 }],
          size: task.size, num_images: 1, output_format: "png" },
        signal: AbortSignal.timeout(45_000)
      });
      if (provider.model && provider.model !== INFERENCE_MODEL) {
        updateInferenceTask(task.id, workerId, { state: "uncertain", providerTaskId: provider.predictionId,
          errorCode: "prediction_model_mismatch", ...release });
        return;
      }
      updateInferenceTask(task.id, workerId, { state: "running", providerTaskId: provider.predictionId,
        errorCode: null, ...release });
    } catch (error) {
      const code = safeFailure(error);
      updateInferenceTask(task.id, workerId, { state: code === "submission_unknown" ? "uncertain" : "failed",
        errorCode: code, ...release });
    }
    return;
  }
  if (!task.providerTaskId) {
    updateInferenceTask(task.id, workerId, { state: "uncertain", errorCode: "prediction_missing", ...release });
    return;
  }
  try {
    const provider = await (dependencies.get ?? getWaveSpeedTask)({ predictionId: task.providerTaskId,
      signal: AbortSignal.timeout(45_000) });
    if (provider.model && provider.model !== INFERENCE_MODEL) {
      updateInferenceTask(task.id, workerId, { state: "failed", errorCode: "prediction_model_mismatch", ...release });
      return;
    }
    if (provider.state === "failed") {
      updateInferenceTask(task.id, workerId, { state: "failed", errorCode: provider.providerStatus, ...release });
      return;
    }
    if (provider.state !== "completed") {
      updateInferenceTask(task.id, workerId, { state: "running", errorCode: null, ...release });
      return;
    }
    const url = outputUrls(provider)[0];
    if (!url) throw new Error("Inference returned no image.");
    updateInferenceTask(task.id, workerId, { state: "importing", errorCode: null });
    const image = await (dependencies.importImage ?? importProviderMedia)(url, "image");
    let assetId: string | null = null;
    try {
      const asset = createAsset(task.ownerId, { ...image, source: "generation" });
      assetId = asset.id;
      if (!updateInferenceTask(task.id, workerId, { state: "ready", outputAssetId: asset.id,
        errorCode: null, ...release })) throw new Error("Inference lease was lost.");
    } catch (error) {
      if (assetId) deleteAsset(task.ownerId, assetId);
      await deletePrivateFile(image.storageKey).catch(() => undefined);
      throw error;
    }
  } catch {
    updateInferenceTask(task.id, workerId, { errorCode: "poll_or_import_failed", ...release });
  }
}

/** Dedicated queue: it cannot block the regular media worker or local renderer. */
export async function runLoraWorkerCycle(dependencies: Dependencies = {}): Promise<void> {
  markStaleSubmissionsUncertain();
  const workerId = randomUUID();
  const outcomes = await Promise.allSettled([processModel(workerId, dependencies), processInference(workerId, dependencies)]);
  if (outcomes.some(outcome => outcome.status === "rejected")) {
    // Avoid logging provider payloads or signed URLs.
    console.error("Ailoom LoRA worker could not process one queued task; will retry.");
  }
}
