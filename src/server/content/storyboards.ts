import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { asset, project, storyboard, storyboardShot } from "../db/schema";
import { getMediaModel } from "../media/registry";

export const MAX_STORYBOARD_SHOTS = 64;
export const STORYBOARD_JSON_LIMIT = 16_384;

const title = z.string().trim().min(1).max(120);
const uuid = z.uuid();
const aspectRatio = z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);
const referenceIds = z.array(uuid).max(50).refine(ids => new Set(ids).size === ids.length);

export const createStoryboardInputSchema = z.strictObject({
  title,
  description: z.string().trim().max(2_000).default(""),
  projectId: uuid.nullable().optional()
});
export const updateStoryboardInputSchema = z.strictObject({
  title: title.optional(),
  description: z.string().trim().max(2_000).optional(),
  projectId: uuid.nullable().optional()
}).refine(value => Object.keys(value).length > 0);

export const createShotInputSchema = z.strictObject({
  title,
  prompt: z.string().trim().min(1).max(4_000),
  modelId: z.string().trim().min(1).max(200),
  durationSec: z.number().int().min(4).max(30),
  aspectRatio,
  firstFrameAssetId: uuid.nullable().optional(),
  lastFrameAssetId: uuid.nullable().optional(),
  referenceAssetIds: referenceIds.default([]),
  outputAssetId: uuid.nullable().optional()
});
export const updateShotInputSchema = z.strictObject({
  title: title.optional(),
  prompt: z.string().trim().min(1).max(4_000).optional(),
  modelId: z.string().trim().min(1).max(200).optional(),
  durationSec: z.number().int().min(4).max(30).optional(),
  aspectRatio: aspectRatio.optional(),
  firstFrameAssetId: uuid.nullable().optional(),
  lastFrameAssetId: uuid.nullable().optional(),
  referenceAssetIds: referenceIds.optional(),
  outputAssetId: uuid.nullable().optional()
}).refine(value => Object.keys(value).length > 0);
export const reorderShotsInputSchema = z.strictObject({
  shotIds: z.array(uuid).max(MAX_STORYBOARD_SHOTS)
}).refine(value => new Set(value.shotIds).size === value.shotIds.length);

export class StoryboardError extends Error {
  constructor(public readonly status: 400 | 404 | 409, message: string) {
    super(message);
    this.name = "StoryboardError";
  }
}

function validId(id: string): boolean { return uuid.safeParse(id).success; }

function modelMatchesShot(modelId: string, durationSec: number, ratio: string): void {
  const model = getMediaModel(modelId);
  const operation = model?.operations[0];
  if (!model || model.outputKind !== "video" || !operation ||
      !["text_to_video", "image_to_video", "first_last_frame_to_video", "reference_to_video"].includes(operation)) {
    throw new StoryboardError(400, "Choose an available video generation model.");
  }
  if (modelId.startsWith("fal-ai/veo3.1/") &&
      (![4, 6, 8].includes(durationSec) || !["16:9", "9:16"].includes(ratio))) {
    throw new StoryboardError(400, "Veo shots support 4, 6 or 8 seconds and 16:9 or 9:16.");
  }
}

function checkProject(ownerId: string, projectId: string | null | undefined): void {
  if (!projectId) return;
  const found = getDb().select({ id: project.id }).from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, ownerId))).get();
  if (!found) throw new StoryboardError(404, "Project not found.");
}

function checkShotAssets(ownerId: string, input: {
  firstFrameAssetId?: string | null;
  lastFrameAssetId?: string | null;
  referenceAssetIds?: string[];
  outputAssetId?: string | null;
}): void {
  const inspect = (id: string, kinds: readonly string[]) => {
    const found = getDb().select({ kind: asset.kind }).from(asset)
      .where(and(eq(asset.id, id), eq(asset.ownerId, ownerId))).get();
    if (!found || !kinds.includes(found.kind)) {
      throw new StoryboardError(400, "A referenced asset is unavailable or has the wrong media type.");
    }
  };
  if (input.firstFrameAssetId) inspect(input.firstFrameAssetId, ["image"]);
  if (input.lastFrameAssetId) inspect(input.lastFrameAssetId, ["image"]);
  for (const id of input.referenceAssetIds ?? []) inspect(id, ["image", "video", "audio"]);
  if (input.outputAssetId) inspect(input.outputAssetId, ["video"]);
}

