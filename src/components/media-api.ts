export type MediaModel = {
  id: string;
  name: string;
  provider: string;
  operations: string[];
  outputKind: "image" | "video" | "audio";
  priceNote?: string;
};

export type MediaAsset = { id?: string; kind: string; url: string; contentType?: string | null };
export type LibraryAsset = {
  id: string;
  kind: "image" | "video" | "audio";
  url: string;
  visibility: "private" | "public";
  mimeType: string;
  originalName: string | null;
  createdAt: string;
};
export type MediaJob = {
  id: string;
  state: "queued" | "submitting" | "running" | "succeeded" | "failed" | "cancelled";
  providerModel: string;
  output: unknown;
  errorCode?: string | null;
  costEstimateMicrosUsd?: number | null;
};

export function mediaViewForJob(kind: unknown, providerModel: unknown, models: MediaModel[] = []): "image" | "video" | "audio" | null {
  if (kind === "image" || kind === "video" || kind === "audio") return kind;
  if (kind === "upscale") return "image";
  if (kind === "edit") {
    const catalogModel = models.find(model => model.id === providerModel);
    if (catalogModel) return catalogModel.outputKind;
    if (providerModel === "fal-ai/qwen-image-edit" ||
      providerModel === "wavespeed-ai/z-image/turbo-inpaint") return "image";
    if (providerModel === "fal-ai/ltx-2.3-quality/inpaint") return "video";
  }
  return null;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function mediaModelsFromPayload(payload: unknown): MediaModel[] {
  const items = record(payload)?.models;
  if (!Array.isArray(items)) return [];
  const models: MediaModel[] = [];
  for (const item of items) {
    const value = record(item);
    if (!value || typeof value.id !== "string" || typeof value.name !== "string") continue;
    if (value.outputKind !== "image" && value.outputKind !== "video" && value.outputKind !== "audio") continue;
    models.push({
      id: value.id, name: value.name, provider: typeof value.provider === "string" ? value.provider : "",
      operations: Array.isArray(value.operations) ? value.operations.filter((part): part is string => typeof part === "string") : [],
      outputKind: value.outputKind, priceNote: typeof value.priceNote === "string" ? value.priceNote : undefined
    });
  }
  return models;
}

export function mediaJobFromPayload(payload: unknown): MediaJob | null {
  const value = record(record(payload)?.job);
  if (!value || typeof value.id !== "string") return null;
  if (!["queued", "submitting", "running", "succeeded", "failed", "cancelled"].includes(String(value.state))) return null;
  return {
    id: value.id,
    state: value.state as MediaJob["state"],
    providerModel: typeof value.providerModel === "string" ? value.providerModel : "",
    output: value.output,
    errorCode: typeof value.errorCode === "string" ? value.errorCode : null,
    costEstimateMicrosUsd: typeof value.costEstimateMicrosUsd === "number" ? value.costEstimateMicrosUsd : null
  };
}

export function mediaAssetsFromJob(job: MediaJob | null): MediaAsset[] {
  if (!job) return [];
  const value = record(job.output);
  const candidates = value?.assets ?? value?.outputs ?? value?.media;
  if (!Array.isArray(candidates)) return [];
  const assets: MediaAsset[] = [];
  for (const candidate of candidates) {
    const item = record(candidate);
    const url = item?.url;
    if (typeof url !== "string" || !(/^https:\/\//i.test(url) || /^\/api\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url))) continue;
    const id = typeof item?.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)
      ? item.id : /^\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(url)?.[1];
    assets.push({ id, kind: typeof item?.kind === "string" ? item.kind : "file", url,
      contentType: typeof item?.mimeType === "string" ? item.mimeType : typeof item?.contentType === "string" ? item.contentType : null });
  }
  return assets;
}

export function libraryAssetsFromPayload(payload: unknown, kind: LibraryAsset["kind"]): LibraryAsset[] {
  const candidates = record(payload)?.assets;
  if (!Array.isArray(candidates)) return [];
  const assets: LibraryAsset[] = [];
  for (const candidate of candidates) {
    const item = record(candidate);
    if (!item || item.kind !== kind || item.source !== "generation" ||
      typeof item.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id) ||
      (item.visibility !== "private" && item.visibility !== "public")) continue;
    assets.push({ id: item.id, kind, url: `/api/assets/${item.id}`, visibility: item.visibility,
      mimeType: typeof item.mimeType === "string" ? item.mimeType : "",
      originalName: typeof item.originalName === "string" ? item.originalName : null,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : "" });
  }
  return assets;
}

export function libraryPageFromPayload(payload: unknown, kind: LibraryAsset["kind"]): {
  assets: LibraryAsset[]; nextCursor: string | null;
} {
  const next = record(payload)?.nextCursor;
  return { assets: libraryAssetsFromPayload(payload, kind),
    nextCursor: typeof next === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(next) ? next : null };
}

export function mediaDownloadName(asset: Pick<MediaAsset, "id" | "kind" | "contentType">): string {
  const extension = asset.contentType === "image/jpeg" ? "jpg" : asset.contentType === "image/webp" ? "webp"
    : asset.contentType === "image/gif" ? "gif"
    : asset.contentType === "video/webm" ? "webm" : asset.contentType === "audio/mpeg" ? "mp3"
    : asset.contentType === "audio/wav" || asset.contentType === "audio/x-wav" ? "wav"
    : asset.contentType === "audio/ogg" ? "ogg"
    : asset.kind === "video" ? "mp4" : asset.kind === "audio" ? "mp3" : "png";
  return `ailoom-${asset.kind}-${asset.id?.slice(0, 8) || "output"}.${extension}`;
}
