import { getCurrentUser } from "@/server/auth/access";
import { listOwnedVoiceSpeech, publicVoiceSpeech } from "@/server/content/voice-clones";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  return Response.json({ speech: listOwnedVoiceSpeech(current.id)
    .map(item => publicVoiceSpeech(current.id, item)) },
  { headers: { "Cache-Control": "private, no-store" } });
}
