import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { createAsset, deleteAsset, getOwnedAsset } from "@/server/content/assets";
import { beginCaptionClaim, captionRequestDigest, finishCaptionClaim, readCaptionClaim,
  type CaptionClaimState } from "@/server/media/caption-claims";
import { CaptionError, parseCaptions, renderBurnedCaptions } from "@/server/media/captions";
import { parseBoundedJson } from "@/server/storage/bounded-json";
import { mediaPath } from "@/server/storage/private-files";

export const runtime = "nodejs";
export const maxDuration = 240;

const schema = z.strictObject({
  sourceAssetId: z.uuid(),
  format: z.enum(["srt", "vtt"]),
  text: z.string().min(1).max(48_000)
});

function publicAsset(asset: { id: string; sizeBytes: number }) {
  return { id: asset.id, kind: "video", mimeType: "video/mp4",
    sizeBytes: asset.sizeBytes, visibility: "private", url: `/api/assets/${asset.id}` };
}

function reply(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function existingResponse(ownerId: string, state: CaptionClaimState): Response {
  switch (state.state) {
    case "conflict": return reply({ error: "This request key was already used for different captions." }, 409);
    case "expired": return reply({ error: "The previous caption attempt timed out. Use a new request key." }, 409);
    case "failed": return reply({ error: "The previous caption attempt failed. Use a new request key." }, 409);
    case "processing": return reply({ status: "processing" }, 202);
    case "completed": {
      const asset = getOwnedAsset(ownerId, state.assetId);
      if (!asset || asset.kind !== "video") return reply({ error: "The captioned video is no longer available." }, 410);
      return reply({ status: "completed", asset: publicAsset(asset) }, 200);
    }
  }
}

export async function POST(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return reply({ error: "Sign in required." }, 401);
  if (!mutationOriginAllowed(request)) return reply({ error: "Invalid request origin." }, 403);
  const rawKey = request.headers.get("Idempotency-Key");
  if (!rawKey || !z.uuid().safeParse(rawKey).success) {
    return reply({ error: "A UUID Idempotency-Key is required." }, 400);
  }
  const key = rawKey.toLowerCase();
  const parsed = await parseBoundedJson(request, schema, 60_000, "Invalid caption request.");
  if (!parsed.success) return parsed.response;
  const input = parsed.data;
  let cues;
  try { cues = parseCaptions(input.format, input.text); }
  catch (error) {
    return reply({ error: error instanceof CaptionError ? error.message : "Invalid captions." }, 422);
  }
  const digest = captionRequestDigest(input);
  try {
    const previous = await readCaptionClaim(current.id, key, digest);
    if (previous) return existingResponse(current.id, previous);
  } catch { return reply({ error: "Could not read the caption request." }, 500); }

  const source = getOwnedAsset(current.id, input.sourceAssetId);
  if (!source || source.kind !== "video" || !["video/mp4", "video/webm"].includes(source.mimeType)) {
    return reply({ error: "Source video not found." }, 404);
  }
  if (source.sizeBytes < 1 || source.sizeBytes > 75_000_000) {
    return reply({ error: "Use a source video under 75 MB." }, 422);
  }
  try {
    const claimed = await beginCaptionClaim(current.id, key, digest);
    if (!claimed) {
      const previous = await readCaptionClaim(current.id, key, digest);
      return previous ? existingResponse(current.id, previous)
        : reply({ error: "Could not resolve the request key." }, 409);
    }
  } catch { return reply({ error: "Could not start caption rendering." }, 500); }

  const outputKey = `captions/outputs/${randomUUID()}.mp4`;
  const outputPath = mediaPath(outputKey);
  const workDir = dirname(mediaPath(`captions/work/${randomUUID()}/captions.ass`));
  let assetId: string | null = null;
  let completed = false;
  try {
    const rendered = await renderBurnedCaptions({
      sourcePath: mediaPath(source.storageKey), sourceBytes: source.sizeBytes,
      outputPath, workDir, cues
    });
    const asset = createAsset(current.id, {
      kind: "video", source: "generation", mimeType: "video/mp4",
      sizeBytes: rendered.sizeBytes, storageKey: outputKey, projectId: source.projectId
    });
    assetId = asset.id;
    await finishCaptionClaim(current.id, key, { state: "completed", assetId });
    completed = true;
    return reply({ status: "completed", asset: publicAsset(asset),
      durationSec: rendered.durationSec, audioPreserved: rendered.audioPreserved }, 201);
  } catch (error) {
    if (error instanceof CaptionError) {
      return reply({ error: error.message, code: error.code },
        error.code === "tool_unavailable" ? 503 : error.code === "render_failed" ? 500 : 422);
    }
    return reply({ error: "Could not render the captioned video." }, 500);
  } finally {
    if (!completed) {
      if (assetId) deleteAsset(current.id, assetId);
      await rm(outputPath, { force: true }).catch(() => undefined);
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      await finishCaptionClaim(current.id, key, { state: "failed" }).catch(() => undefined);
    }
  }
}
