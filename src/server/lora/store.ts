import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { getDb } from "../db";
import { loraDataset, loraInference, loraModel } from "../db/schema";

export class LoraRequestConflict extends Error {
  constructor() { super("The request key already belongs to another LoRA request."); }
}

export function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createDataset(ownerId: string, input: {
  id: string; storageKey: string; sizeBytes: number; imageCount: number;
}) {
  const row = { ...input, ownerId, createdAt: new Date() };
  getDb().insert(loraDataset).values(row).run();
  return row;
}

export function getOwnedDataset(ownerId: string, id: string) {
  return getDb().select().from(loraDataset).where(and(eq(loraDataset.id, id), eq(loraDataset.ownerId, ownerId))).get() ?? null;
}

export function getDataset(id: string) {
  return getDb().select().from(loraDataset).where(eq(loraDataset.id, id)).get() ?? null;
}

export function listOwnedDatasets(ownerId: string) {
  return getDb().select().from(loraDataset).where(eq(loraDataset.ownerId, ownerId))
    .orderBy(desc(loraDataset.createdAt), desc(loraDataset.id)).limit(100).all();
}

export function reserveTraining(input: {
  ownerId: string; id: string; datasetId: string; name: string; triggerWord: string | null;
  steps: number; rank: number;
}) {
  const now = new Date();
  const inputHash = requestHash([input.datasetId, input.name, input.triggerWord, input.steps, input.rank]);
  const row = { ...input, inputHash, state: "queued" as const, createdAt: now, updatedAt: now };
  const created = getDb().insert(loraModel).values(row).onConflictDoNothing().run().changes === 1;
  const current = getDb().select().from(loraModel).where(eq(loraModel.id, input.id)).get();
  if (!current || current.ownerId !== input.ownerId || current.inputHash !== inputHash) throw new LoraRequestConflict();
  return { model: current, created };
}

export function getOwnedModel(ownerId: string, id: string) {
  return getDb().select().from(loraModel).where(and(eq(loraModel.id, id), eq(loraModel.ownerId, ownerId))).get() ?? null;
}

export function getModel(id: string) {
  return getDb().select().from(loraModel).where(eq(loraModel.id, id)).get() ?? null;
}

export function listOwnedModels(ownerId: string) {
  return getDb().select().from(loraModel).where(eq(loraModel.ownerId, ownerId))
    .orderBy(desc(loraModel.createdAt), desc(loraModel.id)).limit(100).all();
}

export function reserveInference(input: {
  ownerId: string; id: string; modelId: string; prompt: string; scale: number; size: string;
}) {
  const now = new Date();
  const inputHash = requestHash([input.modelId, input.prompt, input.scale, input.size]);
  const row = { ...input, inputHash, state: "queued" as const, createdAt: now, updatedAt: now };
  const created = getDb().insert(loraInference).values(row).onConflictDoNothing().run().changes === 1;
  const current = getDb().select().from(loraInference).where(eq(loraInference.id, input.id)).get();
  if (!current || current.ownerId !== input.ownerId || current.inputHash !== inputHash) throw new LoraRequestConflict();
  return { inference: current, created };
}

export function getOwnedInference(ownerId: string, id: string) {
  return getDb().select().from(loraInference)
    .where(and(eq(loraInference.id, id), eq(loraInference.ownerId, ownerId))).get() ?? null;
}

export function listOwnedInferences(ownerId: string) {
  return getDb().select().from(loraInference).where(eq(loraInference.ownerId, ownerId))
    .orderBy(desc(loraInference.createdAt), desc(loraInference.id)).limit(100).all();
}

const CLAIM_MS = 5 * 60_000;
const UNCERTAIN_AFTER_MS = 5 * 60_000;

export function claimModelTask(workerId: string) {
  const now = new Date();
  const available = or(isNull(loraModel.leaseExpiresAt), lt(loraModel.leaseExpiresAt, now));
  const candidate = getDb().select().from(loraModel)
    .where(and(inArray(loraModel.state, ["queued", "running", "importing"]), available))
    .orderBy(loraModel.createdAt).limit(1).get();
  if (!candidate) return null;
  const state = candidate.state === "queued" ? "submitting" as const : candidate.state;
  const changed = getDb().update(loraModel).set({ state, leaseOwner: workerId,
    leaseExpiresAt: new Date(now.getTime() + CLAIM_MS), updatedAt: now })
    .where(and(eq(loraModel.id, candidate.id), eq(loraModel.state, candidate.state), available)).run().changes;
  return changed ? getModel(candidate.id) : null;
}

