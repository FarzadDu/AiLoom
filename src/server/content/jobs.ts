import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { generationJob } from "../db/schema";
import { requireOwnedProject } from "./shared";
import { decodeJson, encodeJson, type JsonValue } from "./types";

export const jobKinds = ["image", "video", "audio", "edit", "upscale", "transcription"] as const;
export const jobStates = ["queued", "submitting", "running", "succeeded", "failed", "cancelled"] as const;
export type JobKind = typeof jobKinds[number];
export type JobState = typeof jobStates[number];
export const GENERATION_LEASE_MS = 2 * 60 * 1000;

const newJobSchema = z.object({
  kind: z.enum(jobKinds),
  provider: z.string().trim().min(1).max(80),
  providerModel: z.string().trim().min(1).max(200),
  projectId: z.uuid().nullable().optional(),
  costEstimateMicrosUsd: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional()
}).strict();

const allowedTransitions: Record<JobState, readonly JobState[]> = {
  queued: ["submitting", "cancelled"],
  submitting: ["running", "succeeded", "failed", "cancelled"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: ["queued"],
  cancelled: []
};

function hydrate(row: typeof generationJob.$inferSelect) {
  return { ...row, input: decodeJson(row.inputJson), output: row.outputJson ? decodeJson(row.outputJson) : null };
}

const referenceKeys = new Set(["imageUrl", "videoUrl", "maskVideoUrl", "imageUrls", "videoUrls", "audioUrls"]);

function comparableReferenceUrl(value: string): string {
  try {
    const base = process.env.PUBLIC_BASE_URL?.trim();
    if (!base) return value;
    const url = new URL(value);
    const expectedOrigin = new URL(base).origin;
    const match = /^\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(url.pathname);
    if (url.origin !== expectedOrigin || !match || !url.searchParams.has("expires") ||
      !url.searchParams.has("token") ||
      [...url.searchParams.keys()].some(key => key !== "expires" && key !== "token")) return value;
    return `private-asset:${match[1].toLowerCase()}`;
  } catch { return value; }
}

function comparablePayload(value: JsonValue, key = ""): JsonValue {
  if (typeof value === "string") return referenceKeys.has(key) ? comparableReferenceUrl(value) : value;
  if (Array.isArray(value)) return value.map(item => comparablePayload(item, key));
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([childKey, child]) => [childKey, comparablePayload(child, childKey)]));
  return value;
}

export class GenerationIdempotencyConflictError extends Error {
  constructor() {
    super("This request key was already used for a different generation.");
    this.name = "GenerationIdempotencyConflictError";
  }
}

export function createGenerationJob(ownerId: string, input: {
  kind: JobKind; provider: string; providerModel: string; projectId?: string | null;
  payload: JsonValue; costEstimateMicrosUsd?: number | null; idempotencyKey?: string;
}) {
  const { payload, idempotencyKey, ...metadata } = input;
  const parsed = newJobSchema.parse(metadata);
  const jobId = idempotencyKey === undefined ? randomUUID() : z.uuid().parse(idempotencyKey);
  requireOwnedProject(ownerId, parsed.projectId);
  const now = new Date();
  const record = {
    id: jobId, ownerId, projectId: parsed.projectId ?? null,
    kind: parsed.kind, provider: parsed.provider, providerModel: parsed.providerModel,
    externalId: null, state: "queued" as const, leaseOwner: null, leaseExpiresAt: null,
    inputJson: encodeJson(payload), outputJson: null,
    costEstimateMicrosUsd: parsed.costEstimateMicrosUsd ?? null, errorCode: null,
    createdAt: now, updatedAt: now, completedAt: null
  };
  const inserted = getDb().insert(generationJob).values(record).onConflictDoNothing().run();
  if (inserted.changes === 1) return hydrate(record);
  // The primary key is the caller's stable request UUID. A duplicate response
  // returns the existing job only for precisely the same owner and request.
  const existing = getDb().select().from(generationJob).where(eq(generationJob.id, jobId)).get();
  if (!existing || existing.ownerId !== ownerId || existing.kind !== parsed.kind ||
    existing.provider !== parsed.provider || existing.providerModel !== parsed.providerModel ||
    existing.projectId !== (parsed.projectId ?? null) ||
    !isDeepStrictEqual(comparablePayload(decodeJson(existing.inputJson)), comparablePayload(payload))) {
    throw new GenerationIdempotencyConflictError();
  }
  return hydrate(existing);
}

export function getGenerationJob(ownerId: string, jobId: string) {
  const row = getDb().select().from(generationJob)
    .where(and(eq(generationJob.id, jobId), eq(generationJob.ownerId, ownerId))).get();
  return row ? hydrate(row) : null;
}

export function listGenerationJobs(ownerId: string, options: { limit?: number; state?: JobState } = {}) {
  const limit = z.number().int().min(1).max(200).parse(options.limit ?? 50);
  const state = options.state ? z.enum(jobStates).parse(options.state) : undefined;
  return getDb().select().from(generationJob)
    .where(and(eq(generationJob.ownerId, ownerId), state ? eq(generationJob.state, state) : undefined))
    .orderBy(desc(generationJob.createdAt), desc(generationJob.id)).limit(limit).all().map(hydrate);
}

