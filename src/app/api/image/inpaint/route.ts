import { readFile } from "node:fs/promises";
import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { getOwnedAsset } from "@/server/content/assets";
import { createGenerationJob, GenerationIdempotencyConflictError, getGenerationJob } from "@/server/content/jobs";
import { publicJob } from "@/server/content/public-job";
import { imageDimensions, inpaintDimensionsAllowed } from "@/server/media/image-dimensions";
import { prepareMediaRequest } from "@/server/media/service";
import { signedAssetUrl } from "@/server/storage/asset-access";
import { parseBoundedJson } from "@/server/storage/bounded-json";
import { mediaPath } from "@/server/storage/private-files";

export const runtime = "nodejs";

const MODEL = "wavespeed-ai/z-image/turbo-inpaint";
const requestSchema = z.strictObject({
  sourceAssetId: z.uuid(), maskAssetId: z.uuid(),
  prompt: z.string().trim().min(1).max(4000)
}).refine(value => value.sourceAssetId !== value.maskAssetId, {
  path: ["maskAssetId"], message: "The mask must be separate from the source image."
});
type InpaintInput = z.output<typeof requestSchema>;

function matchesPrivateAssetUrl(value: unknown, assetId: string): boolean {
  if (typeof value !== "string") return false;
  try {
    const base = process.env.PUBLIC_BASE_URL?.trim();
    if (!base) return false;
    const url = new URL(value);
    return url.origin === new URL(base).origin &&
      url.pathname === `/api/assets/${assetId}` &&
      url.searchParams.has("expires") && url.searchParams.has("token") &&
      [...url.searchParams.keys()].every(key => key === "expires" || key === "token");
  } catch { return false; }
}

function replay(ownerId: string, key: string, input: InpaintInput): Response | null {
  const existing = getGenerationJob(ownerId, key);
  if (!existing) return null;
  const payload = existing.input;
  if (existing.kind !== "edit" || existing.provider !== "wavespeed" || existing.providerModel !== MODEL ||
    !payload || typeof payload !== "object" || Array.isArray(payload) ||
    payload.modelId !== MODEL || payload.operation !== "image_inpaint" || payload.prompt !== input.prompt ||
    !matchesPrivateAssetUrl(payload.imageUrl, input.sourceAssetId) ||
    !matchesPrivateAssetUrl(payload.maskImageUrl, input.maskAssetId)) {
    return Response.json({ error: "This request key was already used for a different edit." }, { status: 409 });
  }
  return Response.json({ job: publicJob(existing) }, { status: 202 });
}

async function probe(url: string): Promise<boolean> {
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
  const parsed = await parseBoundedJson(request, requestSchema, 12_000, "Invalid inpaint request.");
  if (!parsed.success) return parsed.response;
  const input = parsed.data;
  const previous = replay(current.id, key, input);
  if (previous) return previous;
  const source = getOwnedAsset(current.id, input.sourceAssetId);
  const mask = getOwnedAsset(current.id, input.maskAssetId);
  if (!source || !mask) return Response.json({ error: "Image or mask not found." }, { status: 404 });
  if (source.kind !== "image" || mask.kind !== "image" ||
    !["image/png", "image/jpeg"].includes(source.mimeType) || mask.mimeType !== "image/png" ||
    source.sizeBytes > 8_000_000 || mask.sizeBytes > 8_000_000) {
    return Response.json({ error: "Use a PNG or JPEG source and a PNG mask, each under 8 MB." }, { status: 422 });
  }
  try {
    const [sourceBytes, maskBytes] = await Promise.all([
      readFile(mediaPath(source.storageKey)), readFile(mediaPath(mask.storageKey))
    ]);
    if (sourceBytes.length !== source.sizeBytes || maskBytes.length !== mask.sizeBytes) throw new Error("File changed");
    const sourceSize = imageDimensions(sourceBytes, source.mimeType);
    const maskSize = imageDimensions(maskBytes, mask.mimeType);
    if (!sourceSize || !maskSize || !inpaintDimensionsAllowed(sourceSize) ||
      sourceSize.width !== maskSize.width || sourceSize.height !== maskSize.height) {
      return Response.json({ error: "Image and mask must have matching dimensions between 256 and 4096 pixels (up to 16 MP)." }, { status: 422 });
    }
    const [sourceAccess, maskAccess] = [signedAssetUrl(source.id), signedAssetUrl(mask.id)];
    const [sourceReady, maskReady] = await Promise.all([probe(sourceAccess.url), probe(maskAccess.url)]);
    if (!sourceReady || !maskReady) {
      return Response.json({ error: "The public HTTPS site cannot serve the private edit references yet." }, { status: 409 });
    }
    const payload = { modelId: MODEL, operation: "image_inpaint", prompt: input.prompt,
      imageUrl: sourceAccess.url, maskImageUrl: maskAccess.url };
    const prepared = prepareMediaRequest(payload);
    const job = createGenerationJob(current.id, {
      kind: "edit", provider: prepared.provider, providerModel: MODEL, payload,
      idempotencyKey: key,
      costEstimateMicrosUsd: prepared.priceEstimate ? Math.round(prepared.priceEstimate.amountUsd * 1_000_000) : null
    });
    return Response.json({ job: publicJob(job), estimate: prepared.priceEstimate }, { status: 202 });
  } catch (error) {
    if (error instanceof GenerationIdempotencyConflictError) {
      return replay(current.id, key, input) ?? Response.json({ error: "Request key conflict." }, { status: 409 });
    }
    return Response.json({ error: "Could not prepare the private image edit." }, { status: 500 });
  }
}
