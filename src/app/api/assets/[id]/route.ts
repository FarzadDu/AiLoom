import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { deleteAsset, getAssetForRead, getOwnedAsset, setAssetVisibility } from "@/server/content/assets";
import { deletePrivateFile, privateFileResponse } from "@/server/storage/private-files";
import { signedAssetUrl, verifyAssetAccess } from "@/server/storage/asset-access";
import { getDb } from "@/server/db";
import { asset as assetTable } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { CONTENT_JSON_LIMIT, parseBoundedJson } from "@/server/storage/bounded-json";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "File not found." }, { status: 404 });
  const url = new URL(request.url);
  const signed = verifyAssetAccess(id, url.searchParams.get("expires"), url.searchParams.get("token"));
  const asset = signed
    ? getDb().select().from(assetTable).where(eq(assetTable.id, id)).get()
    : getAssetForRead(current?.id ?? null, id);
  if (!asset) return Response.json({ error: "File not found." }, { status: 404 });
  try { return await privateFileResponse(asset.storageKey, asset.mimeType, request.headers.get("range"), asset.originalName); }
  catch { return Response.json({ error: "File unavailable." }, { status: 404 }); }
}

export async function POST(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const { id } = await context.params;
  if (!getOwnedAsset(current.id, id)) {
    return Response.json({ error: "File not found." }, { status: 404 });
  }
  try {
    const access = signedAssetUrl(id);
    const probe = await fetch(access.url, {
      headers: { Range: "bytes=0-0" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000)
    });
    await probe.body?.cancel();
    if (probe.status !== 200 && probe.status !== 206) throw new Error("Public asset unavailable");
    return Response.json(access);
  } catch {
    return Response.json({ error: "The public HTTPS site cannot serve this private reference yet." }, { status: 409 });
  }
}

export async function PATCH(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const { id } = await context.params;
  const input = await parseBoundedJson(request,
    z.object({ visibility: z.enum(["private", "public"]) }).strict(),
    CONTENT_JSON_LIMIT, "Invalid visibility.");
  if (!input.success) return input.response;
  const visibility = input.data.visibility;
  const asset = setAssetVisibility(current.id, id, visibility);
  if (!asset) return Response.json({ error: "File not found." }, { status: 404 });
  return Response.json({ id: asset.id, visibility: asset.visibility });
}

export async function DELETE(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const { id } = await context.params;
  const asset = deleteAsset(current.id, id);
  if (!asset) return Response.json({ error: "File not found." }, { status: 404 });
  await deletePrivateFile(asset.storageKey);
  return new Response(null, { status: 204 });
}