export function transitionGenerationJob(ownerId: string, jobId: string, input: {
  state: JobState; externalId?: string | null; output?: JsonValue;
  errorCode?: string | null; costEstimateMicrosUsd?: number | null; leaseOwner?: string;
}) {
  const { output, leaseOwner, ...metadata } = input;
  if (leaseOwner !== undefined) z.uuid().parse(leaseOwner);
  const parsed = z.object({
    state: z.enum(jobStates),
    externalId: z.string().trim().min(1).max(500).nullable().optional(),
    errorCode: z.string().trim().min(1).max(120).nullable().optional(),
    costEstimateMicrosUsd: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional()
  }).strict().parse(metadata);
  return getDb().transaction((tx) => {
    const current = tx.select().from(generationJob)
      .where(and(eq(generationJob.id, jobId), eq(generationJob.ownerId, ownerId))).get();
    if (!current) return null;
    if (leaseOwner !== undefined && current.leaseOwner !== leaseOwner) return null;
    if (!allowedTransitions[current.state].includes(parsed.state)) {
      throw new Error(`Invalid generation job transition: ${current.state} to ${parsed.state}`);
    }
    const now = new Date();
    const completedAt = ["succeeded", "failed", "cancelled"].includes(parsed.state) ? now : null;
    const changed = tx.update(generationJob).set({
      state: parsed.state,
      leaseOwner: null,
      leaseExpiresAt: null,
      externalId: parsed.externalId === undefined ? current.externalId : parsed.externalId,
      outputJson: output === undefined ? current.outputJson : encodeJson(output),
      errorCode: parsed.errorCode === undefined ? current.errorCode : parsed.errorCode,
      costEstimateMicrosUsd: parsed.costEstimateMicrosUsd === undefined
        ? current.costEstimateMicrosUsd : parsed.costEstimateMicrosUsd,
      updatedAt: now, completedAt
    }).where(and(eq(generationJob.id, jobId), eq(generationJob.ownerId, ownerId),
      eq(generationJob.state, current.state),
      leaseOwner === undefined ? undefined : eq(generationJob.leaseOwner, leaseOwner))).run();
    if (changed.changes !== 1) return null;
    const updated = tx.select().from(generationJob).where(eq(generationJob.id, jobId)).get();
    return updated ? hydrate(updated) : null;
  });
}

// Call from the trusted worker only. The state predicate ensures two workers
// cannot claim the same queued job, even when they share the SQLite volume.
export function claimNextQueuedJob(leaseOwner = randomUUID()) {
  z.uuid().parse(leaseOwner);
  return getDb().transaction((tx) => {
    const next = tx.select().from(generationJob).where(eq(generationJob.state, "queued"))
      .orderBy(asc(generationJob.createdAt), asc(generationJob.id)).limit(1).get();
    if (!next) return null;
    const now = new Date();
    const changed = tx.update(generationJob).set({ state: "submitting", leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + GENERATION_LEASE_MS), updatedAt: now })
      .where(and(eq(generationJob.id, next.id), eq(generationJob.state, "queued"))).run();
    if (changed.changes !== 1) return null;
    const claimed = tx.select().from(generationJob).where(eq(generationJob.id, next.id)).get();
    return claimed ? hydrate(claimed) : null;
  });
}

export function renewGenerationJobLease(ownerId: string, jobId: string, leaseOwner: string,
  state: "submitting" | "running"): boolean {
  const now = new Date();
  const changed = getDb().update(generationJob)
    .set({ leaseExpiresAt: new Date(now.getTime() + GENERATION_LEASE_MS) })
    .where(and(eq(generationJob.id, jobId), eq(generationJob.ownerId, ownerId),
      eq(generationJob.state, state), eq(generationJob.leaseOwner, leaseOwner)))
    .run();
  return changed.changes === 1;
}

export function claimRunningGenerationJob(ownerId: string, jobId: string, leaseOwner: string) {
  z.uuid().parse(leaseOwner);
  const now = new Date();
  const claimed = getDb().update(generationJob)
    .set({ leaseOwner, leaseExpiresAt: new Date(now.getTime() + GENERATION_LEASE_MS) })
    .where(and(eq(generationJob.id, jobId), eq(generationJob.ownerId, ownerId),
      eq(generationJob.state, "running"),
      or(isNull(generationJob.leaseExpiresAt), lte(generationJob.leaseExpiresAt, now))))
    .returning().get();
  return claimed ? hydrate(claimed) : null;
}

export function releaseGenerationJobLease(ownerId: string, jobId: string, leaseOwner: string): boolean {
  const changed = getDb().update(generationJob)
    .set({ leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() })
    .where(and(eq(generationJob.id, jobId), eq(generationJob.ownerId, ownerId),
      eq(generationJob.state, "running"), eq(generationJob.leaseOwner, leaseOwner)))
    .run();
  return changed.changes === 1;
}

export function expireStaleSubmittingJob(ownerId: string, jobId: string): boolean {
  const now = new Date();
  const legacyGrace = new Date(now.getTime() - GENERATION_LEASE_MS);
  const changed = getDb().update(generationJob)
    .set({ state: "failed", leaseOwner: null, leaseExpiresAt: null,
      errorCode: "submission_uncertain", updatedAt: now, completedAt: now })
    .where(and(eq(generationJob.id, jobId), eq(generationJob.ownerId, ownerId),
      eq(generationJob.state, "submitting"), isNull(generationJob.externalId),
      or(lte(generationJob.leaseExpiresAt, now),
        and(isNull(generationJob.leaseExpiresAt), lte(generationJob.updatedAt, legacyGrace)))))
    .run();
  return changed.changes === 1;
}

// Trusted-worker view for polling tasks already accepted by a provider.
export function listActiveGenerationJobs(options: { limit?: number } = {}) {
  const limit = z.number().int().min(1).max(500).parse(options.limit ?? 100);
  return getDb().select().from(generationJob)
    .where(or(eq(generationJob.state, "submitting"), eq(generationJob.state, "running")))
    .orderBy(asc(generationJob.updatedAt), asc(generationJob.id)).limit(limit).all().map(hydrate);
}
