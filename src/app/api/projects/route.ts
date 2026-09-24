import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { createProject, listProjects } from "@/server/content/projects";

export const runtime = "nodejs";

const projectInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).nullable().optional()
}).strict();

export async function GET(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  return Response.json({ projects: listProjects(current.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const input = projectInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Invalid project." }, { status: 400 });
  return Response.json({ project: createProject(current.id, input.data) }, { status: 201 });
}
