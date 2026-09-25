import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { createAsset, deleteAsset, getOwnedAsset } from "../content/assets";
import { getProject } from "../content/projects";
import { claimNextQueuedJob, claimRunningGenerationJob, expireStaleSubmittingJob,
  listActiveGenerationJobs, releaseGenerationJobLease, renewGenerationJobLease,
  transitionGenerationJob } from "../content/jobs";
import { deletePrivateFile, mediaPath, mediaRoot } from "../storage/private-files";
import { importProviderMedia } from "../storage/provider-import";
import { getMediaTask, submitMediaRequest } from "./service";
import { PrivateReferenceError, refreshPrivateAssetUrls } from "./private-references";
import { renderStoryboardMontage, storyboardRenderJobSchema } from "./storyboard-render";
import { spliceTemporalRepair, type TemporalRepairPlan } from "./temporal-repair";
import { videoToolPaths } from "./binaries";

type ActiveJob = NonNullable<ReturnType<typeof claimNextQueuedJob>>;
type WorkerDependencies = {
  submitMediaRequest?: typeof submitMediaRequest;
  getMediaTask?: typeof getMediaTask;
  importProviderMedia?: typeof importProviderMedia;
  spliceTemporalRepair?: typeof spliceTemporalRepair;
};

function createJobOutputAsset(job: ActiveJob, input: Parameters<typeof createAsset>[1],
  projectId = job.projectId) {
  try {
    return createAsset(job.ownerId, { ...input, projectId });
  } catch (error) {
    // Deleting a project clears the job's database reference, but a claimed job
    // still carries its earlier project ID. Preserve a paid output in the
    // owner's unassigned library when that project disappeared during work.
    if (!projectId || getProject(job.ownerId, projectId)) throw error;
    return createAsset(job.ownerId, { ...input, projectId: null });
  }
}

function leaseHeartbeat(job: ActiveJob, leaseOwner: string, state: "submitting" | "running") {
  const controller = new AbortController();
  const timer = setInterval(() => {
    try {
      if (!renewGenerationJobLease(job.ownerId, job.id, leaseOwner, state)) controller.abort();
    } catch {
      // A transient SQLite lock can be retried; the lease still has time to expire.
    }
  }, 15_000);
  timer.unref();
  return { signal: controller.signal, stop: () => clearInterval(timer) };
}

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
  if (error instanceof PrivateReferenceError) return "private_reference_unavailable";
  if (error && typeof error === "object" && "kind" in error && error.kind === "uncertain_submission") {
    return "submission_uncertain";
  }
  if (error && typeof error === "object" && "status" in error && error.status === 402) {
    return "provider_credit_required";
  }
  return "provider_unavailable";
}

async function submit(job: ActiveJob, leaseOwner: string, dependencies: WorkerDependencies): Promise<void> {
  const heartbeat = leaseHeartbeat(job, leaseOwner, "submitting");
  const signal = AbortSignal.any([heartbeat.signal, AbortSignal.timeout(90_000)]);
  try {
    const request = refreshPrivateAssetUrls(job.ownerId, repairInput(job)?.request ?? job.input);
    const accepted = await (dependencies.submitMediaRequest ?? submitMediaRequest)(
      request, { signal });
    transitionGenerationJob(job.ownerId, job.id, {
      state: "running", externalId: accepted.providerQueueReference ?? accepted.providerTaskId, leaseOwner
    });
  } catch (error) {
    const failed = transitionGenerationJob(job.ownerId, job.id, {
      state: "failed", errorCode: signal.aborted ? "submission_uncertain" : errorCode(error), leaseOwner
    });
    if (failed) await cleanupRepairReferences(job);
  } finally {
    heartbeat.stop();
  }
}

