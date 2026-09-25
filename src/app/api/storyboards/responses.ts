import { StoryboardError } from "@/server/content/storyboards";

export function privateJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function storyboardFailure(error: unknown): Response {
  if (error instanceof StoryboardError) return privateJson({ error: error.message }, error.status);
  throw error;
}
