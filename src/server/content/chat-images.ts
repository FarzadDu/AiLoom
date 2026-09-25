import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { getDb } from "../db";
import { chatImageRequest } from "../db/schema";

const STALE_AFTER_MS = 10 * 60_000;

export class ChatImageRequestConflict extends Error {
  constructor() {
    super("This request key belongs to a different image request.");
    this.name = "ChatImageRequestConflict";
  }
}

export function chatImageDigest(input: {
  conversationId: string | null; projectId: string | null; prompt: string;
  model: string; aspectRatio: string | null; referenceAssetIds: string[];
}): string {
  return createHash("sha256").update(JSON.stringify([
    input.conversationId, input.projectId, input.prompt, input.model,
    input.aspectRatio, input.referenceAssetIds
  ])).digest("hex");
}

export function getOwnedChatImageRequest(ownerId: string, requestId: string) {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  getDb().update(chatImageRequest).set({ state: "uncertain", errorCode: "submission_unknown",
    updatedAt: new Date() }).where(and(eq(chatImageRequest.id, requestId),
    eq(chatImageRequest.ownerId, ownerId), eq(chatImageRequest.state, "submitting"),
    lt(chatImageRequest.updatedAt, cutoff))).run();
  return getDb().select().from(chatImageRequest).where(and(eq(chatImageRequest.id, requestId),
    eq(chatImageRequest.ownerId, ownerId))).get() ?? null;
}

/** The primary key is reserved before any provider POST. No state is retried. */
export function reserveChatImageRequest(input: {
  ownerId: string; requestId: string; inputHash: string;
}) {
  const now = new Date();
  const created = getDb().insert(chatImageRequest).values({
    id: input.requestId, ownerId: input.ownerId, inputHash: input.inputHash,
    state: "submitting", responseJson: null, errorCode: null,
    createdAt: now, updatedAt: now
  }).onConflictDoNothing().run().changes === 1;
  const row = getOwnedChatImageRequest(input.ownerId, input.requestId);
  if (!row || row.inputHash !== input.inputHash) throw new ChatImageRequestConflict();
  return { row, created };
}

export function finishChatImageRequest(ownerId: string, requestId: string,
  outcome: { state: "succeeded"; responseJson: string } |
    { state: "failed" | "uncertain"; errorCode: string }): boolean {
  const patch = outcome.state === "succeeded"
    ? { state: outcome.state, responseJson: outcome.responseJson, errorCode: null }
    : { state: outcome.state, responseJson: null, errorCode: outcome.errorCode };
  return getDb().update(chatImageRequest).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(chatImageRequest.id, requestId), eq(chatImageRequest.ownerId, ownerId),
      eq(chatImageRequest.state, "submitting"))).run().changes === 1;
}
