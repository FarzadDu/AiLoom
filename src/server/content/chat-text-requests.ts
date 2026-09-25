import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, lt } from "drizzle-orm";
import { getDb } from "../db";
import { chatTextRequest, conversation, message } from "../db/schema";
import { contentBlocksSchema, type ContentBlock } from "./types";

const STALE_AFTER_MS = 15 * 60_000;

export class ChatTextRequestConflict extends Error {
  constructor() {
    super("This request key belongs to a different chat turn.");
    this.name = "ChatTextRequestConflict";
  }
}

export function chatTextDigest(input: {
  conversationId: string | null; projectId: string | null; text: string;
  model: string | null; webSearch: boolean; attachmentIds: string[];
  specialistId: string | null;
}): string {
  return createHash("sha256").update(JSON.stringify([
    input.conversationId, input.projectId, input.text, input.model,
    input.webSearch, input.attachmentIds, input.specialistId
  ])).digest("hex");
}

export function getOwnedChatTextRequest(ownerId: string, requestId: string) {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  getDb().update(chatTextRequest).set({ state: "uncertain", errorCode: "submission_unknown",
    updatedAt: new Date() }).where(and(eq(chatTextRequest.id, requestId),
    eq(chatTextRequest.ownerId, ownerId), eq(chatTextRequest.state, "submitting"),
    lt(chatTextRequest.updatedAt, cutoff))).run();
  return getDb().select().from(chatTextRequest).where(and(eq(chatTextRequest.id, requestId),
    eq(chatTextRequest.ownerId, ownerId))).get() ?? null;
}

/** Reserve before any billable POST. A second request with this UUID never submits again. */
export function reserveChatTextRequest(input: {
  ownerId: string; requestId: string; inputHash: string;
}) {
  const now = new Date();
  const created = getDb().insert(chatTextRequest).values({
    id: input.requestId, ownerId: input.ownerId, inputHash: input.inputHash,
    state: "submitting", conversationId: null, userMessageId: null,
    assistantMessageId: null, errorCode: null, createdAt: now, updatedAt: now
  }).onConflictDoNothing().run().changes === 1;
  const row = getOwnedChatTextRequest(input.ownerId, input.requestId);
  if (!row || row.inputHash !== input.inputHash) throw new ChatTextRequestConflict();
  return { row, created };
}

/** Save the user turn and its request link in one SQLite transaction. */
export function startChatTextTurn(input: {
  ownerId: string; requestId: string; existingConversationId: string | null;
  projectId: string | null; title: string; model: string;
  userBlocks: ContentBlock[]; systemText?: string;
}) {
  const blocks = contentBlocksSchema.parse(input.userBlocks);
  return getDb().transaction(tx => {
    const request = tx.select().from(chatTextRequest).where(and(
      eq(chatTextRequest.id, input.requestId), eq(chatTextRequest.ownerId, input.ownerId),
      eq(chatTextRequest.state, "submitting"))).get();
    if (!request || request.conversationId || request.userMessageId) throw new ChatTextRequestConflict();
    const now = new Date();
    let current = input.existingConversationId
      ? tx.select().from(conversation).where(and(eq(conversation.id, input.existingConversationId),
        eq(conversation.ownerId, input.ownerId))).get() : null;
    if (input.existingConversationId && !current) throw new Error("Conversation unavailable.");
    if (!current) {
      current = { id: randomUUID(), ownerId: input.ownerId, projectId: input.projectId,
        title: input.title, modelId: input.model, createdAt: now, updatedAt: now,
        archivedAt: null };
      tx.insert(conversation).values(current).run();
    }
    const last = tx.select({ position: message.position }).from(message)
      .where(eq(message.conversationId, current.id)).orderBy(desc(message.position)).limit(1).get();
    let position = last?.position ?? 0;
    if (input.systemText) {
      tx.insert(message).values({ id: randomUUID(), conversationId: current.id,
        position: ++position, role: "system", modelId: input.model,
        blocksJson: JSON.stringify([{ type: "text", text: input.systemText }]), createdAt: now }).run();
    }
    const userMessageId = randomUUID();
    tx.insert(message).values({ id: userMessageId, conversationId: current.id,
      position: ++position, role: "user", modelId: input.model,
      blocksJson: JSON.stringify(blocks), createdAt: now }).run();
    tx.update(conversation).set({ updatedAt: now }).where(eq(conversation.id, current.id)).run();
    tx.update(chatTextRequest).set({ conversationId: current.id, userMessageId,
      updatedAt: now }).where(and(eq(chatTextRequest.id, input.requestId),
      eq(chatTextRequest.ownerId, input.ownerId), eq(chatTextRequest.state, "submitting"))).run();
    return { conversationId: current.id, userMessageId };
  });
}

