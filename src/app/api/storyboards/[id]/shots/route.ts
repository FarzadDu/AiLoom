import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { createShotInputSchema, createStoryboardShot, listStoryboardShots,
  STORYBOARD_JSON_LIMIT } from "@/server/content/storyboards";
import { parseBoundedJson } from "@/server/storage/bounded-json";
import { privateJson, storyboardFailure } from "../../responses";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return privateJson({ error: "Sign in required." }, 401);
  const { id } = await context.params;
  const shots = listStoryboardShots(current.id, id);
  return shots ? privateJson({ shots }) : privateJson({ error: "Storyboard not found." }, 404);
}

export async function POST(request: Request, context: Context) {
  const current = await getCurrentUser(request.headers);
  if (!current) return privateJson({ error: "Sign in required." }, 401);
  if (!mutationOriginAllowed(request)) return privateJson({ error: "Invalid request origin." }, 403);
  const input = await parseBoundedJson(request, createShotInputSchema, STORYBOARD_JSON_LIMIT, "Invalid shot.");
  if (!input.success) return input.response;
  const { id } = await context.params;
  try {
    const shot = createStoryboardShot(current.id, id, input.data);
    return shot ? privateJson({ shot }, 201) : privateJson({ error: "Storyboard not found." }, 404);
  } catch (error) { return storyboardFailure(error); }
}
