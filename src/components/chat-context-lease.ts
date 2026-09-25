/** Async replies may update a chat only while the user remains in that context. */
export function captureChatContext(readEpoch: () => number) {
  const startedAt = readEpoch();
  return {
    isCurrent: () => readEpoch() === startedAt,
    run(update: () => void): boolean {
      if (readEpoch() !== startedAt) return false;
      update();
      return true;
    }
  };
}
