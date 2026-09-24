export type TranscriptWord = { text: string; start: number; end: number; speakerId: string | null };
export type TranscriptResult = { text: string; languageCode: string | null; words: TranscriptWord[] };
export type SpeakerTurn = { speakerId: string; text: string; start: number };

export function transcriptFromPayload(value: unknown): TranscriptResult | null {
  if (!value || typeof value !== "object" || !("text" in value) || typeof value.text !== "string") return null;
  const raw = value as Record<string, unknown>;
  const words = Array.isArray(raw.words) ? raw.words.flatMap((item: unknown): TranscriptWord[] => {
    if (!item || typeof item !== "object" || !("text" in item) || typeof item.text !== "string" ||
      !("start" in item) || typeof item.start !== "number" || !Number.isFinite(item.start) ||
      !("end" in item) || typeof item.end !== "number" || !Number.isFinite(item.end)) return [];
    return [{ text: item.text, start: item.start, end: item.end,
      speakerId: "speakerId" in item && typeof item.speakerId === "string" ? item.speakerId : null }];
  }) : [];
  return { text: value.text, languageCode: typeof raw.languageCode === "string" ? raw.languageCode : null, words };
}

function appendWord(current: string, next: string): string {
  if (!current) return next.trimStart();
  return /^[\s.,!?;:،؛؟]/.test(next) ? current + next : current + " " + next;
}

export function speakerTurns(words: TranscriptWord[]): SpeakerTurn[] {
  const turns: SpeakerTurn[] = [];
  for (const word of words) {
    if (!word.speakerId || !word.text.trim()) continue;
    const previous = turns[turns.length - 1];
    if (previous?.speakerId === word.speakerId) previous.text = appendWord(previous.text, word.text);
    else turns.push({ speakerId: word.speakerId, text: word.text.trimStart(), start: word.start });
  }
  return turns;
}

export function transcriptDownloadName(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "").replace(/[\\/\x00-\x1f]/g, "_").slice(0, 120).trim();
  return `${stem || "transcript"}.txt`;
}
