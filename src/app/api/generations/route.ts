import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { createGenerationJob, GenerationIdempotencyConflictError, listGenerationJobs, type JobKind } from "@/server/content/jobs";
import { prepareMediaRequest, MediaRequestError } from "@/server/media/service";
import type { JsonValue } from "@/server/content/types";
import { publicJob } from "@/server/content/public-job";
import { z } from "zod";

export const runtime = "nodejs";

function jobKind(operation: string): JobKind {
  if (operation === "text_to_image") return "image";
  if (operation === "image_edit" || operation === "temporal_inpaint") return "edit";
  if (operation === "text_to_speech") return "audio";
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
  if (idempotencyKey !== null && !z.uuid().safeParse(idempotencyKey).success) {
    return Response.json({ error: "Invalid request key." }, { status: 400 });
  }
  let input: JsonValue;
  try {
    const raw = await request.text();
    if (raw.length > 100_000) return Response.json({ error: "Request too large." }, { status: 413 });
    input = JSON.parse(raw) as JsonValue;
  } catch {
    return Response.json({ error: "Invalid generation request." }, { status: 400 });
  }
  try {
    const prepared = prepareMediaRequest(input);
    const job = createGenerationJob(current.id, {
      kind: jobKind(prepared.operation),
      provider: prepared.provider,
      providerModel: prepared.modelId,
      payload: input,
      idempotencyKey: idempotencyKey ?? undefined,
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
