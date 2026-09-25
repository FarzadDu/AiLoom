import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { getDb } from "../db";
import { dubbingJob } from "../db/schema";
import { getOwnedAsset } from "./assets";

const LEASE_MS = 2 * 60_000;
type Job = typeof dubbingJob.$inferSelect;
type DubbingState = Job["state"];

export class DubbingRequestConflictError extends Error {
  constructor() {
    super("This request key belongs to a different dubbing request.");
    this.name = "DubbingRequestConflictError";
  }
}

export function dubbingInputDigest(input: {
  sourceAssetId: string; sourceLanguage: string | null; targetLanguage: string;
}) {
  return createHash("sha256").update(JSON.stringify([
    "dubbing_v2", input.sourceAssetId, input.sourceLanguage, input.targetLanguage
  ])).digest("hex");
}

export function reserveDubbingJob(input: {
  ownerId: string; requestId: string; sourceAssetId: string;
  sourceKind: "audio" | "video"; sourceLanguage: string | null;
  targetLanguage: string;
}) {
  const now = new Date();
  const inputHash = dubbingInputDigest(input);
  const row = { id: input.requestId, ownerId: input.ownerId, sourceAssetId: input.sourceAssetId,
    sourceKind: input.sourceKind, sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage, inputHash, state: "queued" as const,
    providerProjectId: null, providerLanguageId: null, outputAssetId: null,
    errorCode: null, leaseOwner: null, leaseExpiresAt: null, nextPollAt: null,
    createdAt: now, updatedAt: now };
  const inserted = getDb().insert(dubbingJob).values(row).onConflictDoNothing().run().changes === 1;
  const current = getDb().select().from(dubbingJob).where(eq(dubbingJob.id, input.requestId)).get();
  if (!current || current.ownerId !== input.ownerId || current.inputHash !== inputHash) {
    throw new DubbingRequestConflictError();
  }
  return { job: current, created: inserted };
}

export function getOwnedDubbingJob(ownerId: string, id: string) {
  return getDb().select().from(dubbingJob)
    .where(and(eq(dubbingJob.ownerId, ownerId), eq(dubbingJob.id, id))).get() ?? null;
}

export function listOwnedDubbingJobs(ownerId: string) {
  return getDb().select().from(dubbingJob).where(eq(dubbingJob.ownerId, ownerId))
    .orderBy(desc(dubbingJob.createdAt), desc(dubbingJob.id)).limit(100).all();
}

export function publicDubbingJob(ownerId: string, job: Job) {
  const output = job.outputAssetId ? getOwnedAsset(ownerId, job.outputAssetId) : null;
  return { id: job.id, sourceAssetId: job.sourceAssetId, sourceKind: job.sourceKind,
    sourceLanguage: job.sourceLanguage, targetLanguage: job.targetLanguage,
    state: job.state, errorCode: job.errorCode,
    outputUrl: output ? `/api/assets/${output.id}` : null,
    outputMimeType: output?.mimeType ?? null,
    createdAt: job.createdAt, updatedAt: job.updatedAt };
}

