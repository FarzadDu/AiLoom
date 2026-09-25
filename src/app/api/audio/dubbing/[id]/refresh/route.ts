import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { getOwnedDubbingJob, publicDubbingJob, reconcileUncertainDubbingJob } from "@/server/content/dubbing";
import { findDubbingProjectByReference, getDubbingProject } from "@/server/providers/elevenlabs-dubbing";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const responseHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Dub not found." }, { status: 404 });
  const job = getOwnedDubbingJob(current.id, id);
  if (!job) return Response.json({ error: "Dub not found." }, { status: 404 });
  if (job.state !== "uncertain") {
    return Response.json({ job: publicDubbingJob(current.id, job), found: Boolean(job.providerProjectId) },
      { headers: responseHeaders });
  }
  if (!process.env.ELEVENLABS_API_KEY?.trim()) {
    return Response.json({ error: "ElevenLabs is not configured." }, { status: 503 });
  }
  try {
    const projectId = await findDubbingProjectByReference({ requestId: id });
    if (!projectId) return Response.json({ job: publicDubbingJob(current.id, job), found: false },
      { headers: responseHeaders });
    const project = await getDubbingProject({ projectId });
    if (project.status === "failed") {
      const updated = reconcileUncertainDubbingJob(current.id, id, { state: "failed", projectId });
      return Response.json({ job: publicDubbingJob(current.id, updated!), found: true },
        { headers: responseHeaders });
    }
    if (project.languageIds.length !== 1) {
      return Response.json({ job: publicDubbingJob(current.id, job), found: true,
        error: "Provider project found, but the original language target could not be identified safely." },
      { status: 409, headers: responseHeaders });
    }
    const updated = reconcileUncertainDubbingJob(current.id, id, {
      state: "running", projectId, languageId: project.languageIds[0]
    });
    return Response.json({ job: publicDubbingJob(current.id, updated!), found: true },
      { headers: responseHeaders });
  } catch {
    return Response.json({ error: "Could not verify this request in ElevenLabs. It was not sent again." },
      { status: 502, headers: responseHeaders });
  }
}
