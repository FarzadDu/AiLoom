import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { createGenerationJob, GenerationIdempotencyConflictError, listGenerationJobs } from "@/server/content/jobs";
import { publicJob } from "@/server/content/public-job";
import type { JsonValue } from "@/server/content/types";
import { MediaRequestError, prepareMediaRequest } from "@/server/media/service";
import { BoundedJsonError, readBoundedJson } from "@/server/storage/bounded-json";

export const runtime = "nodejs";

const MODEL_ID = "fal-ai/stable-audio-3/small/sfx/text-to-audio";

export async function GET(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  const effects = listGenerationJobs(current.id, { limit: 100, providerModel: MODEL_ID });
  return Response.json({ effects: effects.map(publicJob) },
    { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const requestKey = request.headers.get("Idempotency-Key");
  if (!requestKey || !z.uuid().safeParse(requestKey).success) {
    return Response.json({ error: "A valid request key is required." }, { status: 400 });
  }
  let input: JsonValue;
  try { input = await readBoundedJson(request, 16_000) as JsonValue; }
  catch (error) {
    return Response.json({ error: error instanceof BoundedJsonError && error.status === 413
      ? "Request is too large." : "Invalid sound effect request." },
    { status: error instanceof BoundedJsonError && error.status === 413 ? 413 : 400 });
  }
  try {
    const prepared = prepareMediaRequest(input);
    if (prepared.modelId !== MODEL_ID || prepared.operation !== "text_to_sound_effect") {
      return Response.json({ error: "Unsupported sound effect model." }, { status: 422 });
    }
    const effect = createGenerationJob(current.id, {
      kind: "audio", provider: prepared.provider, providerModel: prepared.modelId,
      payload: input, idempotencyKey: requestKey
    });
    return Response.json({ effect: publicJob(effect) }, { status: 202,
      headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof GenerationIdempotencyConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof MediaRequestError) {
      return Response.json({ error: error.message, fields: error.fields }, { status: 422 });
    }
    return Response.json({ error: "Could not queue the sound effect." }, { status: 500 });
  }
}
