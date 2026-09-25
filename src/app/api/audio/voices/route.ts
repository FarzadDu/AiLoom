import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { listOwnedVoiceClones, publicVoiceClone, reserveVoiceClone, sampleDigest,
  finishVoiceClone, VoiceRequestConflictError } from "@/server/content/voice-clones";
import { createInstantVoice, ElevenLabsError } from "@/server/providers/elevenlabs";
import { MultipartBodyError, readBoundedMultipartForm } from "@/server/storage/bounded-form";
import { inspectFile } from "@/server/storage/private-files";

export const runtime = "nodejs";

const MAX_SAMPLE_BYTES = 20_000_000;
const acceptedMime = new Map<string, "audio/mpeg" | "audio/wav" | "audio/ogg">([
  ["audio/mpeg", "audio/mpeg"], ["audio/mp3", "audio/mpeg"],
  ["audio/wav", "audio/wav"], ["audio/x-wav", "audio/wav"],
  ["audio/ogg", "audio/ogg"]
]);
const responseHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  return Response.json({ voices: listOwnedVoiceClones(current.id).map(publicVoiceClone) },
    { headers: responseHeaders });
}

export async function POST(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const requestId = request.headers.get("Idempotency-Key");
  if (!requestId || !z.uuid().safeParse(requestId).success) {
    return Response.json({ error: "A valid request key is required." }, { status: 400 });
  }
  if (!process.env.ELEVENLABS_API_KEY?.trim()) {
    return Response.json({ error: "ElevenLabs is not configured." }, { status: 503 });
  }
  let form: FormData;
  try { form = await readBoundedMultipartForm(request, MAX_SAMPLE_BYTES + 200_000); }
  catch (error) {
    if (error instanceof MultipartBodyError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Invalid voice sample upload." }, { status: 400 });
  }
  if ([...form.keys()].some(key => !["name", "file", "consent"].includes(key)) ||
    form.getAll("name").length !== 1 || form.getAll("file").length !== 1 ||
    form.getAll("consent").length !== 1) {
    return Response.json({ error: "Choose one voice sample and provide a name and consent." }, { status: 400 });
  }
  const rawName = form.get("name");
  const file = form.get("file");
  if (typeof rawName !== "string" || !(file instanceof File) || form.get("consent") !== "true") {
    return Response.json({ error: "Confirm that you own this voice or have the speaker's permission." }, { status: 400 });
  }
  const name = rawName.trim();
  if (name.length < 2 || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) {
    return Response.json({ error: "Use a voice name between 2 and 80 characters." }, { status: 400 });
  }
  if (file.size < 1 || file.size > MAX_SAMPLE_BYTES) {
    return Response.json({ error: "Use one audio sample up to 20 MB." }, { status: 413 });
  }
  const mimeType = acceptedMime.get(file.type.toLowerCase().split(";", 1)[0].trim());
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!mimeType || !inspectFile(bytes, mimeType)) {
    return Response.json({ error: "Use a valid MP3, WAV or OGG recording." }, { status: 415 });
  }
  let reserved;
  try {
    reserved = reserveVoiceClone({ ownerId: current.id, requestId, name,
      sampleHash: sampleDigest(bytes), sampleMimeType: mimeType, sampleSizeBytes: bytes.length });
  } catch (error) {
    if (error instanceof VoiceRequestConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return Response.json({ error: "Could not save the voice request." }, { status: 500 });
  }
  if (!reserved.created) {
    return Response.json({ voice: publicVoiceClone(reserved.voice) },
      { status: reserved.voice.state === "ready" ? 200 : 202, headers: responseHeaders });
  }
  try {
    // The request ID is persisted before the provider POST. ElevenLabs offers no
    // documented idempotency key here; uncertain outcomes stay blocked.
    const created = await createInstantVoice({ name: reserved.voice.providerName,
      bytes, filename: (file.name || "sample.mp3").replace(/[\\/\r\n\x00-\x1f]/g, "_").slice(0, 120),
      mimeType, signal: AbortSignal.timeout(60_000) });
    const voice = finishVoiceClone(current.id, requestId,
      created.requiresVerification ? "verification_required" : "ready", created.voiceId);
    if (!voice) throw new Error("Voice record disappeared.");
    return Response.json({ voice: publicVoiceClone(voice) },
      { status: 201, headers: responseHeaders });
  } catch (error) {
    const deterministic = error instanceof ElevenLabsError && error.status >= 400 && error.status < 500;
    const voice = finishVoiceClone(current.id, requestId, deterministic ? "failed" : "uncertain");
    return Response.json({ voice: voice ? publicVoiceClone(voice) : null,
      error: deterministic ? "ElevenLabs rejected the voice sample or account request."
        : "The provider outcome is uncertain. This request will not be sent again automatically." },
    { status: deterministic ? 422 : 502, headers: responseHeaders });
  }
}
