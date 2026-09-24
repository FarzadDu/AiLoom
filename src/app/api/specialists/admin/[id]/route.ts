import { z } from "zod";
import { getCurrentAdmin, mutationOriginAllowed } from "@/server/auth/access";
import { listSpecialistsForAdmin, updateSpecialistProfile } from "@/server/content/specialists";
import { CONTENT_JSON_LIMIT, parseBoundedJson } from "@/server/storage/bounded-json";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

const updateInput = z.object({
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  domain: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().min(1).max(2_000).optional(),
  systemPrompt: z.string().trim().min(1).max(30_000).optional(),
  sourceLinks: z.array(z.url().max(2_000)).max(50).optional(),
  enabled: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0);

export async function PATCH(request: Request, context: Context) {
  const admin = await getCurrentAdmin(request.headers);
  if (!admin) return Response.json({ error: "Forbidden." }, { status: 403 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const input = await parseBoundedJson(request, updateInput, CONTENT_JSON_LIMIT, "Invalid specialist update.");
  if (!input.success) return input.response;
  const { id } = await context.params;
  if (input.data.slug && listSpecialistsForAdmin(admin.id)
    .some((item) => item.id !== id && item.slug === input.data.slug)) {
    return Response.json({ error: "Specialist slug already exists." }, { status: 409 });
  }
  const specialist = updateSpecialistProfile(admin.id, id, input.data);
  if (!specialist) return Response.json({ error: "Specialist not found." }, { status: 404 });
  return Response.json({ specialist });
}
