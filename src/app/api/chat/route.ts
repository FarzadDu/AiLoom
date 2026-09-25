import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { getConversation, getConversationSystemTexts, listMessages } from "@/server/content/chat";
import { chatTextDigest, chatTextRequestStatus, ChatTextRequestConflict,
  completeChatTextRequest, finishChatTextRequest, getOwnedChatTextRequest, reserveChatTextRequest,
  startChatTextTurn, touchChatTextRequest } from "@/server/content/chat-text-requests";
import { getSavedModel, saveModel } from "@/server/content/preferences";
import { createChatCompletion, OpenRouterError, type ChatMessage, type ChatPart } from "@/server/providers/openrouter";
import { streamOpenRouterText } from "@/server/chat/stream";
import { getOwnedAsset } from "@/server/content/assets";
import { mediaPath } from "@/server/storage/private-files";
import { readFile } from "node:fs/promises";
import type { ContentBlock } from "@/server/content/types";
import { getEnabledSpecialist } from "@/server/content/specialists";
import { answerWithWebSearch, type WebSearchAnswer } from "@/server/chat/web-search";
import { answerWithSpecialistKnowledge } from "@/server/chat/specialist-knowledge";
import { projectContextMessages } from "@/server/chat/project-context";
import { getProject } from "@/server/content/projects";
import { resolveSpecialistForTurn, specialistContextMarker, type SpecialistSlug } from "@/server/chat/specialist-context";
import { parseBoundedJson } from "@/server/storage/bounded-json";

export const runtime = "nodejs";

const requestSchema = z.object({
  requestId: z.uuid(),
  conversationId: z.string().uuid().optional(),
  projectId: z.uuid().nullable().optional(),
  text: z.string().max(40_000),
  model: z.string().min(1).max(200).optional(),
  webSearch: z.boolean().optional(),
  attachmentIds: z.array(z.string().uuid()).max(8).optional(),
  specialistId: z.enum(["general", "skin", "mental", "general-health", "skin-and-hair", "mental-wellbeing"]).optional()
}).strict();

const specialistSlugs: Record<string, string> = {
  general: "general-health", skin: "skin-and-hair", mental: "mental-wellbeing"
};

function event(name: string, payload: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
}

async function messageContent(ownerId: string, blocks: ContentBlock[], budget: { remaining: number },
  omitUnavailableAttachments = false): Promise<ChatMessage["content"]> {
  const parts: ChatPart[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      if (block.text) parts.push({ type: "text", text: block.text });
    } else if (block.type === "image" || block.type === "file") {
      const asset = getOwnedAsset(ownerId, block.assetId);
      const validImage = block.type === "image" && asset?.kind === "image" &&
        ["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType);
      const validPdf = block.type === "file" && asset?.kind === "file" && asset.mimeType === "application/pdf";
      if (!asset || (!validImage && !validPdf)) {
        if (omitUnavailableAttachments) continue;
        throw new Error("Invalid chat attachment.");
      }
      if (asset.sizeBytes > 10_000_000 || asset.sizeBytes > budget.remaining) {
        if (omitUnavailableAttachments) continue;
        throw new Error("Chat attachments exceed the 20 MB context limit.");
      }
      let bytes: Buffer;
      try { bytes = await readFile(mediaPath(asset.storageKey)); }
      catch (error) {
        if (omitUnavailableAttachments) continue;
        throw error;
      }
      if (bytes.length > 10_000_000 || bytes.length > budget.remaining) {
        if (omitUnavailableAttachments) continue;
        throw new Error("Chat attachments exceed the 20 MB context limit.");
      }
      budget.remaining -= bytes.length;
      if (validPdf) {
        parts.push({ type: "file", file: {
          filename: (asset.originalName || "document.pdf").replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 240),
          file_data: `data:application/pdf;base64,${bytes.toString("base64")}`
        } });
      } else {
        parts.push({ type: "image_url", image_url: { url: `data:${asset.mimeType};base64,${bytes.toString("base64")}` } });
      }
    }
  }
  if (parts.every(part => part.type === "text")) return parts.map(part => part.type === "text" ? part.text : "").join("\n");
  return parts;
}

