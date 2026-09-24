import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { setExploreTemplateVisibility } from "@/server/content/templates";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const input = z.object({ visibility: z.enum(["private", "public"]) }).strict()
    .safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Invalid visibility." }, { status: 400 });
  const { id } = await context.params;
  const template = setExploreTemplateVisibility(current.id, id, input.data.visibility);
  if (!template) return Response.json({ error: "Template not found." }, { status: 404 });
  return Response.json({ id: template.id, visibility: template.visibility });
}