export function expireStaleDubbingSubmissions() {
  const now = new Date();
  return getDb().update(dubbingJob).set({ state: "uncertain", errorCode: "submission_uncertain",
    leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
    .where(and(eq(dubbingJob.state, "submitting"),
      lte(dubbingJob.leaseExpiresAt, now))).run().changes;
}

export function claimNextDubbingSubmission(leaseOwner = randomUUID()) {
  const now = new Date();
  return getDb().transaction(tx => {
    const next = tx.select().from(dubbingJob).where(eq(dubbingJob.state, "queued"))
      .orderBy(asc(dubbingJob.createdAt), asc(dubbingJob.id)).limit(1).get();
    if (!next) return null;
    const claimed = tx.update(dubbingJob).set({ state: "submitting", leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS), updatedAt: now })
      .where(and(eq(dubbingJob.id, next.id), eq(dubbingJob.state, "queued"))).run();
    if (claimed.changes !== 1) return null;
    return tx.select().from(dubbingJob).where(eq(dubbingJob.id, next.id)).get() ?? null;
  });
}

export function finishDubbingSubmission(id: string, leaseOwner: string,
  outcome: { state: "running"; projectId: string; languageId: string } |
    { state: "failed" | "uncertain"; errorCode: string }) {
  const now = new Date();
  const set = outcome.state === "running" ? {
    state: "running" as const, providerProjectId: outcome.projectId,
    providerLanguageId: outcome.languageId, nextPollAt: new Date(now.getTime() + 15_000),
    leaseOwner: null, leaseExpiresAt: null, updatedAt: now
  } : { state: outcome.state, errorCode: outcome.errorCode,
    leaseOwner: null, leaseExpiresAt: null, updatedAt: now };
  return getDb().update(dubbingJob).set(set)
    .where(and(eq(dubbingJob.id, id), eq(dubbingJob.state, "submitting"),
      eq(dubbingJob.leaseOwner, leaseOwner))).run().changes === 1;
}

export function reconcileUncertainDubbingJob(ownerId: string, id: string,
  outcome: { state: "running"; projectId: string; languageId: string } |
    { state: "failed"; projectId: string }) {
  const now = new Date();
  const set = outcome.state === "running" ? {
    state: "running" as const, providerProjectId: outcome.projectId,
    providerLanguageId: outcome.languageId, nextPollAt: now,
    errorCode: null, updatedAt: now
  } : { state: "failed" as const, providerProjectId: outcome.projectId,
    errorCode: "provider_project_failed", updatedAt: now };
  getDb().update(dubbingJob).set(set).where(and(eq(dubbingJob.id, id),
    eq(dubbingJob.ownerId, ownerId), eq(dubbingJob.state, "uncertain"))).run();
  return getOwnedDubbingJob(ownerId, id);
}

export function claimNextDubbingPoll(leaseOwner = randomUUID()) {
  const now = new Date();
  return getDb().transaction(tx => {
    const next = tx.select().from(dubbingJob).where(and(
      inArray(dubbingJob.state, ["running", "importing"]),
      or(isNull(dubbingJob.nextPollAt), lte(dubbingJob.nextPollAt, now)),
      or(isNull(dubbingJob.leaseExpiresAt), lte(dubbingJob.leaseExpiresAt, now))))
      .orderBy(asc(dubbingJob.nextPollAt), asc(dubbingJob.createdAt)).limit(1).get();
    if (!next) return null;
    const changed = tx.update(dubbingJob).set({ leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS), updatedAt: now })
      .where(and(eq(dubbingJob.id, next.id), eq(dubbingJob.state, next.state),
        or(isNull(dubbingJob.leaseExpiresAt), lte(dubbingJob.leaseExpiresAt, now)))).run();
    if (changed.changes !== 1) return null;
    return tx.select().from(dubbingJob).where(eq(dubbingJob.id, next.id)).get() ?? null;
  });
}

export function markDubbingImporting(id: string, leaseOwner: string) {
  const now = new Date();
  return getDb().update(dubbingJob).set({ state: "importing", updatedAt: now,
    leaseExpiresAt: new Date(now.getTime() + LEASE_MS) })
    .where(and(eq(dubbingJob.id, id), inArray(dubbingJob.state, ["running", "importing"]),
      eq(dubbingJob.leaseOwner, leaseOwner))).run().changes === 1;
}

export function finishDubbingPoll(id: string, leaseOwner: string,
  outcome: { state: "ready"; outputAssetId: string } |
    { state: "failed"; errorCode: string } |
    { state: "waiting"; delayMs?: number; errorCode?: string | null }) {
  const now = new Date();
  const set = outcome.state === "ready" ? {
    state: "ready" as DubbingState, outputAssetId: outcome.outputAssetId,
    leaseOwner: null, leaseExpiresAt: null, nextPollAt: null, errorCode: null,
    updatedAt: now
  } : outcome.state === "failed" ? {
    state: "failed" as DubbingState, errorCode: outcome.errorCode,
    leaseOwner: null, leaseExpiresAt: null, nextPollAt: null, updatedAt: now
  } : {
    leaseOwner: null, leaseExpiresAt: null,
    nextPollAt: new Date(now.getTime() + (outcome.delayMs ?? 20_000)),
    errorCode: outcome.errorCode ?? null, updatedAt: now
  };
  return getDb().update(dubbingJob).set(set)
    .where(and(eq(dubbingJob.id, id), inArray(dubbingJob.state, ["running", "importing"]),
      eq(dubbingJob.leaseOwner, leaseOwner))).run().changes === 1;
}
