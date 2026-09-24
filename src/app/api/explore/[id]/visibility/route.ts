import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { setExploreTemplateVisibility } from "@/server/content/templates";
import { CONTENT_JSON_LIMIT, parseBoundedJson } from "@/server/storage/bounded-json";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const input = await parseBoundedJson(request,
    z.object({ visibility: z.enum(["private", "public"]) }).strict(),
    CONTENT_JSON_LIMIT, "Invalid visibility.");
  if (!input.success) return input.response;
  const { id } = await context.params;
  const template = setExploreTemplateVisibility(current.id, id, input.data.visibility);
  if (!template) return Response.json({ error: "Template not found." }, { status: 404 });
  return Response.json({ id: template.id, visibility: template.visibility });
}
