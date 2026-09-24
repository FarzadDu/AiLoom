import { z } from "zod";
import { getCurrentAdmin, mutationOriginAllowed } from "@/server/auth/access";
import { createSpecialistProfile, listSpecialistsForAdmin } from "@/server/content/specialists";
import { CONTENT_JSON_LIMIT, parseBoundedJson } from "@/server/storage/bounded-json";

export const runtime = "nodejs";

const specialistInput = z.object({
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(120),
  domain: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2_000),
  systemPrompt: z.string().trim().min(1).max(30_000),
  sourceLinks: z.array(z.url().max(2_000)).max(50),
  enabled: z.boolean().default(true)
}).strict();

export async function GET(request: Request) {
  const admin = await getCurrentAdmin(request.headers);
  if (!admin) return Response.json({ error: "Forbidden." }, { status: 403 });
  return Response.json({ specialists: listSpecialistsForAdmin(admin.id) },
    { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin(request.headers);
  if (!admin) return Response.json({ error: "Forbidden." }, { status: 403 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const input = await parseBoundedJson(request, specialistInput, CONTENT_JSON_LIMIT, "Invalid specialist.");
  if (!input.success) return input.response;
  if (listSpecialistsForAdmin(admin.id).some((item) => item.slug === input.data.slug)) {
    return Response.json({ error: "Specialist slug already exists." }, { status: 409 });
  }
  return Response.json({ specialist: createSpecialistProfile(admin.id, input.data) }, { status: 201 });
}
