import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { deleteStoryboard, getStoryboard, STORYBOARD_JSON_LIMIT,
  updateStoryboard, updateStoryboardInputSchema } from "@/server/content/storyboards";
import { parseBoundedJson } from "@/server/storage/bounded-json";
import { privateJson, storyboardFailure } from "../responses";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return privateJson({ error: "Sign in required." }, 401);
  const { id } = await context.params;
  const board = getStoryboard(current.id, id);
  return board ? privateJson({ storyboard: board }) : privateJson({ error: "Storyboard not found." }, 404);
}

export async function PATCH(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return privateJson({ error: "Sign in required." }, 401);
  if (!mutationOriginAllowed(request)) return privateJson({ error: "Invalid request origin." }, 403);
  const input = await parseBoundedJson(request, updateStoryboardInputSchema, STORYBOARD_JSON_LIMIT,
    "Invalid storyboard update.");
  if (!input.success) return input.response;
  const { id } = await context.params;
  try {
    const board = updateStoryboard(current.id, id, input.data);
    return board ? privateJson({ storyboard: board }) : privateJson({ error: "Storyboard not found." }, 404);
  } catch (error) { return storyboardFailure(error); }
}

export async function DELETE(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return privateJson({ error: "Sign in required." }, 401);
  if (!mutationOriginAllowed(request)) return privateJson({ error: "Invalid request origin." }, 403);
  const { id } = await context.params;
  return deleteStoryboard(current.id, id)
    ? new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } })
    : privateJson({ error: "Storyboard not found." }, 404);
}
