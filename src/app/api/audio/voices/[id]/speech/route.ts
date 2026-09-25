import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { createAsset, deleteAsset } from "@/server/content/assets";
import { finishVoiceSpeech, getOwnedVoiceClone, publicVoiceSpeech, reserveVoiceSpeech,
  speechDigest, VoiceRequestConflictError } from "@/server/content/voice-clones";
import { ElevenLabsError, synthesizeSpeech } from "@/server/providers/elevenlabs";
import { parseBoundedJson } from "@/server/storage/bounded-json";
import { deletePrivateFile, inspectFile, savePrivateFile } from "@/server/storage/private-files";

export const runtime = "nodejs";

const requestSchema = z.strictObject({ text: z.string().trim().min(1).max(5000) });
const responseHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid voice ID." }, { status: 400 });
  const requestId = request.headers.get("Idempotency-Key");
  if (!requestId || !z.uuid().safeParse(requestId).success) {
    return Response.json({ error: "A valid request key is required." }, { status: 400 });
  }
  const parsed = await parseBoundedJson(request, requestSchema, 12_000, "Invalid speech request.");
  if (!parsed.success) return parsed.response;
  const clone = getOwnedVoiceClone(current.id, id);
  if (!clone) return Response.json({ error: "Voice not found." }, { status: 404 });
  if (clone.state !== "ready" || !clone.providerVoiceId) {
    return Response.json({ error: "This voice is not ready for speech." }, { status: 409 });
  }
  if (!process.env.ELEVENLABS_API_KEY?.trim()) {
    return Response.json({ error: "ElevenLabs is not configured." }, { status: 503 });
  }
  let reserved;
  try {
    reserved = reserveVoiceSpeech({ ownerId: current.id, requestId, cloneId: id,
      inputHash: speechDigest(id, parsed.data.text) });
  } catch (error) {
    if (error instanceof VoiceRequestConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return Response.json({ error: "Could not save the speech request." }, { status: 500 });
  }
  if (!reserved.created) {
    return Response.json({ speech: publicVoiceSpeech(current.id, reserved.speech) },
      { status: reserved.speech.state === "ready" ? 200 : 202, headers: responseHeaders });
  }
  let saved: Awaited<ReturnType<typeof savePrivateFile>> | null = null;
  let assetId: string | null = null;
  try {
    const bytes = await synthesizeSpeech({ text: parsed.data.text,
      voiceId: clone.providerVoiceId, modelId: "eleven_v3", signal: AbortSignal.timeout(60_000) });
    if (!bytes.length || !inspectFile(bytes, "audio/mpeg")) {
      throw new Error("Invalid provider audio.");
    }
    saved = await savePrivateFile(bytes, "audio/mpeg");
    const asset = createAsset(current.id, { ...saved, source: "generation",
      originalName: `ailoom-voice-${requestId.slice(0, 8)}.mp3` });
    assetId = asset.id;
    const speech = finishVoiceSpeech(current.id, requestId, "ready", asset.id);
    if (!speech) throw new Error("Speech record disappeared.");
    return Response.json({ speech: publicVoiceSpeech(current.id, speech) },
      { status: 201, headers: responseHeaders });
  } catch (error) {
    // The provider may have charged before a network or local storage failure.
    // Keep the same request key blocked to avoid an accidental second charge.
    if (assetId) deleteAsset(current.id, assetId);
    if (saved) await deletePrivateFile(saved.storageKey).catch(() => undefined);
    const deterministic = error instanceof ElevenLabsError && error.status >= 400 && error.status < 500;
    const speech = finishVoiceSpeech(current.id, requestId, deterministic ? "failed" : "uncertain");
    return Response.json({ speech: speech ? publicVoiceSpeech(current.id, speech) : null,
      error: deterministic ? "ElevenLabs rejected the speech request or account."
        : "The provider outcome is uncertain. This request will not be sent again automatically." },
    { status: deterministic ? 422 : 502, headers: responseHeaders });
  }
}
