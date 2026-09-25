import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { createGenerationJob, GenerationIdempotencyConflictError, listGenerationJobs, type JobKind } from "@/server/content/jobs";
import { prepareMediaRequest, MediaRequestError } from "@/server/media/service";
import type { JsonValue } from "@/server/content/types";
import { publicJob } from "@/server/content/public-job";
import { BoundedJsonError, readBoundedJson } from "@/server/storage/bounded-json";
import { z } from "zod";

export const runtime = "nodejs";

function jobKind(operation: string): JobKind {
  if (operation === "text_to_image" || operation === "character_to_image") return "image";
  if (operation === "image_upscale") return "upscale";
  if (operation === "image_edit" || operation === "image_inpaint" || operation === "temporal_inpaint") return "edit";
  if (operation === "text_to_speech" || operation === "text_to_music" || operation === "text_to_sound_effect") return "audio";
  return "video";
}

export async function GET(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  const jobs = listGenerationJobs(current.id, { limit: 50 });
  return Response.json({ jobs: jobs.map(publicJob) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!idempotencyKey || !z.uuid().safeParse(idempotencyKey).success) {
    return Response.json({ error: "A UUID Idempotency-Key is required." }, { status: 400 });
  }
  let input: JsonValue;
  try {
    input = await readBoundedJson(request, 100_000) as JsonValue;
  } catch (error) {
    if (error instanceof BoundedJsonError && error.status === 413) {
      return Response.json({ error: "Request too large." }, { status: 413 });
    }
    return Response.json({ error: "Invalid generation request." }, { status: 400 });
  }
  try {
    const prepared = prepareMediaRequest(input);
    if (prepared.operation === "image_inpaint" || prepared.operation === "character_to_image") {
      return Response.json({ error: "Use the private image reference endpoint." }, { status: 422 });
    }
    const job = createGenerationJob(current.id, {
      kind: jobKind(prepared.operation),
      provider: prepared.provider,
      providerModel: prepared.modelId,
      payload: input,
      idempotencyKey: idempotencyKey.toLowerCase(),
      costEstimateMicrosUsd: prepared.priceEstimate
        ? Math.max(0, Math.round(prepared.priceEstimate.amountUsd * 1_000_000)) : null
    });
    return Response.json({ job: publicJob(job), estimate: prepared.priceEstimate }, { status: 202 });
  } catch (error) {
    if (error instanceof GenerationIdempotencyConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof MediaRequestError) {
      return Response.json({ error: error.message, fields: error.fields }, { status: 422 });
    }
    return Response.json({ error: "Could not queue the generation." }, { status: 500 });
  }
}
