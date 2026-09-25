import { readFile } from "node:fs/promises";
import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { createAsset, deleteAsset, getOwnedAsset } from "@/server/content/assets";
import { appendMessage, createConversation, getConversation } from "@/server/content/chat";
import { chatImageDigest, ChatImageRequestConflict, finishChatImageRequest,
  getOwnedChatImageRequest, reserveChatImageRequest } from "@/server/content/chat-images";
import { getProject } from "@/server/content/projects";
import { getDb } from "@/server/db";
import { generateImage, OpenRouterImagePreflightError,
  type ImageReference } from "@/server/providers/openrouter-image";
import { OpenRouterError } from "@/server/providers/openrouter";
import { deletePrivateFile, mediaPath, savePrivateFile } from "@/server/storage/private-files";
import { parseBoundedJson } from "@/server/storage/bounded-json";

export const runtime = "nodejs";

const schema = z.strictObject({
  requestId: z.uuid(),
  conversationId: z.uuid().optional(),
  projectId: z.uuid().nullable().optional(),
  prompt: z.string().trim().min(1).max(4000),
  model: z.string().trim().min(1).max(200).default("google/gemini-3.1-flash-image"),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional(),
  referenceAssetIds: z.array(z.uuid()).max(4).optional()
});

type SavedResult = {
  conversationId: string;
  message: NonNullable<ReturnType<typeof appendMessage>>;
  assets: Array<{ id: string; mimeType: string; url: string }>;
  costUsd: number | null;
};

function reply(value: unknown, status: number): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

function requestResponse(ownerId: string, requestId: string): Response {
  const row = getOwnedChatImageRequest(ownerId, requestId);
  if (!row) return reply({ error: "Image request not found." }, 404);
  if (row.state === "submitting") return reply({ status: "processing", requestId }, 202);
  if (row.state === "uncertain") return reply({ status: "uncertain", requestId,
    error: "The provider outcome is uncertain. This request will not be sent again automatically." }, 409);
  if (row.state === "failed") return reply({ status: "failed", requestId,
    error: "The image request failed. Use a new request key only if you choose to try again." }, 409);
  let result: SavedResult;
  try { result = JSON.parse(row.responseJson || "") as SavedResult; }
  catch { return reply({ error: "Saved image response is unavailable." }, 500); }
  if (!result || !z.uuid().safeParse(result.conversationId).success ||
      !getConversation(ownerId, result.conversationId) || !Array.isArray(result.assets) ||
      result.assets.some(item => !item || !z.uuid().safeParse(item.id).success ||
        !getOwnedAsset(ownerId, item.id))) {
    return reply({ error: "The completed image is no longer available." }, 410);
  }
  return reply(result, 200);
}

/** Poll or recover a stable request after the browser loses its POST response. */
export async function GET(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return reply({ error: "Sign in required." }, 401);
  const requestId = new URL(request.url).searchParams.get("requestId");
  if (!requestId || !z.uuid().safeParse(requestId).success) {
    return reply({ error: "A UUID request key is required." }, 400);
  }
  return requestResponse(current.id, requestId.toLowerCase());
}

