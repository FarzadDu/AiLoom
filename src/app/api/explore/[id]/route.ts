import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { deleteExploreTemplate, getExploreTemplate, templateDefinitionSchema, updateExploreTemplate } from "@/server/content/templates";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

const updateInput = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2_000).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  definition: templateDefinitionSchema.optional()
}).strict().refine((value) => Object.keys(value).length > 0);

export async function GET(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  const { id } = await context.params;
  const template = getExploreTemplate(current?.id ?? null, id);
  if (!template) return Response.json({ error: "Template not found." }, { status: 404 });
  return Response.json({ template }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const input = updateInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Invalid template update." }, { status: 400 });
  const { id } = await context.params;
  const template = updateExploreTemplate(current.id, id, input.data);
  if (!template) return Response.json({ error: "Template not found." }, { status: 404 });
  return Response.json({ template });
}

export async function DELETE(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const { id } = await context.params;
  if (!deleteExploreTemplate(current.id, id)) return Response.json({ error: "Template not found." }, { status: 404 });
  return new Response(null, { status: 204 });
}
