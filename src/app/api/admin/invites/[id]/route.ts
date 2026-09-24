import { z } from "zod";
import { getCurrentAdmin, mutationOriginAllowed } from "@/server/auth/access";
import { revokeInvite } from "@/server/auth/invites";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await getCurrentAdmin(request.headers);
  if (!admin) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!mutationOriginAllowed(request)) {
    return Response.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid invite id" }, { status: 400 });
  }

  if (!revokeInvite(id)) {
    return Response.json({ error: "Invite not found or already used" }, { status: 404 });
  }
  return Response.json({ revoked: true }, { headers: { "Cache-Control": "no-store" } });
}
