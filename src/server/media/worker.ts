import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { createAsset, deleteAsset, getOwnedAsset } from "../content/assets";
import { claimNextQueuedJob, listActiveGenerationJobs, transitionGenerationJob } from "../content/jobs";
import { deletePrivateFile, mediaPath, mediaRoot } from "../storage/private-files";
import { importProviderMedia } from "../storage/provider-import";
import { getMediaTask, submitMediaRequest } from "./service";
import { spliceTemporalRepair, type TemporalRepairPlan } from "./temporal-repair";
import { videoToolPaths } from "./binaries";

type ActiveJob = NonNullable<ReturnType<typeof claimNextQueuedJob>>;

function repairInput(job: ActiveJob): {
  request: unknown;
  repair: { plan: TemporalRepairPlan; sourceAssetId: string; contextAssetIds: string[] };
} | null {
  const input = job.input;
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      !("request" in input) || !("repair" in input) ||
      !input.repair || typeof input.repair !== "object" || Array.isArray(input.repair)) return null;
  const repair = input.repair as Record<string, unknown>;
  if (!repair.plan || typeof repair.plan !== "object" || typeof repair.sourceAssetId !== "string" ||
      !Array.isArray(repair.contextAssetIds) || !repair.contextAssetIds.every(id => typeof id === "string")) return null;
  return { request: input.request, repair: {
    plan: repair.plan as TemporalRepairPlan,
    sourceAssetId: repair.sourceAssetId,
    contextAssetIds: repair.contextAssetIds as string[]
  } };
}

async function cleanupRepairReferences(job: ActiveJob): Promise<void> {
  const repair = repairInput(job);
  if (!repair) return;
  for (const id of repair.repair.contextAssetIds) {
    const asset = getOwnedAsset(job.ownerId, id);
    if (asset?.source !== "generation") continue;
    deleteAsset(job.ownerId, id);
    await deletePrivateFile(asset.storageKey).catch(() => undefined);
  }
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "kind" in error && error.kind === "uncertain_submission") {
    return "submission_uncertain";
  }
  if (error && typeof error === "object" && "status" in error && error.status === 402) {
    return "provider_credit_required";
  }
  return "provider_unavailable";
}

async function submit(job: ActiveJob): Promise<void> {
  try {
    const accepted = await submitMediaRequest(repairInput(job)?.request ?? job.input);
    transitionGenerationJob(job.ownerId, job.id, {
      state: "running", externalId: accepted.providerTaskId
    });
  } catch (error) {
    transitionGenerationJob(job.ownerId, job.id, { state: "failed", errorCode: errorCode(error) });
    await cleanupRepairReferences(job);
  }
}

async function completeRepair(job: ActiveJob, outputs: Array<{ kind: "image" | "video" | "audio"; url: string }>) {
  const repair = repairInput(job);
  if (!repair) throw new Error("Invalid repair job.");
  const source = getOwnedAsset(job.ownerId, repair.repair.sourceAssetId);
  const plan = repair.repair.plan;
  const root = mediaRoot();
  const workDir = resolve(plan.workDir);
  if (!source || source.kind !== "video" || mediaPath(source.storageKey) !== resolve(plan.sourcePath) ||
      !workDir.startsWith(root + sep)) throw new Error("Invalid repair source.");
  const video = outputs.find(item => item.kind === "video");
  if (!video) throw new Error("Provider did not return a repaired video.");
  const downloaded = await importProviderMedia(video.url, "video");
  const outputPath = resolve(workDir, `final-${randomUUID()}.mp4`);
  let completed = false;
  try {
    await spliceTemporalRepair({
      plan,
      repairedContextPath: mediaPath(downloaded.storageKey),
      outputPath
    }, videoToolPaths());
    const storageKey = relative(root, outputPath).split(sep).join("/");
    const asset = createAsset(job.ownerId, {
      kind: "video", source: "generation", mimeType: "video/mp4",
      sizeBytes: (await stat(outputPath)).size, storageKey
    });
    transitionGenerationJob(job.ownerId, job.id, {
      state: "succeeded",
      output: { assets: [{ id: asset.id, kind: "video", mimeType: asset.mimeType,
        url: `/api/assets/${asset.id}` }], repairedInterval: {
        startSec: plan.targetStartSec, endSec: plan.targetEndSec
      } }
    });
    completed = true;
  } finally {
    if (!completed) await rm(outputPath, { force: true }).catch(() => undefined);
    await deletePrivateFile(downloaded.storageKey).catch(() => undefined);
    await cleanupRepairReferences(job);
  }
}

async function poll(job: ActiveJob): Promise<void> {
  if (job.state === "submitting") {
    if (!job.externalId) {
      // A worker restart in this state may mean the provider accepted a POST but its ID was lost.
      // Never send a second potentially billable POST automatically.
      transitionGenerationJob(job.ownerId, job.id, { state: "failed", errorCode: "submission_uncertain" });
      await cleanupRepairReferences(job);
    } else {
      transitionGenerationJob(job.ownerId, job.id, { state: "running" });
    }
    return;
  }
  if (job.state !== "running" || !job.externalId) return;
  let task;
  try { task = await getMediaTask({ modelId: job.providerModel, providerTaskId: job.externalId }); }
  catch { return; } // Retry read-only status requests on the next worker cycle.
  if (task.state === "failed") {
    transitionGenerationJob(job.ownerId, job.id, { state: "failed", errorCode: task.failureCode || "provider_failed" });
    await cleanupRepairReferences(job);
    return;
  }
  if (task.state !== "completed") return;
  if (!task.assets.length) {
    transitionGenerationJob(job.ownerId, job.id, { state: "failed", errorCode: "empty_provider_output" });
    await cleanupRepairReferences(job);
    return;
  }

  if (repairInput(job)) {
    try { await completeRepair(job, task.assets); }
    catch {
      transitionGenerationJob(job.ownerId, job.id, { state: "failed", errorCode: "repair_splice_failed" });
      await cleanupRepairReferences(job);
    }
    return;
  }

  const saved: Array<{ id: string; storageKey: string; kind: "image" | "video" | "audio"; mimeType: string }> = [];
  try {
    for (const output of task.assets) {
      const stored = await importProviderMedia(output.url, output.kind);
      try {
        const asset = createAsset(job.ownerId, { ...stored, source: "generation" });
        saved.push({ id: asset.id, storageKey: asset.storageKey, kind: asset.kind as "image" | "video" | "audio", mimeType: asset.mimeType });
      } catch (error) {
        await deletePrivateFile(stored.storageKey);
        throw error;
      }
    }
    transitionGenerationJob(job.ownerId, job.id, {
      state: "succeeded",
      output: { assets: saved.map(item => ({ id: item.id, kind: item.kind,
        mimeType: item.mimeType, url: `/api/assets/${item.id}` })) }
    });
  } catch {
    for (const asset of saved) {
      deleteAsset(job.ownerId, asset.id);
      await deletePrivateFile(asset.storageKey).catch(() => undefined);
    }
    // Media links can expire; keep the accepted task visible as failed for deliberate retry.
    transitionGenerationJob(job.ownerId, job.id, { state: "failed", errorCode: "output_import_failed" });
  }
}

export async function runMediaWorkerCycle(): Promise<void> {
  const claimed = claimNextQueuedJob();
  if (claimed) await submit(claimed);
  const active = listActiveGenerationJobs({ limit: 50 });
  for (const job of active) {
    if (claimed && job.id === claimed.id && job.state === "submitting") continue;
    await poll(job);
  }
}
