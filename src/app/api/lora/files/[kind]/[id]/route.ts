import { getCurrentUser } from "@/server/auth/access";
import { getDataset, getModel } from "@/server/lora/store";
import { loraFileResponse, verifyLoraFileUrl } from "@/server/lora/private-files";

export const runtime = "nodejs";
type Context = { params: Promise<{ kind: string; id: string }> };

export async function GET(request: Request, context: Context) {
  const { kind, id } = await context.params;
  if ((kind !== "dataset" && kind !== "weights") || !/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response(null, { status: 404 });
  }
  const row = kind === "dataset" ? getDataset(id) : getModel(id);
  if (!row || kind === "weights" && ("weightStorageKey" in row &&
      (!row.weightStorageKey || row.state !== "ready"))) {
    return new Response(null, { status: 404 });
  }
  const url = new URL(request.url);
  const signed = verifyLoraFileUrl(kind, id, url.searchParams.get("expires"), url.searchParams.get("token"));
  if (!signed) {
    const user = await getCurrentUser(request.headers);
    if (!user || user.id !== row.ownerId) return new Response(null, { status: 404 });
  }
  const storageKey = "storageKey" in row ? row.storageKey : row.weightStorageKey;
  if (!storageKey) return new Response(null, { status: 404 });
  try { return await loraFileResponse(kind, id, storageKey); }
  catch { return new Response(null, { status: 404 }); }
}