export async function POST(request: Request) {
  const current = await getCurrentUser(request.headers);
  if (!current) return reply({ error: "Sign in required." }, 401);
  if (!mutationOriginAllowed(request)) return reply({ error: "Invalid request origin." }, 403);
  const body = await parseBoundedJson(request, schema, 30_000, "Invalid image request.");
  if (!body.success) return body.response;
  const input = body.data;
  const requestId = input.requestId.toLowerCase();
  const existing = input.conversationId ? getConversation(current.id, input.conversationId) : null;
  if (input.conversationId && !existing) return reply({ error: "Conversation not found." }, 404);
  if (existing && input.projectId !== undefined && input.projectId !== existing.projectId) {
    return reply({ error: "This conversation belongs to another project." }, 409);
  }
  if (!existing && input.projectId && !getProject(current.id, input.projectId)) {
    return reply({ error: "Project not found." }, 404);
  }
  const referenceIds = input.referenceAssetIds ?? [];
  if (new Set(referenceIds).size !== referenceIds.length) return reply({ error: "Duplicate references." }, 400);
  const digest = chatImageDigest({ conversationId: input.conversationId ?? null,
    projectId: existing?.projectId ?? input.projectId ?? null,
    prompt: input.prompt, model: input.model, aspectRatio: input.aspectRatio ?? null,
    referenceAssetIds: referenceIds });

  try {
    const reservation = reserveChatImageRequest({ ownerId: current.id, requestId, inputHash: digest });
    if (!reservation.created) return requestResponse(current.id, requestId);
  } catch (error) {
    return error instanceof ChatImageRequestConflict
      ? reply({ error: "This request key was already used for a different image." }, 409)
      : reply({ error: "Could not reserve the image request." }, 500);
  }

  const references: ImageReference[] = [];
  let bytesTotal = 0;
  try {
    for (const id of referenceIds) {
      const asset = getOwnedAsset(current.id, id);
      if (!asset || asset.kind !== "image" || !["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType)) {
        finishChatImageRequest(current.id, requestId, { state: "failed", errorCode: "invalid_reference" });
        return reply({ status: "failed", error: "Invalid image reference." }, 422);
      }
      bytesTotal += asset.sizeBytes;
      if (bytesTotal > 20_000_000) {
        finishChatImageRequest(current.id, requestId, { state: "failed", errorCode: "reference_too_large" });
        return reply({ status: "failed", error: "Image references exceed 20 MB." }, 413);
      }
      const bytes = await readFile(mediaPath(asset.storageKey));
      references.push({ type: "image_url", image_url: { url: `data:${asset.mimeType};base64,${bytes.toString("base64")}` } });
    }
  } catch {
    finishChatImageRequest(current.id, requestId, { state: "failed", errorCode: "reference_unavailable" });
    return reply({ status: "failed", error: "Could not read image references." }, 422);
  }

  let result;
  try {
    result = await generateImage({ model: input.model, prompt: input.prompt, count: 1,
      aspectRatio: input.aspectRatio, references, signal: request.signal });
  } catch (error) {
    const preflightFailed = error instanceof OpenRouterImagePreflightError;
    const definite = preflightFailed || error instanceof OpenRouterError && error.status >= 400 &&
      error.status < 500 && error.status !== 408;
    finishChatImageRequest(current.id, requestId, { state: definite ? "failed" : "uncertain",
      errorCode: preflightFailed ? "model_check_failed" : definite ? "provider_rejected" : "submission_unknown" });
    return reply({ status: definite ? "failed" : "uncertain", requestId,
      error: preflightFailed ? "Could not check the image model. Use a new request key to try again."
        : definite ? "Image generation was rejected. Check the model and provider credit."
        : "The provider outcome is uncertain. This request will not be sent again automatically." },
    definite ? 422 : 502);
  }
  if (!result.images.length) {
    finishChatImageRequest(current.id, requestId, { state: "uncertain", errorCode: "empty_provider_output" });
    return reply({ status: "uncertain", requestId,
      error: "The provider returned no image. This request will not be sent again automatically." }, 502);
  }

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
    const response = getDb().transaction((): SavedResult => {
      const conversation = existing || createConversation(current.id, {
        title: input.prompt.slice(0, 90), modelId: input.model,
        projectId: input.projectId ?? null
      });
      const userMessage = appendMessage(current.id, conversation.id, {
        role: "user", blocks: [
          { type: "text", text: input.prompt },
          ...referenceIds.map(assetId => ({ type: "image" as const, assetId }))
        ]
      });
      const message = appendMessage(current.id, conversation.id, {
        role: "assistant", modelId: input.model,
        blocks: saved.map(asset => ({ type: "image" as const, assetId: asset.id,
          alt: input.prompt.slice(0, 200) }))
      });
      if (!userMessage || !message) throw new Error("Could not save chat messages.");
      const completed: SavedResult = { conversationId: conversation.id, message,
        assets: saved.map(asset => ({ id: asset.id, mimeType: asset.mimeType,
          url: `/api/assets/${asset.id}` })), costUsd: result.costUsd };
      if (!finishChatImageRequest(current.id, requestId, {
        state: "succeeded", responseJson: JSON.stringify(completed)
      })) throw new Error("Image request changed while saving.");
      return completed;
    });
    return reply(response, 201);
  } catch {
    for (const asset of saved) {
      try {
        if (deleteAsset(current.id, asset.id)) {
          await deletePrivateFile(asset.storageKey).catch(() => undefined);
        }
      } catch { /* Keep the private file if its database row could not be removed. */ }
    }
    try { finishChatImageRequest(current.id, requestId, { state: "uncertain", errorCode: "result_not_saved" }); }
    catch { /* A stale reservation remains non-retryable if the database is unavailable. */ }
    return reply({ status: "uncertain", requestId,
      error: "The generated image could not be saved. This request will not be sent again automatically." }, 500);
  }
}