function shotView(row: typeof storyboardShot.$inferSelect) {
  return {
    id: row.id, storyboardId: row.storyboardId, position: row.position,
    title: row.title, prompt: row.prompt, modelId: row.modelId,
    durationSec: row.durationSec, aspectRatio: row.aspectRatio,
    firstFrameAssetId: row.firstFrameAssetId, lastFrameAssetId: row.lastFrameAssetId,
    referenceAssetIds: referenceIds.parse(JSON.parse(row.referenceAssetIdsJson)) as string[],
    outputAssetId: row.outputAssetId, createdAt: row.createdAt, updatedAt: row.updatedAt
  };
}

function boardView(row: typeof storyboard.$inferSelect) {
  return { id: row.id, projectId: row.projectId, title: row.title,
    description: row.description, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function ownedBoard(ownerId: string, boardId: string) {
  if (!validId(boardId)) return null;
  return getDb().select().from(storyboard)
    .where(and(eq(storyboard.id, boardId), eq(storyboard.ownerId, ownerId))).get() ?? null;
}

function ownedShot(ownerId: string, boardId: string, shotId: string) {
  if (!validId(boardId) || !validId(shotId)) return null;
  return getDb().select().from(storyboardShot)
    .where(and(eq(storyboardShot.id, shotId), eq(storyboardShot.storyboardId, boardId),
      eq(storyboardShot.ownerId, ownerId))).get() ?? null;
}

function touchBoard(ownerId: string, boardId: string, now = new Date()): void {
  getDb().update(storyboard).set({ updatedAt: now })
    .where(and(eq(storyboard.id, boardId), eq(storyboard.ownerId, ownerId))).run();
}

export function createStoryboard(ownerId: string, input: z.input<typeof createStoryboardInputSchema>) {
  const parsed = createStoryboardInputSchema.parse(input);
  checkProject(ownerId, parsed.projectId);
  const now = new Date();
  const row = { id: randomUUID(), ownerId, projectId: parsed.projectId ?? null,
    title: parsed.title, description: parsed.description, createdAt: now, updatedAt: now };
  getDb().insert(storyboard).values(row).run();
  return boardView(row);
}

export function listStoryboards(ownerId: string, limit = 100) {
  const checkedLimit = z.number().int().min(1).max(200).parse(limit);
  return getDb().select().from(storyboard).where(eq(storyboard.ownerId, ownerId))
    .orderBy(desc(storyboard.updatedAt), desc(storyboard.id)).limit(checkedLimit).all().map(boardView);
}

export function getStoryboard(ownerId: string, boardId: string) {
  const row = ownedBoard(ownerId, boardId);
  return row ? { ...boardView(row), shots: listStoryboardShots(ownerId, boardId) ?? [] } : null;
}

export function updateStoryboard(ownerId: string, boardId: string,
  input: z.input<typeof updateStoryboardInputSchema>) {
  const parsed = updateStoryboardInputSchema.parse(input);
  return getDb().transaction(() => {
    if (!ownedBoard(ownerId, boardId)) return null;
    checkProject(ownerId, parsed.projectId);
    getDb().update(storyboard).set({ ...parsed, updatedAt: new Date() })
      .where(and(eq(storyboard.id, boardId), eq(storyboard.ownerId, ownerId))).run();
    return getStoryboard(ownerId, boardId);
  });
}

export function deleteStoryboard(ownerId: string, boardId: string): boolean {
  if (!validId(boardId)) return false;
  return getDb().delete(storyboard)
    .where(and(eq(storyboard.id, boardId), eq(storyboard.ownerId, ownerId))).run().changes > 0;
}

export function listStoryboardShots(ownerId: string, boardId: string) {
  if (!ownedBoard(ownerId, boardId)) return null;
  return getDb().select().from(storyboardShot)
    .where(and(eq(storyboardShot.storyboardId, boardId), eq(storyboardShot.ownerId, ownerId)))
    .orderBy(storyboardShot.position).all().map(shotView);
}

export function getStoryboardShot(ownerId: string, boardId: string, shotId: string) {
  const row = ownedShot(ownerId, boardId, shotId);
  return row ? shotView(row) : null;
}

export function createStoryboardShot(ownerId: string, boardId: string,
  input: z.input<typeof createShotInputSchema>) {
  const parsed = createShotInputSchema.parse(input);
  return getDb().transaction(() => {
    if (!ownedBoard(ownerId, boardId)) return null;
    modelMatchesShot(parsed.modelId, parsed.durationSec, parsed.aspectRatio);
    checkShotAssets(ownerId, parsed);
    const last = getDb().select({ position: storyboardShot.position }).from(storyboardShot)
      .where(and(eq(storyboardShot.storyboardId, boardId), eq(storyboardShot.ownerId, ownerId)))
      .orderBy(desc(storyboardShot.position)).limit(1).get();
    const position = (last?.position ?? -1) + 1;
    if (position >= MAX_STORYBOARD_SHOTS) throw new StoryboardError(409, "Storyboard shot limit reached.");
    const now = new Date();
    const row = { id: randomUUID(), storyboardId: boardId, ownerId, position,
      title: parsed.title, prompt: parsed.prompt, modelId: parsed.modelId,
      durationSec: parsed.durationSec, aspectRatio: parsed.aspectRatio,
      firstFrameAssetId: parsed.firstFrameAssetId ?? null,
      lastFrameAssetId: parsed.lastFrameAssetId ?? null,
      referenceAssetIdsJson: JSON.stringify(parsed.referenceAssetIds),
      outputAssetId: parsed.outputAssetId ?? null, createdAt: now, updatedAt: now };
    getDb().insert(storyboardShot).values(row).run();
    touchBoard(ownerId, boardId, now);
    return shotView(row);
  });
}

export function updateStoryboardShot(ownerId: string, boardId: string, shotId: string,
  input: z.input<typeof updateShotInputSchema>) {
  const parsed = updateShotInputSchema.parse(input);
  return getDb().transaction(() => {
    const current = ownedShot(ownerId, boardId, shotId);
    if (!current) return null;
    modelMatchesShot(parsed.modelId ?? current.modelId,
      parsed.durationSec ?? current.durationSec, parsed.aspectRatio ?? current.aspectRatio);
    checkShotAssets(ownerId, parsed);
    const now = new Date();
    const { referenceAssetIds, ...columns } = parsed;
    getDb().update(storyboardShot).set({ ...columns,
      ...(referenceAssetIds === undefined ? {} : { referenceAssetIdsJson: JSON.stringify(referenceAssetIds) }),
      updatedAt: now }).where(and(eq(storyboardShot.id, shotId),
      eq(storyboardShot.storyboardId, boardId), eq(storyboardShot.ownerId, ownerId))).run();
    touchBoard(ownerId, boardId, now);
    return getStoryboardShot(ownerId, boardId, shotId);
  });
}

function setPositions(ownerId: string, boardId: string, ids: readonly string[]): void {
  // The first pass moves every row outside the positive range, so a unique
  // (storyboard, position) index never collides during swaps or compaction.
  for (let index = 0; index < ids.length; index++) {
    getDb().update(storyboardShot).set({ position: -index - 1 })
      .where(and(eq(storyboardShot.id, ids[index]), eq(storyboardShot.storyboardId, boardId),
        eq(storyboardShot.ownerId, ownerId))).run();
  }
  for (let index = 0; index < ids.length; index++) {
    getDb().update(storyboardShot).set({ position: index })
      .where(and(eq(storyboardShot.id, ids[index]), eq(storyboardShot.storyboardId, boardId),
        eq(storyboardShot.ownerId, ownerId))).run();
  }
}

export function reorderStoryboardShots(ownerId: string, boardId: string,
  input: z.input<typeof reorderShotsInputSchema>) {
  const { shotIds } = reorderShotsInputSchema.parse(input);
  return getDb().transaction(() => {
    const current = listStoryboardShots(ownerId, boardId);
    if (!current) return null;
    const currentIds = new Set(current.map(shot => shot.id));
    if (shotIds.length !== current.length || !shotIds.every(id => currentIds.has(id))) {
      throw new StoryboardError(409, "Shot order must contain each storyboard shot exactly once.");
    }
    setPositions(ownerId, boardId, shotIds);
    touchBoard(ownerId, boardId);
    return listStoryboardShots(ownerId, boardId);
  });
}

export function deleteStoryboardShot(ownerId: string, boardId: string, shotId: string): boolean {
  return getDb().transaction(() => {
    if (!ownedShot(ownerId, boardId, shotId)) return false;
    getDb().delete(storyboardShot).where(and(eq(storyboardShot.id, shotId),
      eq(storyboardShot.storyboardId, boardId), eq(storyboardShot.ownerId, ownerId))).run();
    const remaining = listStoryboardShots(ownerId, boardId);
    if (!remaining) throw new Error("Storyboard vanished during shot deletion.");
    setPositions(ownerId, boardId, remaining.map(shot => shot.id));
    touchBoard(ownerId, boardId);
    return true;
  });
}
