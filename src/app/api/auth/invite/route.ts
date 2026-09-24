import { getValidInvite } from "@/server/auth/invites";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const matchingInvite = getValidInvite(token);
  if (!matchingInvite) {
    return Response.json({ error: "Invite invalid or expired" }, {
      status: 404,
      headers: { "Cache-Control": "no-store" }
    });
  }

  return Response.json({
    email: matchingInvite.email,
    role: matchingInvite.role,
    expiresAt: matchingInvite.expiresAt.toISOString()
  }, { headers: { "Cache-Control": "no-store" } });
}
