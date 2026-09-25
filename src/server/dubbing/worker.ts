import { randomUUID } from "node:crypto";
import { createAsset, deleteAsset, getOwnedAsset } from "../content/assets";
import { claimNextDubbingPoll, claimNextDubbingSubmission,
  expireStaleDubbingSubmissions, finishDubbingPoll, finishDubbingSubmission,
  markDubbingImporting } from "../content/dubbing";
import { createDubbingProject, DubbingProviderError, getDubbingLanguage,
  getDubbingProject } from "../providers/elevenlabs-dubbing";
import { signedAssetUrl } from "../storage/asset-access";
import { importProviderMedia } from "../storage/provider-import";
import { deletePrivateFile } from "../storage/private-files";

type DubbingDependencies = {
  createProject?: typeof createDubbingProject;
  getProject?: typeof getDubbingProject;
  getLanguage?: typeof getDubbingLanguage;
  importMedia?: typeof importProviderMedia;
  preflight?: (url: string) => Promise<boolean>;
};

async function preflightSource(url: string): Promise<boolean> {
  const response = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" },
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000) });
  await response.body?.cancel();
  return response.status === 200 || response.status === 206;
}

async function submitOne(deps: DubbingDependencies): Promise<boolean> {
  const leaseOwner = randomUUID();
  const job = claimNextDubbingSubmission(leaseOwner);
  if (!job) return false;
  const source = getOwnedAsset(job.ownerId, job.sourceAssetId);
  if (!source || source.visibility !== "private" || source.kind !== job.sourceKind ||
      source.sizeBytes > 100_000_000) {
    finishDubbingSubmission(job.id, leaseOwner, { state: "failed", errorCode: "source_unavailable" });
    return true;
  }
  let sourceUrl: string;
  try {
    sourceUrl = signedAssetUrl(source.id, 2 * 60 * 60).url;
    if (!await (deps.preflight ?? preflightSource)(sourceUrl)) throw new Error("Source inaccessible");
  } catch {
    finishDubbingSubmission(job.id, leaseOwner, { state: "failed", errorCode: "source_unavailable" });
    return true;
  }
  try {
    const result = await (deps.createProject ?? createDubbingProject)({
      requestId: job.id, sourceUrl, sourceLanguage: job.sourceLanguage,
      targetLanguage: job.targetLanguage
    });
    finishDubbingSubmission(job.id, leaseOwner, result.status === "failed"
      ? { state: "failed", errorCode: "provider_project_failed" }
      : { state: "running", projectId: result.projectId, languageId: result.languageId });
  } catch (error) {
    // There is no documented provider idempotency token for this paid POST.
    // Only a definite client rejection can be marked failed; a timeout or
    // malformed success is uncertain and must never be submitted again.
    const definite = error instanceof DubbingProviderError &&
      [400, 401, 403, 404, 413, 422].includes(error.status);
    finishDubbingSubmission(job.id, leaseOwner, {
      state: definite ? "failed" : "uncertain",
      errorCode: definite ? "provider_rejected" : "submission_uncertain"
    });
  }
  return true;
}

async function pollOne(deps: DubbingDependencies): Promise<boolean> {
  const leaseOwner = randomUUID();
  const job = claimNextDubbingPoll(leaseOwner);
  if (!job) return false;
  if (!job.providerProjectId || !job.providerLanguageId) {
    finishDubbingPoll(job.id, leaseOwner, { state: "failed", errorCode: "provider_id_missing" });
    return true;
  }
  try {
    const project = await (deps.getProject ?? getDubbingProject)({ projectId: job.providerProjectId });
    if (project.status === "failed") {
      finishDubbingPoll(job.id, leaseOwner, { state: "failed", errorCode: "provider_project_failed" });
      return true;
    }
    if (project.status !== "ready") {
      finishDubbingPoll(job.id, leaseOwner, { state: "waiting" });
      return true;
    }
    const language = await (deps.getLanguage ?? getDubbingLanguage)({
      projectId: job.providerProjectId, languageId: job.providerLanguageId
    });
    if (language.status === "failed") {
      finishDubbingPoll(job.id, leaseOwner, { state: "failed", errorCode: "provider_language_failed" });
      return true;
    }
    if (language.status !== "completed" || !language.losslessAudioUrl) {
      finishDubbingPoll(job.id, leaseOwner, { state: "waiting" });
      return true;
    }
    if (!markDubbingImporting(job.id, leaseOwner)) return true;
    // GET target afresh on every attempt. Its signed output URL expires, and
    // a failed import may be retried without another paid POST.
    const stored = await (deps.importMedia ?? importProviderMedia)(language.losslessAudioUrl, "audio");
    let output;
    try {
      output = createAsset(job.ownerId, { ...stored, source: "generation",
        originalName: `dub-${job.targetLanguage}.${stored.mimeType === "audio/flac" ? "flac" : "audio"}` });
    } catch (error) {
      await deletePrivateFile(stored.storageKey);
      throw error;
    }
    if (!finishDubbingPoll(job.id, leaseOwner, { state: "ready", outputAssetId: output.id })) {
      deleteAsset(job.ownerId, output.id);
      await deletePrivateFile(stored.storageKey);
    }
  } catch (error) {
    const permanent = error instanceof Error && (/too large|unsupported media format/i).test(error.message);
    finishDubbingPoll(job.id, leaseOwner, permanent
      ? { state: "failed", errorCode: "output_unavailable" }
      : { state: "waiting", delayMs: 30_000, errorCode: "provider_retrying" });
  }
  return true;
}

/** Dedicated worker cycle; the paid create path never shares a queue with media generation. */
export async function runDubbingWorkerCycle(deps: DubbingDependencies = {}) {
  expireStaleDubbingSubmissions();
  const submitted = await submitOne(deps);
  const polled = await pollOne(deps);
  return { submitted, polled };
}
