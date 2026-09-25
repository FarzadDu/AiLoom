import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { parseTranscriptionRequest, TranscriptionRequestError } from "@/server/media/transcription-request";
import { ElevenLabsError, transcribeAudio } from "@/server/providers/elevenlabs";
import { finishTranscriptionRequest, getOwnedTranscriptionRequest,
  reserveTranscriptionRequest, touchTranscriptionRequest, transcriptionDigest,
  TranscriptionRequestConflict } from "@/server/content/transcription-requests";
import { z } from "zod";

export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store" };

function priorResponse(ownerId: string, requestId: string): Response {
  const prior = getOwnedTranscriptionRequest(ownerId, requestId);
  if (!prior) return Response.json({ error: "Transcription request not found." },
    { status: 404, headers: privateHeaders });
  const error = prior.state === "submitting"
    ? "This transcription is already processing. It was not sent again."
    : prior.state === "succeeded"
      ? "This transcription already completed. Ailoom does not save transcripts, so the result cannot be replayed."
      : prior.state === "failed"
        ? "This transcription request failed. Start a new request if you choose to try again."
        : "The provider outcome is uncertain. This transcription was not sent again.";
  return Response.json({ status: prior.state === "submitting" ? "processing" : prior.state === "succeeded"
    ? "completed" : prior.state, requestId, error }, { status: 409, headers: privateHeaders });
}

export async function GET(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401, headers: privateHeaders });
  const requestId = new URL(request.url).searchParams.get("requestId");
  if (!requestId || !z.uuid().safeParse(requestId).success) return Response.json({ error: "A UUID request key is required." },
    { status: 400, headers: privateHeaders });
  return priorResponse(current.id, requestId.toLowerCase());
}

export async function POST(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const rawKey = request.headers.get("Idempotency-Key");
  if (!rawKey || !z.uuid().safeParse(rawKey).success) return Response.json({ error: "A UUID Idempotency-Key is required." },
    { status: 400, headers: privateHeaders });
  const requestId = rawKey.toLowerCase();

  let input: Awaited<ReturnType<typeof parseTranscriptionRequest>>;
  try { input = await parseTranscriptionRequest(request); }
  catch (error) {
    if (error instanceof TranscriptionRequestError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Could not read transcription upload." }, { status: 400 });
  }
  if (!process.env.ELEVENLABS_API_KEY?.trim()) {
    return Response.json({ error: "Transcription provider is not configured." },
      { status: 503, headers: privateHeaders });
  }
  try {
    const reservation = reserveTranscriptionRequest({ ownerId: current.id, requestId,
      inputHash: transcriptionDigest(input) });
    if (!reservation.created) return priorResponse(current.id, requestId);
  } catch (error) {
    return error instanceof TranscriptionRequestConflict
      ? Response.json({ error: "This request key was already used for a different transcription." },
        { status: 409, headers: privateHeaders })
      : Response.json({ error: "Could not reserve the transcription request." },
        { status: 500, headers: privateHeaders });
  }
  const heartbeat = setInterval(() => {
    try { touchTranscriptionRequest(current.id, requestId); }
    catch { /* A database outage never authorizes a second provider POST. */ }
  }, 30_000);
  heartbeat.unref();
  try {
    const transcript = await transcribeAudio({ ...input, signal: request.signal });
    try { finishTranscriptionRequest(current.id, requestId, "succeeded"); }
    catch { /* The reservation remains non-retryable if completion cannot be saved. */ }
    return Response.json(transcript, { headers: privateHeaders });
  } catch (error) {
    const definite = error instanceof ElevenLabsError && error.status >= 400 &&
      error.status < 500 && error.status !== 408;
    try { finishTranscriptionRequest(current.id, requestId,
      definite ? "failed" : "uncertain", definite ? "provider_rejected" : "submission_unknown"); }
    catch { /* The reservation remains non-retryable if status cannot be saved. */ }
    if (error instanceof ElevenLabsError && error.status === 429) {
      return Response.json({ status: "failed", requestId,
        error: "Transcription provider rate limit reached." }, { status: 429, headers: privateHeaders });
    }
    return Response.json({ status: definite ? "failed" : "uncertain", requestId,
      error: definite ? "Transcription was rejected. Check the file and provider credit."
        : "The transcription result is uncertain. This request will not be sent again automatically." },
    { status: 502, headers: privateHeaders });
  } finally {
    clearInterval(heartbeat);
  }
}
