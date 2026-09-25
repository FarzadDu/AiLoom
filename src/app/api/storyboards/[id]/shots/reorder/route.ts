import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { reorderShotsInputSchema, reorderStoryboardShots,
  STORYBOARD_JSON_LIMIT } from "@/server/content/storyboards";
import { parseBoundedJson } from "@/server/storage/bounded-json";
import { privateJson, storyboardFailure } from "../../../responses";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return privateJson({ error: "Sign in required." }, 401);
  if (!mutationOriginAllowed(request)) return privateJson({ error: "Invalid request origin." }, 403);
  const input = await parseBoundedJson(request, reorderShotsInputSchema, STORYBOARD_JSON_LIMIT,
    "Invalid shot order.");
  if (!input.success) return input.response;
  const { id } = await context.params;
  try {
    const shots = reorderStoryboardShots(current.id, id, input.data);
    return shots ? privateJson({ shots }) : privateJson({ error: "Storyboard not found." }, 404);
  } catch (error) { return storyboardFailure(error); }
}
