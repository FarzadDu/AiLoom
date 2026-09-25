import { readFile } from "node:fs/promises";
import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { getOwnedAsset } from "@/server/content/assets";
import { createGenerationJob, GenerationIdempotencyConflictError, getGenerationJob } from "@/server/content/jobs";
import { getProject } from "@/server/content/projects";
import { publicJob } from "@/server/content/public-job";
import { ContentAccessError } from "@/server/content/shared";
import { prepareMediaRequest } from "@/server/media/service";
import { signedAssetUrl } from "@/server/storage/asset-access";
import { parseBoundedJson } from "@/server/storage/bounded-json";
import { inspectFile, mediaPath } from "@/server/storage/private-files";

export const runtime = "nodejs";

const MODEL = "fal-ai/ideogram/character";
const imageSize = z.enum(["square_hd", "square", "portrait_4_3", "portrait_16_9",
  "landscape_4_3", "landscape_16_9"]);
const requestSchema = z.strictObject({
  sourceAssetId: z.uuid(),
  prompt: z.string().trim().min(1).max(4000),
  imageSize: imageSize.optional(),
  renderingSpeed: z.enum(["BALANCED", "QUALITY"]).optional(),
  projectId: z.uuid().nullable().optional()
});
type CharacterInput = z.output<typeof requestSchema>;

function sameSignedAsset(value: unknown, assetId: string): boolean {
  if (typeof value !== "string") return false;
  try {
    const base = process.env.PUBLIC_BASE_URL?.trim();
    if (!base) return false;
    const url = new URL(value);
    return url.origin === new URL(base).origin && url.pathname === `/api/assets/${assetId}` &&
      url.searchParams.has("expires") && url.searchParams.has("token") &&
      [...url.searchParams.keys()].every(key => key === "expires" || key === "token");
  } catch { return false; }
}

function replay(ownerId: string, key: string, input: CharacterInput): Response | null {
  const existing = getGenerationJob(ownerId, key);
  if (!existing) return null;
  const payload = existing.input;
  if (existing.kind !== "image" || existing.provider !== "fal" || existing.providerModel !== MODEL ||
    existing.projectId !== (input.projectId ?? null) ||
    !payload || typeof payload !== "object" || Array.isArray(payload) ||
    payload.modelId !== MODEL || payload.operation !== "character_to_image" ||
    payload.prompt !== input.prompt ||
    payload.imageSize !== (input.imageSize ?? "square_hd") ||
    payload.renderingSpeed !== (input.renderingSpeed ?? "BALANCED") ||
    !sameSignedAsset(payload.imageUrl, input.sourceAssetId)) {
    return Response.json({ error: "This request key was already used for a different image." }, { status: 409 });
  }
  return Response.json({ job: publicJob(existing) }, { status: 202 });
}

async function accessible(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { headers: { Range: "bytes=0-0" }, redirect: "error",
      cache: "no-store", signal: AbortSignal.timeout(8_000) });
    await response.body?.cancel();
    return response.status === 200 || response.status === 206;
  } catch { return false; }
}

export async function POST(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const key = request.headers.get("Idempotency-Key");
  if (!key || !z.uuid().safeParse(key).success) {
    return Response.json({ error: "A valid request key is required." }, { status: 400 });
  }
  const parsed = await parseBoundedJson(request, requestSchema, 12_000, "Invalid character request.");
  if (!parsed.success) return parsed.response;
  const input = parsed.data;
  if (input.projectId && !getProject(current.id, input.projectId)) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }
  const previous = replay(current.id, key, input);
  if (previous) return previous;

  const source = getOwnedAsset(current.id, input.sourceAssetId);
  if (!source) return Response.json({ error: "Reference image not found." }, { status: 404 });
  if (source.kind !== "image" ||
    !["image/png", "image/jpeg", "image/webp"].includes(source.mimeType) ||
    source.sizeBytes < 1 || source.sizeBytes > 10_000_000) {
    return Response.json({ error: "Use one PNG, JPEG or WebP image up to 10 MB." }, { status: 422 });
  }
  try {
    const bytes = await readFile(mediaPath(source.storageKey));
    if (bytes.length !== source.sizeBytes || !inspectFile(bytes, source.mimeType)) {
      return Response.json({ error: "The reference image is unavailable or invalid." }, { status: 422 });
    }
    const access = signedAssetUrl(source.id);
    if (!await accessible(access.url)) {
      return Response.json({ error: "The public HTTPS site cannot serve the private reference yet." }, { status: 409 });
    }
    const payload = { modelId: MODEL, operation: "character_to_image", prompt: input.prompt,
      imageUrl: access.url, imageSize: input.imageSize ?? "square_hd",
      renderingSpeed: input.renderingSpeed ?? "BALANCED" };
    const prepared = prepareMediaRequest(payload);
    const job = createGenerationJob(current.id, {
      kind: "image", provider: prepared.provider, providerModel: MODEL,
      projectId: input.projectId,
      payload, idempotencyKey: key,
      costEstimateMicrosUsd: prepared.priceEstimate
        ? Math.round(prepared.priceEstimate.amountUsd * 1_000_000) : null
    });
    return Response.json({ job: publicJob(job), estimate: prepared.priceEstimate }, { status: 202 });
  } catch (error) {
    if (error instanceof GenerationIdempotencyConflictError) {
      return replay(current.id, key, input) ?? Response.json({ error: "Request key conflict." }, { status: 409 });
    }
    if (error instanceof ContentAccessError) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }
    return Response.json({ error: "Could not prepare the private character reference." }, { status: 500 });
  }
}
