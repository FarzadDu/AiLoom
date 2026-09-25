import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { deleteConversation, getConversation, listMessages, updateConversation } from "@/server/content/chat";
import { ContentAccessError } from "@/server/content/shared";
import { CONTENT_JSON_LIMIT, parseBoundedJson } from "@/server/storage/bounded-json";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const conversation = getConversation(current.id, id);
  if (!conversation) return Response.json({ error: "Conversation not found." }, { status: 404 });
  const messages = listMessages(current.id, id, { limit: 100 }) ?? [];
  return Response.json({ conversation, messages }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const { id } = await context.params;
  const schema = z.object({ title: z.string().trim().min(1).max(160).optional(), modelId: z.string().min(1).max(200).optional(), projectId: z.uuid().nullable().optional() }).strict();
  const input = await parseBoundedJson(request, schema, CONTENT_JSON_LIMIT, "Invalid update.");
  if (!input.success) return input.response;
  let conversation;
  try { conversation = updateConversation(current.id, id, input.data); }
  catch (error) {
    if (error instanceof ContentAccessError) return Response.json({ error: "Project not found." }, { status: 404 });
    throw error;
  }
  if (!conversation) return Response.json({ error: "Conversation not found." }, { status: 404 });
  return Response.json({ conversation });
}

export async function DELETE(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const { id } = await context.params;
  if (!deleteConversation(current.id, id)) return Response.json({ error: "Conversation not found." }, { status: 404 });
  return new Response(null, { status: 204 });
}
