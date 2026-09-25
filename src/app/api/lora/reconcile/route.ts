import { z } from "zod";
import { getCurrentAdmin, mutationOriginAllowed } from "@/server/auth/access";
import { parseBoundedJson } from "@/server/storage/bounded-json";
import { getWaveSpeedTask } from "@/server/providers/wavespeed";
import { attachInferencePrediction, attachTrainingPrediction, getOwnedInference,
  getOwnedModel, publicInference, publicModel } from "@/server/lora/store";
import { INFERENCE_MODEL, TRAINER_MODEL } from "@/server/lora/worker";

export const runtime = "nodejs";
const schema = z.strictObject({ kind: z.enum(["training", "inference"]),
  id: z.uuid(), predictionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) });
const privateJson = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "private, no-store" }
});

/** Admin-only read-only reconciliation; this route never submits a paid task. */
export async function POST(request: Request) {
  const admin = await getCurrentAdmin(request.headers);
  if (!admin) return privateJson({ error: "Admin sign-in required." }, 403);
  if (!mutationOriginAllowed(request)) return privateJson({ error: "Invalid request origin." }, 403);
  const parsed = await parseBoundedJson(request, schema, 10_000, "Invalid reconciliation request.");
  if (!parsed.success) return parsed.response;
  const { kind, id, predictionId } = parsed.data;
  const row = kind === "training" ? getOwnedModel(admin.id, id) : getOwnedInference(admin.id, id);
  if (!row) return privateJson({ error: "Private LoRA request not found." }, 404);
  if (row.state !== "uncertain" || row.providerTaskId) {
    return privateJson({ error: "Only a submission with an unknown outcome can be reconciled." }, 409);
  }
  try {
    const provider = await getWaveSpeedTask({ predictionId });
    if (provider.model !== (kind === "training" ? TRAINER_MODEL : INFERENCE_MODEL)) {
      return privateJson({ error: "Prediction model does not match this request." }, 409);
    }
    const result = kind === "training"
      ? attachTrainingPrediction(admin.id, id, predictionId)
      : attachInferencePrediction(admin.id, id, predictionId);
    return privateJson({ request: result && (kind === "training"
      ? publicModel(result as NonNullable<ReturnType<typeof getOwnedModel>>)
      : publicInference(result as NonNullable<ReturnType<typeof getOwnedInference>>)) });
  } catch { return privateJson({ error: "Could not verify this prediction with WaveSpeed." }, 502); }
}
