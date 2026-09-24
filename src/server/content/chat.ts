import { randomUUID } from "node:crypto";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { asset, conversation, message } from "../db/schema";
import { ContentAccessError, requireOwnedProject } from "./shared";
import { contentBlocksSchema, type ContentBlock } from "./types";

const conversationInput = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  projectId: z.uuid().nullable().optional(),
  modelId: z.string().trim().min(1).max(200).optional()
}).strict();

const messageInput = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  modelId: z.string().trim().min(1).max(200).optional(),
  blocks: contentBlocksSchema
}).strict();

export function createConversation(
  userId: string,
  input: { title?: string; projectId?: string | null; modelId?: string } = {}
) {
  const parsed = conversationInput.parse(input);
  requireOwnedProject(userId, parsed.projectId);
  const now = new Date();
  const record = {
    id: randomUUID(), ownerId: userId, projectId: parsed.projectId ?? null,
    title: parsed.title ?? "New conversation", modelId: parsed.modelId ?? null,
    createdAt: now, updatedAt: now, archivedAt: null
  };
  getDb().insert(conversation).values(record).run();
  return record;
}

export function getConversation(userId: string, conversationId: string) {
  return getDb().select().from(conversation)
    .where(and(eq(conversation.id, conversationId), eq(conversation.ownerId, userId))).get() ?? null;
}

export function listConversations(userId: string, options: { limit?: number; cursor?: string } = {}) {
  const limit = z.number().int().min(1).max(100).parse(options.limit ?? 50);
  const cursor = options.cursor ? getConversation(userId, options.cursor) : null;
  if (options.cursor && !cursor) return [];
  const olderThan = cursor ? or(
    lt(conversation.updatedAt, cursor.updatedAt),
    and(eq(conversation.updatedAt, cursor.updatedAt), lt(conversation.id, cursor.id))
  ) : undefined;
  return getDb().select().from(conversation)
    .where(and(eq(conversation.ownerId, userId), olderThan))
    .orderBy(desc(conversation.updatedAt), desc(conversation.id)).limit(limit).all();
}

export function updateConversation(
  userId: string,
  conversationId: string,
  input: { title?: string; modelId?: string | null }
) {
  const parsed = z.object({
    title: z.string().trim().min(1).max(160).optional(),
    modelId: z.string().trim().min(1).max(200).nullable().optional()
  }).strict().parse(input);
  if (!getConversation(userId, conversationId)) return null;
  getDb().update(conversation).set({ ...parsed, updatedAt: new Date() })
    .where(and(eq(conversation.id, conversationId), eq(conversation.ownerId, userId))).run();
  return getConversation(userId, conversationId);
}

export function deleteConversation(userId: string, conversationId: string): boolean {
  const result = getDb().delete(conversation)
    .where(and(eq(conversation.id, conversationId), eq(conversation.ownerId, userId))).run();
  return result.changes > 0;
}

function checkAssetAccess(userId: string, blocks: ContentBlock[]) {
  for (const block of blocks) {
    if (block.type === "text" || block.type === "sources") continue;
    const accessible = getDb().select({ kind: asset.kind }).from(asset)
      .where(and(eq(asset.id, block.assetId), or(eq(asset.ownerId, userId), eq(asset.visibility, "public")))).get();
    if (!accessible || accessible.kind !== block.type) throw new ContentAccessError();
  }
}

export function appendMessage(
  userId: string,
  conversationId: string,
  input: { role: "user" | "assistant" | "system" | "tool"; modelId?: string; blocks: ContentBlock[] }
) {
  const parsed = messageInput.parse(input);
  if (!getConversation(userId, conversationId)) return null;
  checkAssetAccess(userId, parsed.blocks);
  return getDb().transaction((tx) => {
    const last = tx.select({ position: message.position }).from(message)
      .where(eq(message.conversationId, conversationId))
      .orderBy(desc(message.position)).limit(1).get();
    const now = new Date();
    const saved = {
      id: randomUUID(), conversationId, position: (last?.position ?? 0) + 1,
      role: parsed.role, modelId: parsed.modelId ?? null,
      blocksJson: JSON.stringify(parsed.blocks), createdAt: now
    };
    tx.insert(message).values(saved).run();
    tx.update(conversation).set({ updatedAt: now })
      .where(and(eq(conversation.id, conversationId), eq(conversation.ownerId, userId))).run();
    return { ...saved, blocks: parsed.blocks };
  });
}

export function listMessages(
  userId: string,
  conversationId: string,
  options: { limit?: number; before?: string } = {}
) {
  if (!getConversation(userId, conversationId)) return null;
  const limit = z.number().int().min(1).max(200).parse(options.limit ?? 100);
  const cursor = options.before ? getDb().select().from(message)
    .where(and(eq(message.id, options.before), eq(message.conversationId, conversationId))).get() : null;
  if (options.before && !cursor) return [];
  const olderThan = cursor ? lt(message.position, cursor.position) : undefined;
  return getDb().select().from(message)
    .where(and(eq(message.conversationId, conversationId), olderThan))
    .orderBy(desc(message.position)).limit(limit).all()
    .reverse().map(({ blocksJson, ...row }) => ({ ...row, blocks: contentBlocksSchema.parse(JSON.parse(blocksJson)) }));
}
