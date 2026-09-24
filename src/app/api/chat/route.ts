import { z } from "zod";
import { getCurrentUser, mutationOriginAllowed } from "@/server/auth/access";
import { appendMessage, createConversation, getConversation, listMessages } from "@/server/content/chat";
import { getSavedModel, saveModel } from "@/server/content/preferences";
import { createChatCompletion, type ChatMessage, type ChatPart } from "@/server/providers/openrouter";
import { streamOpenRouterText } from "@/server/chat/stream";
import { getOwnedAsset } from "@/server/content/assets";
import { mediaPath } from "@/server/storage/private-files";
import { readFile } from "node:fs/promises";
import type { ContentBlock } from "@/server/content/types";
import { getEnabledSpecialist } from "@/server/content/specialists";
import { answerWithWebSearch, type WebSearchAnswer } from "@/server/chat/web-search";

export const runtime = "nodejs";

const requestSchema = z.object({
  conversationId: z.string().uuid().optional(),
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

async function messageContent(ownerId: string, blocks: ContentBlock[], budget: { remaining: number }): Promise<ChatMessage["content"]> {
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
        throw new Error("Invalid chat attachment.");
      }
      if (asset.sizeBytes > 10_000_000 || asset.sizeBytes > budget.remaining) {
        throw new Error("Chat attachments exceed the 20 MB context limit.");
      }
      const bytes = await readFile(mediaPath(asset.storageKey));
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

export async function POST(request: Request) {
  const currentUser = await getCurrentUser(request.headers);
  if (!currentUser) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });

  let parsed: z.infer<typeof requestSchema>;
  try {
    const raw = await request.text();
    if (raw.length > 100_000) return Response.json({ error: "Request too large." }, { status: 413 });
    parsed = requestSchema.parse(JSON.parse(raw));
  } catch {
    return Response.json({ error: "Invalid chat request." }, { status: 400 });
  }
  const prompt = parsed.text.trim();
  if (!prompt && !parsed.attachmentIds?.length) {
    return Response.json({ error: "Write a message or attach a file." }, { status: 400 });
  }
  const attachmentIds = parsed.attachmentIds ?? [];
  if (parsed.webSearch && (!prompt || attachmentIds.length)) {
    return Response.json({ error: "Web search needs a text message without attachments." }, { status: 422 });
  }
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
  const model = parsed.model === "auto" ? "openrouter/auto" :
    parsed.model || existing?.modelId || getSavedModel(currentUser.id) || "openrouter/auto";
  const specialist = parsed.specialistId
    ? getEnabledSpecialist(specialistSlugs[parsed.specialistId] || parsed.specialistId) : null;
  if (parsed.specialistId && !specialist) {
    return Response.json({ error: "Specialist unavailable." }, { status: 422 });
  }
  const history = existing ? (listMessages(currentUser.id, existing.id, { limit: 30 }) ?? []) : [];
  const userBlocks: ContentBlock[] = [
    ...(prompt ? [{ type: "text" as const, text: prompt }] : []),
    ...attachmentIds.map((assetId, index) => ({ type: attachments[index]?.kind === "file" ? "file" as const : "image" as const, assetId }))
  ];
  const messages: ChatMessage[] = [];
  if (specialist) messages.push({ role: "system", content: specialist.systemPrompt });
  const budget = { remaining: 20_000_000 };
  try {
    for (const item of history) {
      if (item.role !== "user" && item.role !== "assistant" && item.role !== "system") continue;
      const content = await messageContent(currentUser.id, item.blocks, budget);
      if (content) messages.push({ role: item.role, content });
    }
    messages.push({ role: "user", content: await messageContent(currentUser.id, userBlocks, budget) });
  } catch {
    return Response.json({ error: "Could not read the attachments or their combined context is too large." }, { status: 422 });
  }

  let upstream: Response | null = null;
  let webAnswer: WebSearchAnswer | null = null;
  try {
    if (parsed.webSearch) {
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
    const status = error && typeof error === "object" && "status" in error && typeof error.status === "number"
      ? error.status : 502;
    return Response.json({ error: status === 402 ? "Provider account needs credit." :
      status === 429 ? "The model is busy. Please retry shortly." : "The model could not start." },
    { status: status === 402 ? 402 : status === 429 ? 429 : 502 });
  }

  const conversation = existing || createConversation(currentUser.id, {
    title: prompt.slice(0, 90) || "Untitled conversation", modelId: model
  });
  if (!conversation) return Response.json({ error: "Could not save conversation." }, { status: 500 });
  if (specialist) appendMessage(currentUser.id, conversation.id, {
    role: "system", modelId: model, blocks: [{ type: "text", text: specialist.systemPrompt }]
  });
  const userMessage = appendMessage(currentUser.id, conversation.id, {
    role: "user", modelId: model, blocks: userBlocks
  });
  if (!userMessage) return Response.json({ error: "Could not save message." }, { status: 500 });
  saveModel(currentUser.id, model);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(event("start", { conversationId: conversation.id, messageId: userMessage.id, model }));
      let answer = "";
      try {
        if (webAnswer) {
          answer = webAnswer.answer;
          controller.enqueue(event("delta", { text: answer }));
          controller.enqueue(event("sources", { sources: webAnswer.sources }));
        } else if (upstream) {
          for await (const delta of streamOpenRouterText(upstream)) {
            answer += delta;
            controller.enqueue(event("delta", { text: delta }));
          }
        }
        const assistantMessage = appendMessage(currentUser.id, conversation.id, {
          role: "assistant", modelId: model, blocks: [
            { type: "text", text: answer },
            ...(webAnswer ? [{ type: "sources" as const, sources: webAnswer.sources }] : [])
          ]
        });
        controller.enqueue(event("done", { conversationId: conversation.id, messageId: assistantMessage?.id ?? null, model }));
      } catch {
        controller.enqueue(event("error", { message: "The response was interrupted. Please try again." }));
      } finally {
        controller.close();
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

