import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { getDb } from "../db";
import { transcriptionRequest } from "../db/schema";

const STALE_AFTER_MS = 60 * 60_000;

export class TranscriptionRequestConflict extends Error {
  constructor() {
    super("This request key was already used for a different transcription.");
    this.name = "TranscriptionRequestConflict";
  }
}

export function transcriptionDigest(input: {
  bytes: Buffer;
  filename: string;
  mimeType: string;
  languageCode?: string;
  diarize: boolean;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([input.filename, input.mimeType, input.languageCode ?? null, input.diarize]))
    .update("\0")
    .update(input.bytes)
    .digest("hex");
}

export function getOwnedTranscriptionRequest(ownerId: string, requestId: string) {
  // A worker crash or lost request must remain blocked from an automatic paid
  // retry. Mark the abandoned submission as uncertain for a clear status.
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  getDb().update(transcriptionRequest).set({ state: "uncertain", errorCode: "submission_unknown",
    updatedAt: new Date() }).where(and(eq(transcriptionRequest.id, requestId),
    eq(transcriptionRequest.ownerId, ownerId), eq(transcriptionRequest.state, "submitting"),
    lt(transcriptionRequest.updatedAt, cutoff))).run();
  return getDb().select().from(transcriptionRequest).where(and(
    eq(transcriptionRequest.id, requestId), eq(transcriptionRequest.ownerId, ownerId))).get() ?? null;
}

/** A request UUID is reserved before the ElevenLabs POST. No state is retried. */
export function reserveTranscriptionRequest(input: {
  ownerId: string; requestId: string; inputHash: string;
}) {
  const now = new Date();
  const created = getDb().insert(transcriptionRequest).values({
    id: input.requestId, ownerId: input.ownerId, inputHash: input.inputHash,
    state: "submitting", errorCode: null, createdAt: now, updatedAt: now
  }).onConflictDoNothing().run().changes === 1;
  const row = getOwnedTranscriptionRequest(input.ownerId, input.requestId);
  if (!row || row.inputHash !== input.inputHash) throw new TranscriptionRequestConflict();
  return { row, created };
}

export function touchTranscriptionRequest(ownerId: string, requestId: string): boolean {
  return getDb().update(transcriptionRequest).set({ updatedAt: new Date() }).where(and(
    eq(transcriptionRequest.id, requestId), eq(transcriptionRequest.ownerId, ownerId),
    eq(transcriptionRequest.state, "submitting"))).run().changes === 1;
}

export function finishTranscriptionRequest(ownerId: string, requestId: string,
  state: "succeeded" | "failed" | "uncertain", errorCode: string | null = null): boolean {
  return getDb().update(transcriptionRequest).set({ state, errorCode, updatedAt: new Date() })
    .where(and(eq(transcriptionRequest.id, requestId), eq(transcriptionRequest.ownerId, ownerId),
      eq(transcriptionRequest.state, "submitting"))).run().changes === 1;
}
