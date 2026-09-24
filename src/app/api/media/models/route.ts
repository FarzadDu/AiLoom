import { listMediaModels, type MediaOperation } from "@/server/media/registry";

export const runtime = "nodejs";

export function GET(request: Request) {
  const operation = new URL(request.url).searchParams.get("operation") || undefined;
  const allowed = new Set<MediaOperation>([
    "text_to_image", "image_edit", "image_upscale", "text_to_video", "image_to_video", "reference_to_video", "temporal_inpaint", "text_to_speech", "text_to_music"
  ]);
  if (operation && !allowed.has(operation as MediaOperation)) {
    return Response.json({ error: "Unsupported media operation." }, { status: 400 });
  }
  const models = listMediaModels(operation as MediaOperation | undefined);
  return Response.json({ models }, { headers: { "Cache-Control": "public, max-age=300" } });
}
