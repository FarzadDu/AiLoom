import { listChatModels } from "@/server/providers/openrouter";
import { listImageModels } from "@/server/providers/openrouter-image";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind") || "chat";
  if (kind !== "chat" && kind !== "image") {
    return Response.json({ error: "Unsupported model kind." }, { status: 400 });
  }
  try {
    if (kind === "image") {
      const models = await listImageModels();
      return Response.json({ defaultModelId: models[0]?.id ?? null, models }, {
        headers: { "Cache-Control": "private, max-age=300" }
      });
    }
    const models = await listChatModels();
    return Response.json({ defaultModelId: "openrouter/auto", models }, {
      headers: { "Cache-Control": "private, max-age=300" }
    });
  } catch {
    return Response.json({ error: "The model catalog is currently unavailable." }, { status: 503 });
  }
}
