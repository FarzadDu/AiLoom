import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { getOwnedAsset } from "@/server/content/assets";
import { DubbingRequestConflictError, listOwnedDubbingJobs, publicDubbingJob,
  reserveDubbingJob } from "@/server/content/dubbing";
import { DUBBING_LANGUAGE_SET } from "@/server/dubbing/languages";
import { parseBoundedJson } from "@/server/storage/bounded-json";

export const runtime = "nodejs";
const responseHeaders = { "Cache-Control": "private, no-store" };
const inputSchema = z.strictObject({
  sourceAssetId: z.uuid(),
  sourceLanguage: z.string().refine(code => DUBBING_LANGUAGE_SET.has(code)).nullable().optional(),
  targetLanguage: z.string().refine(code => DUBBING_LANGUAGE_SET.has(code))
});

export async function GET(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  return Response.json({ jobs: listOwnedDubbingJobs(current.id)
    .map(job => publicDubbingJob(current.id, job)) }, { headers: responseHeaders });
}

export async function POST(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const rawRequestId = request.headers.get("Idempotency-Key");
  if (!rawRequestId || !z.uuid().safeParse(rawRequestId).success) {
    return Response.json({ error: "A UUID request key is required." }, { status: 400 });
  }
  const requestId = rawRequestId.toLowerCase();
  if (!process.env.ELEVENLABS_API_KEY?.trim()) {
    return Response.json({ error: "ElevenLabs is not configured." }, { status: 503 });
  }
  const parsed = await parseBoundedJson(request, inputSchema, 8_192, "Invalid dubbing request.");
  if (!parsed.success) return parsed.response;
  const source = getOwnedAsset(current.id, parsed.data.sourceAssetId);
  if (!source || source.visibility !== "private" || source.kind !== "audio" && source.kind !== "video") {
    return Response.json({ error: "Choose a private audio or video file from your library." }, { status: 404 });
  }
  if (source.sizeBytes < 1 || source.sizeBytes > 100_000_000 ||
      !["audio/mpeg", "audio/wav", "audio/ogg", "audio/flac", "video/mp4", "video/webm"].includes(source.mimeType)) {
    return Response.json({ error: "Use a supported source file up to 100 MB." }, { status: 422 });
  }
  try {
    const result = reserveDubbingJob({ ownerId: current.id, requestId,
      sourceAssetId: source.id, sourceKind: source.kind,
      sourceLanguage: parsed.data.sourceLanguage ?? null,
      targetLanguage: parsed.data.targetLanguage });
    return Response.json({ job: publicDubbingJob(current.id, result.job) },
      { status: result.created ? 202 : 200, headers: responseHeaders });
  } catch (error) {
    if (error instanceof DubbingRequestConflictError) {
      return Response.json({ error: error.message }, { status: 409, headers: responseHeaders });
    }
    return Response.json({ error: "Could not queue the dubbing request." },
      { status: 500, headers: responseHeaders });
  }
}
