import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { getOwnedAsset } from "@/server/content/assets";
import { getStoryboard } from "@/server/content/storyboards";
import { createGenerationJob, GenerationIdempotencyConflictError,
  getGenerationJob } from "@/server/content/jobs";
import { publicJob } from "@/server/content/public-job";
import { storyboardRenderJobSchema } from "@/server/media/storyboard-render";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const MODEL = "storyboard-compose-v1";

function privateJson(value: unknown, status: number): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return privateJson({ error: "Sign in required." }, 401);
  if (!mutationOriginAllowed(request)) return privateJson({ error: "Invalid request origin." }, 403);
  const rawKey = request.headers.get("Idempotency-Key");
  if (!rawKey || !z.uuid().safeParse(rawKey).success) {
    return privateJson({ error: "A UUID Idempotency-Key is required." }, 400);
  }
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return privateJson({ error: "Storyboard not found." }, 404);
  const key = rawKey.toLowerCase();
  const existing = getGenerationJob(current.id, key);
  if (existing) {
    const input = storyboardRenderJobSchema.safeParse(existing.input);
    return existing.provider === "local" && existing.providerModel === MODEL &&
      input.success && input.data.boardId === id
      ? privateJson({ job: publicJob(existing) }, 202)
      : privateJson({ error: "This request key was already used for another generation." }, 409);
  }
  const board = getStoryboard(current.id, id);
  if (!board) return privateJson({ error: "Storyboard not found." }, 404);
  if (!board.shots.length || board.shots.some(shot => !shot.outputAssetId)) {
    return privateJson({ error: "Every storyboard shot needs a completed video output." }, 409);
  }
  const payload = storyboardRenderJobSchema.safeParse({ boardId: board.id,
    aspectRatio: board.shots[0].aspectRatio,
    shots: board.shots.map(shot => ({ assetId: shot.outputAssetId,
      durationSec: shot.durationSec })) });
  if (!payload.success) {
    return privateJson({ error: "Use up to 64 shots with a total length up to 10 minutes." }, 422);
  }
  for (const shot of payload.data.shots) {
    const asset = getOwnedAsset(current.id, shot.assetId);
    if (!asset || asset.kind !== "video" ||
        !["video/mp4", "video/webm"].includes(asset.mimeType)) {
      return privateJson({ error: "A shot output video is unavailable." }, 409);
    }
  }
  try {
    const job = createGenerationJob(current.id, {
      kind: "video", provider: "local", providerModel: MODEL,
      projectId: board.projectId, idempotencyKey: key, payload: payload.data
    });
    return privateJson({ job: publicJob(job) }, 202);
  } catch (error) {
    if (error instanceof GenerationIdempotencyConflictError) {
      return privateJson({ error: "This request key was already used for different shots." }, 409);
    }
    return privateJson({ error: "Could not queue this storyboard render." }, 500);
  }
}
