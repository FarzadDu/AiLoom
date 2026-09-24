import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { createAsset, listAssets } from "@/server/content/assets";
import { deletePrivateFile, savePrivateFile } from "@/server/storage/private-files";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind && !["image", "video", "audio", "file"].includes(kind)) {
    return Response.json({ error: "Invalid file kind." }, { status: 400 });
  }
  const assets = listAssets(current.id, { kind: kind as "image" | "video" | "audio" | "file" | undefined });
  return Response.json({ assets: assets.map(asset => ({
    id: asset.id, kind: asset.kind, source: asset.source, visibility: asset.visibility,
    mimeType: asset.mimeType, originalName: asset.originalName, sizeBytes: asset.sizeBytes,
    createdAt: asset.createdAt, url: `/api/assets/${asset.id}`
  })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 100_000_000) return Response.json({ error: "File is too large." }, { status: 413 });
  let file: File;
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (!(value instanceof File)) throw new Error("Missing file");
    file = value;
  } catch {
    return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  }
  if (file.size === 0 || file.size > 100_000_000) {
    return Response.json({ error: "File size must be between 1 byte and 100 MB." }, { status: 413 });
  }
  let stored: Awaited<ReturnType<typeof savePrivateFile>>;
  try { stored = await savePrivateFile(Buffer.from(await file.arrayBuffer()), file.type); }
  catch { return Response.json({ error: "Unsupported or invalid file format." }, { status: 415 }); }
  try {
    const asset = createAsset(current.id, { ...stored, source: "upload", originalName: file.name.slice(0, 240) });
    return Response.json({ asset: { id: asset.id, kind: asset.kind, mimeType: asset.mimeType, originalName: asset.originalName,
      sizeBytes: asset.sizeBytes, visibility: asset.visibility, url: `/api/assets/${asset.id}` } }, { status: 201 });
  } catch {
    await deletePrivateFile(stored.storageKey);
    return Response.json({ error: "Could not save file." }, { status: 500 });
  }
}
