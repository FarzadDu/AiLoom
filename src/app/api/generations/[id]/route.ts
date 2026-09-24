import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { getGenerationJob, transitionGenerationJob } from "@/server/content/jobs";
import { publicJob } from "@/server/content/public-job";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const job = getGenerationJob(current.id, id);
  if (!job) return Response.json({ error: "Generation not found." }, { status: 404 });
  return Response.json({ job: publicJob(job) }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const { id } = await context.params;
  const job = getGenerationJob(current.id, id);
  if (!job) return Response.json({ error: "Generation not found." }, { status: 404 });
  if (job.state !== "queued") return Response.json({ error: "This generation was already submitted." }, { status: 409 });
  const cancelled = transitionGenerationJob(current.id, id, { state: "cancelled" });
  return Response.json({ job: cancelled ? publicJob(cancelled) : null });
}