async function submitStoryboard(job: ActiveJob, leaseOwner: string): Promise<void> {
  const heartbeat = leaseHeartbeat(job, leaseOwner, "submitting");
  const signal = AbortSignal.any([heartbeat.signal, AbortSignal.timeout(20 * 60_000)]);
  const outputKey = `storyboards/output/${job.id}.mp4`;
  const outputPath = mediaPath(outputKey);
  let outputAssetId: string | null = null;
  let completed = false;
  try {
    const input = storyboardRenderJobSchema.parse(job.input);
    const sources = input.shots.map(shot => {
      const asset = getOwnedAsset(job.ownerId, shot.assetId);
      if (!asset || asset.kind !== "video" ||
          !["video/mp4", "video/webm"].includes(asset.mimeType)) {
        throw new Error("A storyboard shot output is unavailable.");
      }
      return { sourcePath: mediaPath(asset.storageKey), durationSec: shot.durationSec };
    });
    const rendered = await renderStoryboardMontage({
      shots: sources, aspectRatio: input.aspectRatio, outputPath,
      workDir: mediaPath(`storyboards/tmp/${job.id}`), signal
    });
    const asset = createJobOutputAsset(job, {
      kind: "video", source: "generation", mimeType: "video/mp4",
      sizeBytes: rendered.sizeBytes, storageKey: outputKey
    });
    outputAssetId = asset.id;
    const finished = transitionGenerationJob(job.ownerId, job.id, {
      state: "succeeded", leaseOwner,
      output: { assets: [{ id: asset.id, kind: "video", mimeType: "video/mp4",
        url: `/api/assets/${asset.id}` }], storyboardId: input.boardId,
        shotCount: input.shots.length, durationSec: rendered.durationSec }
    });
    if (!finished) throw new Error("Storyboard render lease was lost.");
    completed = true;
  } catch {
    transitionGenerationJob(job.ownerId, job.id, {
      state: "failed", errorCode: signal.aborted ? "storyboard_render_interrupted" : "storyboard_render_failed",
      leaseOwner
    });
  } finally {
    heartbeat.stop();
    if (!completed) {
      if (outputAssetId) deleteAsset(job.ownerId, outputAssetId);
      await rm(outputPath, { force: true }).catch(() => undefined);
    }
  }
}

async function completeRepair(job: ActiveJob, leaseOwner: string,
  outputs: Array<{ kind: "image" | "video" | "audio"; url: string }>,
  dependencies: WorkerDependencies) {
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
  const downloaded = await (dependencies.importProviderMedia ?? importProviderMedia)(video.url, "video");
  const outputPath = resolve(workDir, `final-${randomUUID()}.mp4`);
  let completed = false;
  let outputAssetId: string | null = null;
  try {
    await (dependencies.spliceTemporalRepair ?? spliceTemporalRepair)({
      plan,
      repairedContextPath: mediaPath(downloaded.storageKey),
      outputPath
    }, videoToolPaths());
    const storageKey = relative(root, outputPath).split(sep).join("/");
    const asset = createJobOutputAsset(job, {
      kind: "video", source: "generation", mimeType: "video/mp4",
      sizeBytes: (await stat(outputPath)).size, storageKey
    }, source.projectId);
    outputAssetId = asset.id;
    const finished = transitionGenerationJob(job.ownerId, job.id, {
      state: "succeeded",
      leaseOwner,
      output: { assets: [{ id: asset.id, kind: "video", mimeType: asset.mimeType,
        url: `/api/assets/${asset.id}` }], repairedInterval: {
        startSec: plan.targetStartSec, endSec: plan.targetEndSec
      } }
    });
    if (!finished) throw new Error("Repair lease was lost.");
    completed = true;
  } finally {
    if (!completed) {
      if (outputAssetId) deleteAsset(job.ownerId, outputAssetId);
      await rm(outputPath, { force: true }).catch(() => undefined);
    }
    await deletePrivateFile(downloaded.storageKey).catch(() => undefined);
    if (completed) await cleanupRepairReferences(job);
  }
}

async function poll(job: ActiveJob, leaseOwner: string, dependencies: WorkerDependencies): Promise<void> {
  if (job.state !== "running" || !job.externalId) {
    releaseGenerationJobLease(job.ownerId, job.id, leaseOwner);
    return;
  }
  const heartbeat = leaseHeartbeat(job, leaseOwner, "running");
  try {
    await pollWithLease(job, leaseOwner, dependencies,
      AbortSignal.any([heartbeat.signal, AbortSignal.timeout(30_000)]));
  } finally {
    heartbeat.stop();
    // This succeeds only if the job is still running and this worker owns it.
    releaseGenerationJobLease(job.ownerId, job.id, leaseOwner);
  }
}

