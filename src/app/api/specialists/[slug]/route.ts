import { getEnabledSpecialist } from "@/server/content/specialists";

export const runtime = "nodejs";
type Context = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, context: Context) {
  const { slug } = await context.params;
  const profile = getEnabledSpecialist(slug);
  if (!profile) return Response.json({ error: "Specialist not found." }, { status: 404 });
  return Response.json({ specialist: {
    id: profile.id, slug: profile.slug, name: profile.name, domain: profile.domain,
    description: profile.description, sourceLinks: profile.sourceLinks
  } }, { headers: { "Cache-Control": "no-store" } });
}
