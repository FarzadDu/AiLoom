import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { createDataset, listOwnedDatasets } from "@/server/lora/store";
import { MAX_DATASET_BYTES, removeLoraFile, saveDatasetStream } from "@/server/lora/private-files";

export const runtime = "nodejs";
const privateJson = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "private, no-store" }
});

export async function GET(request: Request) {
  const user = await getCurrentUser(request.headers);
  if (!user) return privateJson({ error: "Sign in required." }, 401);
  return privateJson({ datasets: listOwnedDatasets(user.id).map(row => ({
    id: row.id, sizeBytes: row.sizeBytes, imageCount: row.imageCount, createdAt: row.createdAt
  })) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser(request.headers);
  if (!user) return privateJson({ error: "Sign in required." }, 401);
  if (!mutationOriginAllowed(request)) return privateJson({ error: "Invalid request origin." }, 403);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/zip" || !request.body) {
    return privateJson({ error: "Upload a ZIP file as the request body." }, 415);
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_DATASET_BYTES) return privateJson({ error: "ZIP exceeds 100 MB." }, 413);
  let stored: Awaited<ReturnType<typeof saveDatasetStream>>;
  try { stored = await saveDatasetStream(request.body); }
  catch { return privateJson({ error: "Use a ZIP up to 100 MB with 4–100 JPG, PNG or WebP images and optional text captions." }, 422); }
  try {
    const row = createDataset(user.id, stored);
    return privateJson({ dataset: { id: row.id, imageCount: row.imageCount,
      sizeBytes: row.sizeBytes, createdAt: row.createdAt } }, 201);
  } catch {
    await removeLoraFile(stored.storageKey).catch(() => undefined);
    return privateJson({ error: "Could not save private dataset." }, 500);
  }
}
