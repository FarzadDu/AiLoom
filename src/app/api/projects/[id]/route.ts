import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { deleteProject, getProject, updateProject } from "@/server/content/projects";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

const updateInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2_000).nullable().optional()
}).strict().refine((value) => Object.keys(value).length > 0);

export async function GET(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const project = getProject(current.id, id);
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  return Response.json({ project }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const input = updateInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Invalid project update." }, { status: 400 });
  const { id } = await context.params;
  const project = updateProject(current.id, id, input.data);
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  return Response.json({ project });
}

export async function DELETE(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const { id } = await context.params;
  if (!deleteProject(current.id, id)) return Response.json({ error: "Project not found." }, { status: 404 });
  return new Response(null, { status: 204 });
}
