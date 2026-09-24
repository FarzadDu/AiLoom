import { listEnabledSpecialists } from "@/server/content/specialists";

export const runtime = "nodejs";

function publicProfile(profile: ReturnType<typeof listEnabledSpecialists>[number]) {
  return {
    id: profile.id, slug: profile.slug, name: profile.name, domain: profile.domain,
    description: profile.description, sourceLinks: profile.sourceLinks
  };
}

export async function GET() {
  return Response.json({ specialists: listEnabledSpecialists().map(publicProfile) },
    { headers: { "Cache-Control": "no-store" } });
}
