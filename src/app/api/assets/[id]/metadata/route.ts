import { z } from "zod";
import { getCurrentUser } from "@/server/auth/access";
import { getOwnedAsset } from "@/server/content/assets";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "File not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const asset = getOwnedAsset(current.id, id);
  if (!asset) return Response.json({ error: "File not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json({ id: asset.id, visibility: asset.visibility }, { headers: { "Cache-Control": "private, no-store" } });
}
