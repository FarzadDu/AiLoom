import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { getSavedModel, saveModel } from "@/server/content/preferences";

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
  let input: { modelId: string };
  try { input = z.object({ modelId: z.string().min(1).max(200) }).strict().parse(await request.json()); }
  catch { return Response.json({ error: "Invalid model." }, { status: 400 }); }
  saveModel(current.id, input.modelId === "auto" ? "openrouter/auto" : input.modelId);
  return Response.json({ modelId: input.modelId === "auto" ? "openrouter/auto" : input.modelId });
}
