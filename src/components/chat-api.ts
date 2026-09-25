export type SessionUser = { id: string; name?: string; email: string; role?: string };
export type ConversationSummary = { id: string; title: string; projectId: string | null; updatedAt?: string };
export type ChatProject = { id: string; name: string; description: string | null; updatedAt?: string };
export type ChatSource = { url: string; title: string };
export type MessageBlock = { type: "text" | "image" | "video" | "audio" | "file" | "sources"; text?: string; assetId?: string; alt?: string; url?: string; sources?: ChatSource[] };
export type ChatMessage = { id: string; role: "user" | "assistant"; text: string; blocks?: MessageBlock[]; status?: "streaming" | "error" };
export type ChatModel = { id: string; name: string; description?: string };

export type StreamEvent =
  | { type: "start"; conversationId: string; messageId: string }
  | { type: "delta"; text: string }
  | { type: "sources"; sources: ChatSource[] }
  | { type: "done"; messageId: string; model?: string }
  | { type: "error"; message: string };

type AnyRecord = Record<string, unknown>;
const record = (value: unknown): AnyRecord | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : null;
const string = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;

function sourcesFromPayload(payload: unknown): ChatSource[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap(item => {
    const entry = record(item);
    const url = string(entry?.url);
    if (!url || !/^https:\/\//i.test(url)) return [];
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return [];
      return [{ url: parsed.href, title: string(entry?.title)?.trim() || parsed.hostname }];
    } catch { return []; }
  }).slice(0, 20);
}

export async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  const object = record(body);
  return string(object?.message) ?? string(object?.error) ?? string(record(object?.error)?.message) ?? `Request failed (${response.status})`;
}

export function sessionUserFromPayload(payload: unknown): SessionUser | null {
  const root = record(payload);
  const value = record(root?.user);
  const id = string(value?.id);
  const email = string(value?.email);
  if (!id || !email) return null;
  return { id, email, name: string(value?.name), role: string(value?.role) };
}

export function conversationsFromPayload(payload: unknown): ConversationSummary[] {
  const root = record(payload);
  const candidates = Array.isArray(payload) ? payload : root?.conversations ?? root?.items ?? record(root?.data)?.conversations;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap(item => {
    const entry = record(item);
    const id = string(entry?.id);
    if (!id) return [];
    return [{ id, title: string(entry?.title) || "Untitled conversation",
      projectId: string(entry?.projectId) ?? null, updatedAt: string(entry?.updatedAt) }];
  });
}

export function projectsFromPayload(payload: unknown): ChatProject[] {
  const root = record(payload);
  const candidates = Array.isArray(payload) ? payload : root?.projects;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap(item => {
    const entry = record(item);
    const id = string(entry?.id);
    const name = string(entry?.name);
    if (!id || !name) return [];
    return [{ id, name, description: string(entry?.description) ?? null,
      updatedAt: string(entry?.updatedAt) }];
  });
}

export function messagesFromPayload(payload: unknown): ChatMessage[] {
  const root = record(payload);
  const candidates = Array.isArray(payload) ? payload : root?.messages ?? record(root?.conversation)?.messages ?? record(root?.data)?.messages;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap(item => {
    const entry = record(item);
    const role = string(entry?.role);
    const id = string(entry?.id);
    if (!id || (role !== "user" && role !== "assistant")) return [];
    const blocks: MessageBlock[] = [];
    if (Array.isArray(entry?.blocks)) {
      for (const block of entry.blocks) {
        const part = record(block);
        const type = string(part?.type);
        const partText = string(part?.text);
        const assetId = string(part?.assetId);
        if (type === "text" && partText) blocks.push({ type, text: partText });
        else if ((type === "image" || type === "video" || type === "audio" || type === "file") && assetId) {
          blocks.push({ type, assetId, alt: string(part?.alt) });
        }
        else if (type === "sources") blocks.push({ type, sources: sourcesFromPayload(part?.sources) });
      }
    }
    const text = string(entry?.text) ?? string(entry?.content) ?? blocks.filter(block => block.type === "text").map(block => block.text).join("\n") ?? "";
    return [{ id, role, text, blocks }];
  });
}

export function modelsFromPayload(payload: unknown): { defaultModelId: string; models: ChatModel[] } {
  const root = record(payload);
  const candidates = root?.models;
  const models: ChatModel[] = Array.isArray(candidates) ? candidates.flatMap(item => {
    const entry = record(item);
    const id = string(entry?.id);
    if (!id) return [];
    return [{ id, name: string(entry?.name) ?? id, description: string(entry?.description) }];
  }) : [];
  return { defaultModelId: string(root?.defaultModelId) ?? "openrouter/auto", models };
}

function parseEvent(frame: string): StreamEvent | null {
  const lines = frame.split(/\r?\n/);
  const eventName = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
  const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
  if (!data || data === "[DONE]") return null;
  let payload: AnyRecord | null;
  try { payload = record(JSON.parse(data)); } catch { return null; }
  if (!payload) return null;
  if (eventName === "start") return { type: "start", conversationId: string(payload.conversationId) ?? "", messageId: string(payload.messageId) ?? "" };
  if (eventName === "delta") return { type: "delta", text: string(payload.text) ?? "" };
  if (eventName === "sources") return { type: "sources", sources: sourcesFromPayload(payload.sources) };
  if (eventName === "done") return { type: "done", messageId: string(payload.messageId) ?? "", model: string(payload.model) };
  if (eventName === "error") return { type: "error", message: string(payload.message) ?? "Chat request failed" };
  return null;
}

export async function readChatStream(response: Response, onEvent: (event: StreamEvent) => void) {
  if (!response.ok) throw new Error(await responseError(response));
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty chat response");
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, "\n");
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const event = parseEvent(frame);
        if (!event) continue;
        onEvent(event);
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "done") completed = true;
      }
      if (done) break;
    }
    const remaining = parseEvent(buffer);
    if (remaining) {
      onEvent(remaining);
      if (remaining.type === "error") throw new Error(remaining.message);
      if (remaining.type === "done") completed = true;
    }
  } finally {
    reader.releaseLock();
  }
  if (!completed) throw new Error("Chat stream ended before completion");
}
