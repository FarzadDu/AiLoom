import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { parseBoundedJson } from "@/server/storage/bounded-json";
import { getOwnedDataset, listOwnedModels, LoraRequestConflict,
  publicModel, reserveTraining } from "@/server/lora/store";

export const runtime = "nodejs";
const schema = z.strictObject({
  requestId: z.uuid(), datasetId: z.uuid(), name: z.string().trim().min(2).max(80),
  triggerWord: z.string().trim().max(80).optional(),
  steps: z.number().int().min(500).max(10_000).default(1000),
  rank: z.number().int().min(1).max(64).default(16)
});
const privateJson = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "private, no-store" }
});

export async function GET(request: Request) {
  const user = await getCurrentUser(request.headers);
  if (!user) return privateJson({ error: "Sign in required." }, 401);
  return privateJson({ models: listOwnedModels(user.id).map(publicModel) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser(request.headers);
  if (!user) return privateJson({ error: "Sign in required." }, 401);
  if (!mutationOriginAllowed(request)) return privateJson({ error: "Invalid request origin." }, 403);
  const parsed = await parseBoundedJson(request, schema, 10_000, "Invalid LoRA training request.");
  if (!parsed.success) return parsed.response;
  const value = parsed.data;
  if (!getOwnedDataset(user.id, value.datasetId)) return privateJson({ error: "Training dataset not found." }, 404);
  try {
    const result = reserveTraining({ ownerId: user.id, id: value.requestId.toLowerCase(),
      datasetId: value.datasetId, name: value.name, triggerWord: value.triggerWord || null,
      steps: value.steps, rank: value.rank });
    return privateJson({ model: publicModel(result.model) }, result.created ? 202 : 200);
  } catch (error) {
    return error instanceof LoraRequestConflict
      ? privateJson({ error: "This request key is already used for another LoRA training." }, 409)
      : privateJson({ error: "Could not queue LoRA training." }, 500);
  }
}
