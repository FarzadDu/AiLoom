import { z } from "zod";
import { getCurrentUser } from "@/server/auth/access";
import { getOwnedDubbingJob, publicDubbingJob } from "@/server/content/dubbing";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Dub not found." }, { status: 404 });
  const job = getOwnedDubbingJob(current.id, id);
  return job ? Response.json({ job: publicDubbingJob(current.id, job) },
    { headers: { "Cache-Control": "private, no-store" } })
    : Response.json({ error: "Dub not found." }, { status: 404 });
}
