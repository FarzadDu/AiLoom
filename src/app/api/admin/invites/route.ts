import { z } from "zod";
import { getCurrentAdmin, mutationOriginAllowed } from "@/server/auth/access";
import { createInvite, inviteUrl, listInvites } from "@/server/auth/invites";
import { CONTENT_JSON_LIMIT, parseBoundedJson } from "@/server/storage/bounded-json";

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

  const parsed = await parseBoundedJson(request, createInviteInput, CONTENT_JSON_LIMIT, "Invalid invite input");
  if (!parsed.success) {
    return parsed.response;
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