function statusResponse(ownerId: string, requestId: string): Response {
  const status = chatTextRequestStatus(ownerId, requestId);
  if (!status) return Response.json({ error: "Chat request not found." }, { status: 404 });
  return Response.json(status, { status: status.status === "completed" ? 200
    : status.status === "processing" ? 202 : 409,
  headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  const currentUser = await getCurrentUser(request.headers);
  if (!currentUser) return Response.json({ error: "Sign in required." }, { status: 401 });
  const requestId = new URL(request.url).searchParams.get("requestId");
  if (!requestId || !z.uuid().safeParse(requestId).success) {
    return Response.json({ error: "A UUID request key is required." }, { status: 400 });
  }
  const status = chatTextRequestStatus(currentUser.id, requestId.toLowerCase());
  if (!status) return Response.json({ error: "Chat request not found." }, { status: 404 });
  return Response.json(status, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const currentUser = await getCurrentUser(request.headers);
  if (!currentUser) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });

  const body = await parseBoundedJson(request, requestSchema, 100_000, "Invalid chat request.");
  if (!body.success) return body.response;
  const parsed = body.data;
  const requestId = parsed.requestId.toLowerCase();
  const inputHash = chatTextDigest({
    conversationId: parsed.conversationId ?? null, projectId: parsed.projectId ?? null,
    text: parsed.text, model: parsed.model ?? null, webSearch: parsed.webSearch ?? false,
    attachmentIds: parsed.attachmentIds ?? [], specialistId: parsed.specialistId ?? null
  });
  const prior = getOwnedChatTextRequest(currentUser.id, requestId);
  if (prior) {
    if (prior.inputHash !== inputHash) {
      return Response.json({ error: "This request key was already used for another chat turn." }, { status: 409 });
    }
    return statusResponse(currentUser.id, requestId);
  }
  const prompt = parsed.text.trim();
  if (!prompt && !parsed.attachmentIds?.length) {
    return Response.json({ error: "Write a message or attach a file." }, { status: 400 });
  }
  const attachmentIds = parsed.attachmentIds ?? [];
  if (new Set(attachmentIds).size !== attachmentIds.length) {
    return Response.json({ error: "Duplicate attachments." }, { status: 400 });
  }
  const attachments = attachmentIds.map(id => getOwnedAsset(currentUser.id, id));
  if (attachments.some(asset => !asset || asset.sizeBytes > 10_000_000 || !(
    asset.kind === "image" && ["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType) ||
    asset.kind === "file" && asset.mimeType === "application/pdf"
  ))) {
    return Response.json({ error: "Attach your PNG, JPEG, WebP or PDF file under 10 MB." }, { status: 422 });
  }

  const existing = parsed.conversationId ? getConversation(currentUser.id, parsed.conversationId) : null;
  if (parsed.conversationId && !existing) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  if (existing && parsed.projectId !== undefined && parsed.projectId !== existing.projectId) {
    return Response.json({ error: "This conversation belongs to another project." }, { status: 422 });
  }
  const projectId = existing?.projectId ?? parsed.projectId ?? null;
  if (projectId && !getProject(currentUser.id, projectId)) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }
  const model = parsed.model === "auto" ? "openrouter/auto" :
    parsed.model || existing?.modelId || getSavedModel(currentUser.id) || "openrouter/auto";
  const requestedSpecialistSlug = parsed.specialistId
    ? (specialistSlugs[parsed.specialistId] || parsed.specialistId) as SpecialistSlug : null;
  const specialistContext = resolveSpecialistForTurn(Boolean(existing),
    existing ? getConversationSystemTexts(currentUser.id, existing.id) : [], requestedSpecialistSlug);
  if (specialistContext.conflict) {
    return Response.json({ error: "Start a new conversation to change specialist." }, { status: 422 });
  }
  const specialistSlug = specialistContext.slug;
  const specialist = specialistSlug ? getEnabledSpecialist(specialistSlug) : null;
  if (specialistSlug && !specialist) {
    return Response.json({ error: "Specialist unavailable." }, { status: 422 });
  }
  if (parsed.webSearch && !specialist && (!prompt || attachmentIds.length)) {
    return Response.json({ error: "Web search needs a text message without attachments." }, { status: 422 });
  }
  const history = existing ? (listMessages(currentUser.id, existing.id, { limit: 30 }) ?? []) : [];
  const userBlocks: ContentBlock[] = [
    ...(prompt ? [{ type: "text" as const, text: prompt }] : []),
    ...attachmentIds.map((assetId, index) => ({ type: attachments[index]?.kind === "file" ? "file" as const : "image" as const, assetId }))
  ];
  const messages: ChatMessage[] = projectContextMessages(currentUser.id, projectId, existing?.id);
  const budget = { remaining: 20_000_000 };
  try {
    // Reserve context for the current turn, then retain the newest historical
    // attachments that fit. Older files must not block a text-only follow-up.
    const currentContent = await messageContent(currentUser.id, userBlocks, budget);
    const historicalMessages: ChatMessage[] = [];
    for (const item of [...history].reverse()) {
      // Previous specialist prompts are audit records, not durable instructions.
      if (item.role !== "user" && item.role !== "assistant") continue;
      const content = await messageContent(currentUser.id, item.blocks, budget, true);
      if (content) historicalMessages.push({ role: item.role, content });
    }
    messages.push(...historicalMessages.reverse(), { role: "user", content: currentContent });
  } catch {
    return Response.json({ error: "Could not read the attachments or their combined context is too large." }, { status: 422 });
  }

  try {
    const reservation = reserveChatTextRequest({ ownerId: currentUser.id, requestId, inputHash });
    if (!reservation.created) return statusResponse(currentUser.id, requestId);
  } catch (error) {
    return error instanceof ChatTextRequestConflict
      ? Response.json({ error: "This request key was already used for another chat turn." }, { status: 409 })
      : Response.json({ error: "Could not reserve the chat request." }, { status: 500 });
  }

  let turn: { conversationId: string; userMessageId: string };
  try {
    turn = startChatTextTurn({ ownerId: currentUser.id, requestId,
      existingConversationId: existing?.id ?? null, projectId,
      title: prompt.slice(0, 90) || "Untitled conversation", model,
      userBlocks,
      systemText: specialist && !existing
        ? specialistContextMarker(specialist.slug as SpecialistSlug) : undefined });
    saveModel(currentUser.id, model);
  } catch {
    finishChatTextRequest(currentUser.id, requestId, "failed", "turn_not_saved");
    return Response.json({ error: "Could not save the chat turn." }, { status: 500 });
  }

  let upstream: Response | null = null;
  let webAnswer: WebSearchAnswer | null = null;
  try {
    if (specialist) {
      webAnswer = await answerWithSpecialistKnowledge({
        slug: specialist.slug, query: prompt,
        priorUserText: history.filter(item => item.role === "user")
          .map(item => item.blocks.filter(block => block.type === "text").map(block => block.text).join(" ")).slice(-1),
        systemPrompt: specialist.systemPrompt, messages, model,
        signal: request.signal, siteUrl: process.env.PUBLIC_BASE_URL
      });
    } else if (parsed.webSearch) {
      webAnswer = await answerWithWebSearch({
        query: prompt, history: messages.slice(0, -1), model,
        signal: request.signal, siteUrl: process.env.PUBLIC_BASE_URL
      });
    } else {
      upstream = await createChatCompletion({
        model, messages, stream: true, signal: request.signal,
        siteUrl: process.env.PUBLIC_BASE_URL
      });
    }
  } catch (error) {
    const definite = error instanceof OpenRouterError && error.status >= 400 &&
      error.status < 500 && error.status !== 408;
    finishChatTextRequest(currentUser.id, requestId,
      definite ? "failed" : "uncertain", definite ? "provider_rejected" : "submission_unknown");
    const status = error && typeof error === "object" && "status" in error && typeof error.status === "number"
      ? error.status : 502;
    return Response.json({ error: status === 402 ? "Provider account needs credit." :
      status === 429 ? "The model is busy. Please retry shortly." : "The model could not start." },
    { status: status === 402 ? 402 : status === 429 ? 429 : 502 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const heartbeat = setInterval(() => {
        try { touchChatTextRequest(currentUser.id, requestId); }
        catch { /* A transient SQLite lock does not authorize resubmission. */ }
      }, 30_000);
      heartbeat.unref();
      let answer = "";
      try {
        controller.enqueue(event("start", { conversationId: turn.conversationId,
          messageId: turn.userMessageId, model }));
        if (webAnswer) {
          answer = webAnswer.answer;
          controller.enqueue(event("delta", { text: answer }));
          if (webAnswer.sources.length) controller.enqueue(event("sources", { sources: webAnswer.sources }));
        } else if (upstream) {
          for await (const delta of streamOpenRouterText(upstream)) {
            answer += delta;
            controller.enqueue(event("delta", { text: delta }));
          }
        }
        const saved = completeChatTextRequest({
          ownerId: currentUser.id, requestId, model, answer,
          sources: webAnswer?.sources ?? []
        });
        controller.enqueue(event("done", { conversationId: saved.conversationId,
          messageId: saved.assistantMessageId, model }));
      } catch {
        finishChatTextRequest(currentUser.id, requestId, "uncertain", "stream_interrupted");
        try { controller.enqueue(event("error", {
          message: "The response was interrupted. Check this request before starting another turn."
        })); } catch { /* The browser may already have disconnected. */ }
      } finally {
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* The browser may already have disconnected. */ }
      }
    }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no"
    }
  });
}

