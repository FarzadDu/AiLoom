import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { getOwnedVoiceClone, publicVoiceClone, reconcileVoiceClone } from "@/server/content/voice-clones";
import { findInstantVoiceByExactName, getInstantVoiceVerification } from "@/server/providers/elevenlabs";

export const runtime = "nodejs";

const responseHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid voice ID." }, { status: 400 });
  const voice = getOwnedVoiceClone(current.id, id);
  if (!voice) return Response.json({ error: "Voice not found." }, { status: 404 });
  if (voice.state === "ready") {
    return Response.json({ voice: publicVoiceClone(voice), matched: true }, { headers: responseHeaders });
  }
  if (voice.state !== "uncertain" && voice.state !== "verification_required") {
    return Response.json({ error: "This voice cannot be refreshed yet." }, { status: 409 });
  }
  if (!process.env.ELEVENLABS_API_KEY?.trim()) {
    return Response.json({ error: "ElevenLabs is not configured." }, { status: 503 });
  }
  try {
    const providerVoiceId = voice.providerVoiceId ?? await findInstantVoiceByExactName({
      name: voice.providerName, signal: AbortSignal.timeout(15_000)
    });
    if (!providerVoiceId) {
      return Response.json({ voice: publicVoiceClone(voice), matched: false }, { headers: responseHeaders });
    }
    const status = await getInstantVoiceVerification({
      voiceId: providerVoiceId, signal: AbortSignal.timeout(15_000)
    });
    const updated = reconcileVoiceClone(current.id, voice.id, providerVoiceId,
      status === "unknown" ? "uncertain" : status);
    if (!updated) return Response.json({ error: "Voice not found." }, { status: 404 });
    return Response.json({ voice: publicVoiceClone(updated), matched: true }, { headers: responseHeaders });
  } catch {
    return Response.json({ error: "Could not check this voice in ElevenLabs. Try again later." },
      { status: 502, headers: responseHeaders });
  }
}
