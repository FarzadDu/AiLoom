import type { ChatMessage } from "./chat-api";

export type FailedOptimisticTurn = { id: string; identity: string };

/** Keep following a reply only while the reader remains near the end of the chat. */
export function chatScrollIsNearBottom(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  return scrollHeight - clientHeight - scrollTop <= 96;
}

/** Keep the same message under the reader when an older page is inserted above it. */
export function chatScrollAfterPrepend(previousTop: number, previousHeight: number, currentHeight: number): number {
  return Math.max(0, previousTop + currentHeight - previousHeight);
}

/** A retry replaces only the matching failed local bubble, not unrelated draft history. */
export function appendOptimisticChatTurn(
  previous: ChatMessage[], failed: FailedOptimisticTurn | null, identity: string,
  user: ChatMessage, assistant: ChatMessage
): ChatMessage[] {
  const retained = failed?.identity === identity
    ? previous.filter(item => item.id !== failed.id || item.status !== "error")
    : previous;
  return [...retained, user, assistant];
}

/** Save model choices in click order even when the network replies out of order. */
export function createSerialAsyncQueue() {
  let tail: Promise<void> = Promise.resolve();
  return (task: () => Promise<void>): Promise<void> => {
    const result = tail.then(task);
    tail = result.catch(() => undefined);
    return result;
  };
}
