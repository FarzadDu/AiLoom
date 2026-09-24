import { getCurrentUser } from "@/server/auth/access";
import { listConversations } from "@/server/content/chat";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const records = listConversations(current.id, { limit: 50, cursor });
  return Response.json({ conversations: records }, { headers: { "Cache-Control": "no-store" } });
}