export function touchChatTextRequest(ownerId: string, requestId: string): boolean {
  return getDb().update(chatTextRequest).set({ updatedAt: new Date() }).where(and(
    eq(chatTextRequest.id, requestId), eq(chatTextRequest.ownerId, ownerId),
    eq(chatTextRequest.state, "submitting"))).run().changes === 1;
}

export function finishChatTextRequest(ownerId: string, requestId: string,
  state: "failed" | "uncertain", errorCode: string): boolean {
  return getDb().update(chatTextRequest).set({ state, errorCode,
    updatedAt: new Date() }).where(and(eq(chatTextRequest.id, requestId),
    eq(chatTextRequest.ownerId, ownerId), eq(chatTextRequest.state, "submitting"))).run().changes === 1;
}

/** Assistant message and completion record commit together, so replay is exact. */
export function completeChatTextRequest(input: {
  ownerId: string; requestId: string; model: string; answer: string;
  sources: Array<{ url: string; title: string }>;
}) {
  const blocks = contentBlocksSchema.parse([
    { type: "text", text: input.answer },
    ...(input.sources.length ? [{ type: "sources" as const, sources: input.sources }] : [])
  ]);
  return getDb().transaction(tx => {
    const request = tx.select().from(chatTextRequest).where(and(
      eq(chatTextRequest.id, input.requestId), eq(chatTextRequest.ownerId, input.ownerId),
      eq(chatTextRequest.state, "submitting"))).get();
    if (!request?.conversationId || !request.userMessageId) throw new Error("Chat turn is unavailable.");
    const current = tx.select().from(conversation).where(and(
      eq(conversation.id, request.conversationId), eq(conversation.ownerId, input.ownerId))).get();
    if (!current) throw new Error("Conversation unavailable.");
    const last = tx.select({ position: message.position }).from(message)
      .where(eq(message.conversationId, current.id)).orderBy(desc(message.position)).limit(1).get();
    const now = new Date();
    const assistantMessageId = randomUUID();
    tx.insert(message).values({ id: assistantMessageId, conversationId: current.id,
      position: (last?.position ?? 0) + 1, role: "assistant", modelId: input.model,
      blocksJson: JSON.stringify(blocks), createdAt: now }).run();
    tx.update(conversation).set({ updatedAt: now }).where(eq(conversation.id, current.id)).run();
    tx.update(chatTextRequest).set({ state: "completed", assistantMessageId,
      errorCode: null, updatedAt: now }).where(and(eq(chatTextRequest.id, input.requestId),
      eq(chatTextRequest.ownerId, input.ownerId), eq(chatTextRequest.state, "submitting"))).run();
    return { conversationId: current.id, userMessageId: request.userMessageId, assistantMessageId };
  });
}

export function chatTextRequestStatus(ownerId: string, requestId: string) {
  const row = getOwnedChatTextRequest(ownerId, requestId);
  if (!row) return null;
  let answer: string | null = null;
  let sources: Array<{ url: string; title: string }> = [];
  if (row.state === "completed" && row.assistantMessageId) {
    const saved = getDb().select({ blocksJson: message.blocksJson }).from(message)
      .where(and(eq(message.id, row.assistantMessageId),
        eq(message.conversationId, row.conversationId!))).get();
    if (saved) {
      const blocks = contentBlocksSchema.safeParse(JSON.parse(saved.blocksJson));
      if (blocks.success) {
        answer = blocks.data.find(block => block.type === "text")?.text ?? null;
        sources = blocks.data.find(block => block.type === "sources")?.sources ?? [];
      }
    }
  }
  return { status: row.state === "submitting" ? "processing" : row.state,
    requestId: row.id, conversationId: row.conversationId,
    userMessageId: row.userMessageId, assistantMessageId: row.assistantMessageId,
    answer, sources };
}
