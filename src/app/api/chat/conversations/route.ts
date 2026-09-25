import { getCurrentUser } from "@/server/auth/access";
import { listConversations } from "@/server/content/chat";
import { ContentAccessError } from "@/server/content/shared";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  const url = new URL(request.url);
  const cursorValue = url.searchParams.get("cursor");
  const projectValue = url.searchParams.get("projectId");
  const cursor = cursorValue === null ? undefined : z.uuid().safeParse(cursorValue);
  const projectId = projectValue === null ? undefined : z.uuid().safeParse(projectValue);
  if (cursor?.success === false || projectId?.success === false) {
    return Response.json({ error: "Invalid conversation filter." }, { status: 400 });
  }
  try {
    const records = listConversations(current.id, {
      limit: 50, cursor: cursor?.success ? cursor.data : undefined,
      projectId: projectId?.success ? projectId.data : undefined
    });
    return Response.json({ conversations: records }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ContentAccessError)
      return Response.json({ error: "Project or cursor is unavailable." }, { status: 404 });
    throw error;
  }
}
