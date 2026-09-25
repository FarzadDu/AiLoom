import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { parseBoundedJson } from "@/server/storage/bounded-json";
import { getOwnedModel, listOwnedInferences, LoraRequestConflict,
  publicInference, reserveInference } from "@/server/lora/store";

export const runtime = "nodejs";
const schema = z.strictObject({
  requestId: z.uuid(), modelId: z.uuid(), prompt: z.string().trim().min(2).max(4000),
  scale: z.number().min(0).max(4).default(1),
  size: z.enum(["512*512", "768*768", "1024*1024", "768*1024", "1024*768"]).default("1024*1024")
});
const privateJson = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "private, no-store" }
});

export async function GET(request: Request) {
  const user = await getCurrentUser(request.headers);
  if (!user) return privateJson({ error: "Sign in required." }, 401);
  return privateJson({ inferences: listOwnedInferences(user.id).map(publicInference) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser(request.headers);
  if (!user) return privateJson({ error: "Sign in required." }, 401);
  if (!mutationOriginAllowed(request)) return privateJson({ error: "Invalid request origin." }, 403);
  const parsed = await parseBoundedJson(request, schema, 10_000, "Invalid LoRA image request.");
  if (!parsed.success) return parsed.response;
  const value = parsed.data;
  const model = getOwnedModel(user.id, value.modelId);
  if (!model) return privateJson({ error: "Private LoRA model not found." }, 404);
  if (model.state !== "ready" || !model.weightStorageKey) {
    return privateJson({ error: "Finish training before generating with this LoRA." }, 409);
  }
  try {
    const result = reserveInference({ ownerId: user.id, id: value.requestId.toLowerCase(),
      modelId: model.id, prompt: value.prompt, scale: Math.round(value.scale * 1000), size: value.size });
    return privateJson({ inference: publicInference(result.inference) }, result.created ? 202 : 200);
  } catch (error) {
    return error instanceof LoraRequestConflict
      ? privateJson({ error: "This request key is already used for another image." }, 409)
      : privateJson({ error: "Could not queue LoRA image generation." }, 500);
  }
}