export function updateModelTask(id: string, workerId: string, patch: Partial<typeof loraModel.$inferInsert>) {
  const changed = getDb().update(loraModel).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(loraModel.id, id), eq(loraModel.leaseOwner, workerId))).run().changes;
  return changed ? getModel(id) : null;
}

export function claimInferenceTask(workerId: string) {
  const now = new Date();
  const available = or(isNull(loraInference.leaseExpiresAt), lt(loraInference.leaseExpiresAt, now));
  const candidate = getDb().select().from(loraInference)
    .where(and(inArray(loraInference.state, ["queued", "running", "importing"]), available))
    .orderBy(loraInference.createdAt).limit(1).get();
  if (!candidate) return null;
  const state = candidate.state === "queued" ? "submitting" as const : candidate.state;
  const changed = getDb().update(loraInference).set({ state, leaseOwner: workerId,
    leaseExpiresAt: new Date(now.getTime() + CLAIM_MS), updatedAt: now })
    .where(and(eq(loraInference.id, candidate.id), eq(loraInference.state, candidate.state), available)).run().changes;
  return changed ? getDb().select().from(loraInference).where(eq(loraInference.id, candidate.id)).get() ?? null : null;
}

export function updateInferenceTask(id: string, workerId: string, patch: Partial<typeof loraInference.$inferInsert>) {
  const changed = getDb().update(loraInference).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(loraInference.id, id), eq(loraInference.leaseOwner, workerId))).run().changes;
  return changed ? getDb().select().from(loraInference).where(eq(loraInference.id, id)).get() ?? null : null;
}

export function markStaleSubmissionsUncertain(): void {
  const cutoff = new Date(Date.now() - UNCERTAIN_AFTER_MS);
  const now = new Date();
  getDb().update(loraModel).set({ state: "uncertain", errorCode: "submission_unknown",
    leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
    .where(and(eq(loraModel.state, "submitting"), lt(loraModel.updatedAt, cutoff))).run();
  getDb().update(loraInference).set({ state: "uncertain", errorCode: "submission_unknown",
    leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
    .where(and(eq(loraInference.state, "submitting"), lt(loraInference.updatedAt, cutoff))).run();
}

export function attachTrainingPrediction(ownerId: string, id: string, predictionId: string) {
  getDb().update(loraModel).set({ state: "running", providerTaskId: predictionId,
    errorCode: null, updatedAt: new Date() })
    .where(and(eq(loraModel.id, id), eq(loraModel.ownerId, ownerId), eq(loraModel.state, "uncertain"),
      isNull(loraModel.providerTaskId))).run();
  return getOwnedModel(ownerId, id);
}

export function attachInferencePrediction(ownerId: string, id: string, predictionId: string) {
  getDb().update(loraInference).set({ state: "running", providerTaskId: predictionId,
    errorCode: null, updatedAt: new Date() })
    .where(and(eq(loraInference.id, id), eq(loraInference.ownerId, ownerId), eq(loraInference.state, "uncertain"),
      isNull(loraInference.providerTaskId))).run();
  return getOwnedInference(ownerId, id);
}

export function publicModel(row: NonNullable<ReturnType<typeof getOwnedModel>>) {
  return { id: row.id, datasetId: row.datasetId, name: row.name, triggerWord: row.triggerWord,
    steps: row.steps, rank: row.rank, state: row.state, errorCode: row.errorCode,
    weightSizeBytes: row.weightSizeBytes, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function publicInference(row: NonNullable<ReturnType<typeof getOwnedInference>>) {
  return { id: row.id, modelId: row.modelId, prompt: row.prompt, scale: row.scale / 1000,
    size: row.size, state: row.state, errorCode: row.errorCode,
    outputUrl: row.outputAssetId ? `/api/assets/${row.outputAssetId}` : null,
    createdAt: row.createdAt, updatedAt: row.updatedAt };
}
