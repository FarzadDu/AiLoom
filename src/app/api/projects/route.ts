import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { createProject, listProjects } from "@/server/content/projects";
import { CONTENT_JSON_LIMIT, parseBoundedJson } from "@/server/storage/bounded-json";

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
  const input = await parseBoundedJson(request, projectInput, CONTENT_JSON_LIMIT, "Invalid project.");
  if (!input.success) return input.response;
  return Response.json({ project: createProject(current.id, input.data) }, { status: 201 });
}
