import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { createStoryboard, createStoryboardInputSchema, listStoryboards,
  STORYBOARD_JSON_LIMIT } from "@/server/content/storyboards";
import { parseBoundedJson } from "@/server/storage/bounded-json";
import { privateJson, storyboardFailure } from "./responses";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return privateJson({ error: "Sign in required." }, 401);
  const query = z.coerce.number().int().min(1).max(200).safeParse(new URL(request.url).searchParams.get("limit") || 100);
  if (!query.success) return privateJson({ error: "Invalid limit." }, 400);
  return privateJson({ storyboards: listStoryboards(current.id, query.data) });
}

export async function POST(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return privateJson({ error: "Sign in required." }, 401);
  if (!mutationOriginAllowed(request)) return privateJson({ error: "Invalid request origin." }, 403);
  const input = await parseBoundedJson(request, createStoryboardInputSchema, STORYBOARD_JSON_LIMIT,
    "Invalid storyboard.");
  if (!input.success) return input.response;
  try { return privateJson({ storyboard: createStoryboard(current.id, input.data) }, 201); }
  catch (error) { return storyboardFailure(error); }
}
