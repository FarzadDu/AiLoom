import { readFile } from "node:fs/promises";
import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { createAsset, deleteAsset, getOwnedAsset } from "@/server/content/assets";
import { appendMessage, createConversation, getConversation } from "@/server/content/chat";
import { generateImage, type ImageReference } from "@/server/providers/openrouter-image";
import { deletePrivateFile, mediaPath, savePrivateFile } from "@/server/storage/private-files";
import { parseBoundedJson } from "@/server/storage/bounded-json";

export const runtime = "nodejs";

const schema = z.object({
  conversationId: z.string().uuid().optional(),
  prompt: z.string().trim().min(1).max(4000),
  model: z.string().trim().min(1).max(200).default("google/gemini-3.1-flash-image"),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional(),
  referenceAssetIds: z.array(z.string().uuid()).max(4).optional()
}).strict();

export async function POST(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const body = await parseBoundedJson(request, schema, 30_000, "Invalid image request.");
  if (!body.success) return body.response;
  const input = body.data;

  const existing = input.conversationId ? getConversation(current.id, input.conversationId) : null;
  if (input.conversationId && !existing) return Response.json({ error: "Conversation not found." }, { status: 404 });
  const referenceIds = input.referenceAssetIds ?? [];
  if (new Set(referenceIds).size !== referenceIds.length) return Response.json({ error: "Duplicate references." }, { status: 400 });
  const references: ImageReference[] = [];
  let bytesTotal = 0;
  try {
    for (const id of referenceIds) {
      const asset = getOwnedAsset(current.id, id);
      if (!asset || asset.kind !== "image" || !["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType)) {
        return Response.json({ error: "Invalid image reference." }, { status: 422 });
      }
      bytesTotal += asset.sizeBytes;
      if (bytesTotal > 20_000_000) return Response.json({ error: "Image references exceed 20 MB." }, { status: 413 });
      const bytes = await readFile(mediaPath(asset.storageKey));
      references.push({ type: "image_url", image_url: { url: `data:${asset.mimeType};base64,${bytes.toString("base64")}` } });
    }
  } catch { return Response.json({ error: "Could not read image references." }, { status: 422 }); }

  let result;
  try {
    result = await generateImage({
      model: input.model, prompt: input.prompt, count: 1,
      aspectRatio: input.aspectRatio, references, signal: request.signal
    });
  } catch {
    return Response.json({ error: "Image generation failed. Check the model and provider credit." }, { status: 502 });
  }
  if (!result.images.length) return Response.json({ error: "The model returned no image." }, { status: 502 });

  const saved: Array<{ id: string; storageKey: string; mimeType: string }> = [];
  try {
    for (const image of result.images) {
      const stored = await savePrivateFile(image.bytes, image.mediaType);
      try {
        const asset = createAsset(current.id, { ...stored, source: "generation" });
        saved.push({ id: asset.id, storageKey: asset.storageKey, mimeType: asset.mimeType });
      } catch (error) {
        await deletePrivateFile(stored.storageKey);
        throw error;
      }
    }
    const conversation = existing || createConversation(current.id, {
      title: input.prompt.slice(0, 90), modelId: input.model
    });
    appendMessage(current.id, conversation.id, {
      role: "user", blocks: [
        { type: "text", text: input.prompt },
        ...referenceIds.map(assetId => ({ type: "image" as const, assetId }))
      ]
    });
    const message = appendMessage(current.id, conversation.id, {
      role: "assistant", modelId: input.model,
      blocks: saved.map(asset => ({ type: "image" as const, assetId: asset.id, alt: input.prompt.slice(0, 200) }))
    });
    return Response.json({
      conversationId: conversation.id,
      message,
      assets: saved.map(asset => ({ id: asset.id, mimeType: asset.mimeType, url: `/api/assets/${asset.id}` })),
      costUsd: result.costUsd
    }, { status: 201 });
  } catch {
    for (const asset of saved) {
      deleteAsset(current.id, asset.id);
      await deletePrivateFile(asset.storageKey).catch(() => undefined);
    }
    return Response.json({ error: "Could not save the generated image." }, { status: 500 });
  }
}
