import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { parseTranscriptionRequest, TranscriptionRequestError } from "@/server/media/transcription-request";
import { ElevenLabsError, transcribeAudio } from "@/server/providers/elevenlabs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });

  let input: Awaited<ReturnType<typeof parseTranscriptionRequest>>;
  try { input = await parseTranscriptionRequest(request); }
  catch (error) {
    if (error instanceof TranscriptionRequestError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Could not read transcription upload." }, { status: 400 });
  }
  try {
    const transcript = await transcribeAudio({ ...input, signal: request.signal });
    return Response.json(transcript, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ElevenLabsError && error.status === 429) {
      return Response.json({ error: "Transcription provider rate limit reached." }, { status: 429 });
    }
    if (error instanceof Error && error.message === "ElevenLabs is not configured.") {
      return Response.json({ error: "Transcription provider is not configured." }, { status: 503 });
    }
    return Response.json({ error: "Transcription failed. Check the file and provider credit." }, { status: 502 });
  }
}
