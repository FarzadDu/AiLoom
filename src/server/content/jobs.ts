import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { generationJob } from "../db/schema";
import { requireOwnedProject } from "./shared";
import { decodeJson, encodeJson, type JsonValue } from "./types";

export const jobKinds = ["image", "video", "audio", "edit", "upscale", "transcription"] as const;
export const jobStates = ["queued", "submitting", "running", "succeeded", "failed", "cancelled"] as const;
export type JobKind = typeof jobKinds[number];
export type JobState = typeof jobStates[number];

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

export function createGenerationJob(ownerId: string, input: {
  kind: JobKind; provider: string; providerModel: string; projectId?: string | null;
  payload: JsonValue; costEstimateMicrosUsd?: number | null;
}) {
  const { payload, ...metadata } = input;
  const parsed = newJobSchema.parse(metadata);
  requireOwnedProject(ownerId, parsed.projectId);
  const now = new Date();
  const record = {
    id: randomUUID(), ownerId, projectId: parsed.projectId ?? null,
    kind: parsed.kind, provider: parsed.provider, providerModel: parsed.providerModel,
    externalId: null, state: "queued" as const, inputJson: encodeJson(payload), outputJson: null,
    costEstimateMicrosUsd: parsed.costEstimateMicrosUsd ?? null, errorCode: null,
    createdAt: now, updatedAt: now, completedAt: null
  };
  getDb().insert(generationJob).values(record).run();
  return hydrate(record);
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
  errorCode?: string | null; costEstimateMicrosUsd?: number | null;
}) {
  const { output, ...metadata } = input;
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
    if (!allowedTransitions[current.state].includes(parsed.state)) {
      throw new Error(`Invalid generation job transition: ${current.state} to ${parsed.state}`);
    }
    const now = new Date();
    const completedAt = ["succeeded", "failed", "cancelled"].includes(parsed.state) ? now : null;
    tx.update(generationJob).set({
      state: parsed.state,
      externalId: parsed.externalId === undefined ? current.externalId : parsed.externalId,
      outputJson: output === undefined ? current.outputJson : encodeJson(output),
      errorCode: parsed.errorCode === undefined ? current.errorCode : parsed.errorCode,
      costEstimateMicrosUsd: parsed.costEstimateMicrosUsd === undefined
        ? current.costEstimateMicrosUsd : parsed.costEstimateMicrosUsd,
      updatedAt: now, completedAt
    }).where(and(eq(generationJob.id, jobId), eq(generationJob.ownerId, ownerId), eq(generationJob.state, current.state))).run();
    const updated = tx.select().from(generationJob).where(eq(generationJob.id, jobId)).get();
    return updated ? hydrate(updated) : null;
  });
}

// Call from the trusted worker only. The state predicate ensures two workers
// cannot claim the same queued job, even when they share the SQLite volume.
export function claimNextQueuedJob() {
  return getDb().transaction((tx) => {
    const next = tx.select().from(generationJob).where(eq(generationJob.state, "queued"))
      .orderBy(asc(generationJob.createdAt), asc(generationJob.id)).limit(1).get();
    if (!next) return null;
    const changed = tx.update(generationJob).set({ state: "submitting", updatedAt: new Date() })
      .where(and(eq(generationJob.id, next.id), eq(generationJob.state, "queued"))).run();
    if (changed.changes !== 1) return null;
    const claimed = tx.select().from(generationJob).where(eq(generationJob.id, next.id)).get();
    return claimed ? hydrate(claimed) : null;
  });
}

// Trusted-worker view for polling tasks already accepted by a provider.
export function listActiveGenerationJobs(options: { limit?: number } = {}) {
  const limit = z.number().int().min(1).max(500).parse(options.limit ?? 100);
  return getDb().select().from(generationJob)
    .where(or(eq(generationJob.state, "submitting"), eq(generationJob.state, "running")))
    .orderBy(asc(generationJob.updatedAt), asc(generationJob.id)).limit(limit).all().map(hydrate);
}
