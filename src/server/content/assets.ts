import { randomUUID } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { asset } from "../db/schema";
import { requireOwnedProject } from "./shared";

const assetInput = z.object({
  kind: z.enum(["image", "video", "audio", "file"]),
  source: z.enum(["upload", "generation"]),
  mimeType: z.string().trim().min(3).max(200),
  originalName: z.string().trim().min(1).max(255).nullable().optional(),
  sizeBytes: z.number().int().min(0).max(10_000_000_000),
  storageKey: z.string().min(1).max(500).regex(/^[a-zA-Z0-9._/-]+$/)
    .refine((value) => value.split("/").every((part) => part !== "" && part !== "." && part !== ".."), "Invalid storage key"),
  projectId: z.uuid().nullable().optional()
}).strict();

export function createAsset(ownerId: string, input: z.input<typeof assetInput>) {
  const parsed = assetInput.parse(input);
  requireOwnedProject(ownerId, parsed.projectId);
  const now = new Date();
  const record = {
    id: randomUUID(), ownerId, projectId: parsed.projectId ?? null,
    kind: parsed.kind, source: parsed.source, visibility: "private" as const,
    mimeType: parsed.mimeType, originalName: parsed.originalName ?? null,
    sizeBytes: parsed.sizeBytes, storageKey: parsed.storageKey, createdAt: now, updatedAt: now
  };
  getDb().insert(asset).values(record).run();
  return record;
}

export function getOwnedAsset(ownerId: string, assetId: string) {
  return getDb().select().from(asset)
    .where(and(eq(asset.id, assetId), eq(asset.ownerId, ownerId))).get() ?? null;
}

export function getAssetForRead(requesterId: string | null, assetId: string) {
  return getDb().select().from(asset)
    .where(and(eq(asset.id, assetId), requesterId
      ? or(eq(asset.ownerId, requesterId), eq(asset.visibility, "public"))
      : eq(asset.visibility, "public"))).get() ?? null;
}

export function listAssets(ownerId: string, options: { kind?: "image" | "video" | "audio" | "file"; limit?: number } = {}) {
  const limit = z.number().int().min(1).max(200).parse(options.limit ?? 100);
  return getDb().select().from(asset)
    .where(and(eq(asset.ownerId, ownerId), options.kind ? eq(asset.kind, options.kind) : undefined))
    .orderBy(desc(asset.createdAt), desc(asset.id)).limit(limit).all();
}

export function setAssetVisibility(ownerId: string, assetId: string, visibility: "private" | "public") {
  const validated = z.enum(["private", "public"]).parse(visibility);
  if (!getOwnedAsset(ownerId, assetId)) return null;
  getDb().update(asset).set({ visibility: validated, updatedAt: new Date() })
    .where(and(eq(asset.id, assetId), eq(asset.ownerId, ownerId))).run();
  return getOwnedAsset(ownerId, assetId);
}

export function deleteAsset(ownerId: string, assetId: string) {
  const existing = getOwnedAsset(ownerId, assetId);
  if (!existing) return null;
  getDb().delete(asset)
    .where(and(eq(asset.id, assetId), eq(asset.ownerId, ownerId))).run();
  return existing;
}
