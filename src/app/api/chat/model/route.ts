import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { getSavedModel, saveModel } from "@/server/content/preferences";
import { CONTENT_JSON_LIMIT, parseBoundedJson } from "@/server/storage/bounded-json";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  return Response.json({ modelId: getSavedModel(current.id) || "openrouter/auto" });
}

export async function PUT(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = await parseBoundedJson(request,
    z.object({ modelId: z.string().min(1).max(200) }).strict(),
    CONTENT_JSON_LIMIT, "Invalid model.");
  if (!parsed.success) return parsed.response;
  const input = parsed.data;
  saveModel(current.id, input.modelId === "auto" ? "openrouter/auto" : input.modelId);
  return Response.json({ modelId: input.modelId === "auto" ? "openrouter/auto" : input.modelId });
}
