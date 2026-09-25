export type ChatTurnInput = {
  conversationId?: string;
  projectId?: string | null;
  text: string;
  model: string;
  webSearch: boolean;
  attachmentIds?: string[];
  specialistId?: string;
};

export type PendingChatTurn = {
  input: ChatTurnInput;
  requestId: string;
  resultConversationId?: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePendingChatTurn(raw: string | null): PendingChatTurn | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !("input" in value) || !("requestId" in value) ||
      !value.input || typeof value.input !== "object" || typeof value.requestId !== "string" || !uuid.test(value.requestId)) return null;
    const input = value.input as Record<string, unknown>;
    if (typeof input.text !== "string" || typeof input.model !== "string" || typeof input.webSearch !== "boolean") return null;
    if (input.conversationId !== undefined && typeof input.conversationId !== "string") return null;
    if (input.projectId !== undefined && input.projectId !== null && typeof input.projectId !== "string") return null;
    if (input.attachmentIds !== undefined && (!Array.isArray(input.attachmentIds) ||
      !input.attachmentIds.every(item => typeof item === "string"))) return null;
    const resultConversationId = "resultConversationId" in value && typeof value.resultConversationId === "string"
      ? value.resultConversationId : undefined;
    return { input: input as ChatTurnInput, requestId: value.requestId, resultConversationId };
  } catch { return null; }
}

export function samePendingTurn(
  pending: PendingChatTurn, candidate: ChatTurnInput, selectedConversationId: string | null,
  selectedProjectId: string | null
): boolean {
  if (JSON.stringify(pending.input) === JSON.stringify(candidate)) return true;
  if (!pending.resultConversationId || pending.resultConversationId !== selectedConversationId ||
    (pending.input.projectId ?? null) !== selectedProjectId) return false;
  const withoutPlacement = (input: ChatTurnInput) => {
    const { conversationId: _conversationId, projectId: _projectId, ...rest } = input;
    return JSON.stringify(rest);
  };
  return withoutPlacement(pending.input) === withoutPlacement(candidate);
}
