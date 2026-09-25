import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { deleteStoryboardShot, getStoryboardShot, STORYBOARD_JSON_LIMIT,
  updateStoryboardShot, updateShotInputSchema } from "@/server/content/storyboards";
import { parseBoundedJson } from "@/server/storage/bounded-json";
import { privateJson, storyboardFailure } from "../../../responses";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; shotId: string }> };

export async function GET(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return privateJson({ error: "Sign in required." }, 401);
  const { id, shotId } = await context.params;
  const shot = getStoryboardShot(current.id, id, shotId);
  return shot ? privateJson({ shot }) : privateJson({ error: "Shot not found." }, 404);
}

export async function PATCH(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return privateJson({ error: "Sign in required." }, 401);
  if (!mutationOriginAllowed(request)) return privateJson({ error: "Invalid request origin." }, 403);
  const input = await parseBoundedJson(request, updateShotInputSchema, STORYBOARD_JSON_LIMIT,
    "Invalid shot update.");
  if (!input.success) return input.response;
  const { id, shotId } = await context.params;
  try {
    const shot = updateStoryboardShot(current.id, id, shotId, input.data);
    return shot ? privateJson({ shot }) : privateJson({ error: "Shot not found." }, 404);
  } catch (error) { return storyboardFailure(error); }
}

export async function DELETE(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return privateJson({ error: "Sign in required." }, 401);
  if (!mutationOriginAllowed(request)) return privateJson({ error: "Invalid request origin." }, 403);
  const { id, shotId } = await context.params;
  return deleteStoryboardShot(current.id, id, shotId)
    ? new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } })
    : privateJson({ error: "Shot not found." }, 404);
}
