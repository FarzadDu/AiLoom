import { mediaModelsFromPayload, type MediaModel } from "./media-api";

export type StoryboardAsset = {
  id: string;
  kind: "image" | "video" | "audio";
  source: "upload" | "generation";
  originalName: string | null;
  url: string;
};
export type ShotAspect = "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";
export type StoryboardShot = {
  id: string;
  storyboardId: string;
  position: number;
  title: string;
  prompt: string;
  modelId: string;
  durationSec: number;
  aspectRatio: ShotAspect;
  firstFrameAssetId: string | null;
  lastFrameAssetId: string | null;
  referenceAssetIds: string[];
  outputAssetId: string | null;
};
export type StoryboardSummary = {
  id: string;
  title: string;
  description: string;
  projectId: string | null;
  updatedAt: string;
};
export type StoryboardDetail = StoryboardSummary & { shots: StoryboardShot[] };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const aspects = new Set<ShotAspect>(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);
const videoOperations = new Set(["text_to_video", "image_to_video",
  "first_last_frame_to_video", "reference_to_video"]);
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const id = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
const optionalId = (value: unknown): value is string | null => value === null || id(value);

function boardFromPayload(value: unknown): StoryboardSummary | null {
  const item = record(value);
  if (!item || !id(item.id) || typeof item.title !== "string" ||
      typeof item.description !== "string" || !optionalId(item.projectId) ||
      typeof item.updatedAt !== "string") return null;
  return { id: item.id, title: item.title, description: item.description,
    projectId: item.projectId, updatedAt: item.updatedAt };
}

function shotFromPayload(value: unknown): StoryboardShot | null {
  const item = record(value);
  if (!item || !id(item.id) || !id(item.storyboardId) ||
      !Number.isInteger(item.position) || typeof item.position !== "number" || item.position < 0 ||
      typeof item.title !== "string" || typeof item.prompt !== "string" ||
      typeof item.modelId !== "string" || !Number.isInteger(item.durationSec) ||
      typeof item.durationSec !== "number" || item.durationSec < 4 || item.durationSec > 30 ||
      !aspects.has(item.aspectRatio as ShotAspect) ||
      !optionalId(item.firstFrameAssetId) || !optionalId(item.lastFrameAssetId) ||
      !optionalId(item.outputAssetId) || !Array.isArray(item.referenceAssetIds) ||
      !item.referenceAssetIds.every(id)) return null;
  return { id: item.id, storyboardId: item.storyboardId, position: item.position,
    title: item.title, prompt: item.prompt, modelId: item.modelId,
    durationSec: item.durationSec, aspectRatio: item.aspectRatio as ShotAspect,
    firstFrameAssetId: item.firstFrameAssetId, lastFrameAssetId: item.lastFrameAssetId,
    referenceAssetIds: item.referenceAssetIds,
    outputAssetId: item.outputAssetId };
}

export function storyboardsFromPayload(payload: unknown): StoryboardSummary[] | null {
  const items = record(payload)?.storyboards;
  if (!Array.isArray(items)) return null;
  const boards = items.map(boardFromPayload);
  return boards.every(Boolean) ? boards as StoryboardSummary[] : null;
}

export function storyboardFromPayload(payload: unknown): StoryboardDetail | null {
  const item = record(payload)?.storyboard;
  const board = boardFromPayload(item);
  const shots = record(item)?.shots;
  if (!board || !Array.isArray(shots)) return null;
  const parsed = shots.map(shotFromPayload);
  if (!parsed.every(Boolean) || parsed.some(shot => shot?.storyboardId !== board.id)) return null;
  return { ...board, shots: (parsed as StoryboardShot[]).sort((a, b) => a.position - b.position) };
}

export function storyboardAssetsFromPayload(payload: unknown): {
  assets: StoryboardAsset[]; nextCursor: string | null;
} | null {
  const body = record(payload);
  if (!body || !Array.isArray(body.assets)) return null;
  const assets: StoryboardAsset[] = body.assets.flatMap((value): StoryboardAsset[] => {
    const item = record(value);
    if (!item || !id(item.id) ||
        (item.kind !== "image" && item.kind !== "video" && item.kind !== "audio") ||
        (item.source !== "upload" && item.source !== "generation")) return [];
    return [{ id: item.id, kind: item.kind, source: item.source,
      originalName: typeof item.originalName === "string" ? item.originalName : null,
      url: `/api/assets/${item.id}` }];
  });
  const nextCursor = typeof body.nextCursor === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(body.nextCursor)
    ? body.nextCursor : null;
  return { assets, nextCursor };
}

export function storyboardVideoModels(payload: unknown): MediaModel[] {
  return mediaModelsFromPayload(payload).filter(model => model.outputKind === "video" &&
    model.operations.some(operation => videoOperations.has(operation)));
}

export function normalizeShotControls(modelId: string, durationSec: number, aspect: ShotAspect): {
  durationSec: number; aspectRatio: ShotAspect;
} {
  if (!modelId.startsWith("fal-ai/veo3.1/")) return { durationSec, aspectRatio: aspect };
  return {
    durationSec: [4, 6, 8].includes(durationSec) ? durationSec : 8,
    aspectRatio: aspect === "9:16" ? "9:16" : "16:9"
  };
}

export function storyboardRenderReadiness(shots: readonly Pick<StoryboardShot, "outputAssetId">[]): {
  completed: number; total: number; ready: boolean;
} {
  const completed = shots.filter(shot => typeof shot.outputAssetId === "string" && id(shot.outputAssetId)).length;
  return { completed, total: shots.length, ready: shots.length > 0 && completed === shots.length };
}

export type StoryboardRenderRequest = { snapshot: string; key: string; jobId?: string };

export function storyboardRenderSnapshot(board: Pick<StoryboardDetail, "id" | "shots">): string {
  return JSON.stringify({ boardId: board.id, aspectRatio: board.shots[0]?.aspectRatio ?? null,
    shots: board.shots.map(shot => ({ id: shot.id, outputAssetId: shot.outputAssetId,
      durationSec: shot.durationSec })) });
}

export function chooseStoryboardRenderRequest(
  raw: string | null, snapshot: string, createKey: () => string
): StoryboardRenderRequest {
  if (raw) {
    try {
      const prior = JSON.parse(raw) as Partial<StoryboardRenderRequest>;
      if (prior.snapshot === snapshot && id(prior.key) &&
          (prior.jobId === undefined || id(prior.jobId))) {
        return prior as StoryboardRenderRequest;
      }
    } catch { /* Discard malformed browser storage. */ }
  }
  const key = createKey();
  if (!id(key)) throw new Error("A UUID render request key is required.");
  return { snapshot, key };
}
