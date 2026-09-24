import { z } from "zod";
import { getCurrentAdmin, mutationOriginAllowed } from "@/server/auth/access";
import { createInvite, inviteUrl, listInvites } from "@/server/auth/invites";

export const runtime = "nodejs";

const createInviteInput = z.object({
  email: z.email(),
  role: z.enum(["user", "admin"]).default("user"),
  expiresInDays: z.number().int().min(1).max(30).default(7)
});

export async function GET(request: Request) {
  const admin = await getCurrentAdmin(request.headers);
  if (!admin) return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json({ invites: listInvites() }, {
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin(request.headers);
  if (!admin) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!mutationOriginAllowed(request)) {
    return Response.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const parsed = createInviteInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid invite input" }, { status: 400 });
  }

  try {
    const created = createInvite({ ...parsed.data, createdByUserId: admin.id });
    return Response.json({
      id: created.invite.id,
      email: created.invite.email,
      role: created.invite.role,
      expiresAt: created.invite.expiresAt.toISOString(),
      inviteUrl: inviteUrl(created.token)
    }, {
      status: 201,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "An account already exists for this email") {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