async function pollWithLease(job: ActiveJob, leaseOwner: string,
  dependencies: WorkerDependencies, signal: AbortSignal): Promise<void> {
  let task;
  try { task = await (dependencies.getMediaTask ?? getMediaTask)(
    { modelId: job.providerModel, providerTaskId: job.externalId! }, { signal }); }
  catch { return; } // Retry read-only status requests on the next worker cycle.
  if (task.state === "failed") {
    const failed = transitionGenerationJob(job.ownerId, job.id, {
      state: "failed", errorCode: task.failureCode || "provider_failed", leaseOwner
    });
    if (failed) await cleanupRepairReferences(job);
    return;
  }
  if (task.state !== "completed") return;
  if (!task.assets.length) {
    const failed = transitionGenerationJob(job.ownerId, job.id, {
      state: "failed", errorCode: "empty_provider_output", leaseOwner
    });
    if (failed) await cleanupRepairReferences(job);
    return;
  }

  if (repairInput(job)) {
    try { await completeRepair(job, leaseOwner, task.assets, dependencies); }
    catch {
      const failed = transitionGenerationJob(job.ownerId, job.id, {
        state: "failed", errorCode: "repair_splice_failed", leaseOwner
      });
      if (failed) await cleanupRepairReferences(job);
    }
    return;
  }

  const saved: Array<{ id: string; storageKey: string; kind: "image" | "video" | "audio"; mimeType: string }> = [];
  try {
    for (const output of task.assets) {
      const stored = await (dependencies.importProviderMedia ?? importProviderMedia)(output.url, output.kind);
      try {
        const asset = createJobOutputAsset(job, { ...stored, source: "generation" });
        saved.push({ id: asset.id, storageKey: asset.storageKey, kind: asset.kind as "image" | "video" | "audio", mimeType: asset.mimeType });
      } catch (error) {
        await deletePrivateFile(stored.storageKey);
        throw error;
      }
    }
    const finished = transitionGenerationJob(job.ownerId, job.id, {
      state: "succeeded",
      leaseOwner,
      output: { assets: saved.map(item => ({ id: item.id, kind: item.kind,
        mimeType: item.mimeType, url: `/api/assets/${item.id}` })) }
    });
    if (!finished) throw new Error("Generation lease was lost.");
  } catch {
    for (const asset of saved) {
      deleteAsset(job.ownerId, asset.id);
      await deletePrivateFile(asset.storageKey).catch(() => undefined);
    }
    // Media links can expire; keep the accepted task visible as failed for deliberate retry.
    transitionGenerationJob(job.ownerId, job.id, {
      state: "failed", errorCode: "output_import_failed", leaseOwner
    });
  }
}

export async function runMediaWorkerCycle(dependencies: WorkerDependencies = {}): Promise<void> {
  const leaseOwner = randomUUID();
  const claimed = claimNextQueuedJob(leaseOwner, "remote");
  if (claimed) await submit(claimed, leaseOwner, dependencies);
  const active = listActiveGenerationJobs({ limit: 50 });
  for (const job of active) {
    if (job.provider === "local") continue;
    if (job.state === "submitting") {
      // A healthy submitter renews its lease. A dead submitter's paid POST may
      // have been accepted, so never re-submit it automatically.
      if (expireStaleSubmittingJob(job.ownerId, job.id)) await cleanupRepairReferences(job);
      continue;
    }
    const running = claimRunningGenerationJob(job.ownerId, job.id, leaseOwner);
    if (running) await poll(running, leaseOwner, dependencies);
  }
}

/** Run CPU-heavy local assembly in a dedicated process so paid jobs keep polling. */
export async function runStoryboardWorkerCycle(): Promise<void> {
  const leaseOwner = randomUUID();
  const claimed = claimNextQueuedJob(leaseOwner, "local");
  if (claimed) {
    if (claimed.providerModel === "storyboard-compose-v1") {
      await submitStoryboard(claimed, leaseOwner);
    } else {
      transitionGenerationJob(claimed.ownerId, claimed.id, {
        state: "failed", errorCode: "unsupported_local_job", leaseOwner
      });
    }
  }
  for (const job of listActiveGenerationJobs({ limit: 50 })) {
    if (job.provider === "local" && job.state === "submitting") {
      if (expireStaleSubmittingJob(job.ownerId, job.id, "local_render_interrupted")) {
        await rm(mediaPath(`storyboards/tmp/${job.id}`), { recursive: true, force: true }).catch(() => undefined);
        await rm(mediaPath(`storyboards/output/${job.id}.mp4`), { force: true }).catch(() => undefined);
      }
    }
  }
}
