const BASE_URL = "https://api.elevenlabs.io";

export class ElevenLabsError extends Error {
  constructor(public readonly status: number) {
    super(status === 401 ? "ElevenLabs API key is invalid." : status === 429
      ? "ElevenLabs rate limit reached." : "ElevenLabs request failed.");
    this.name = "ElevenLabsError";
  }
}

function key(value?: string): string {
  const result = value || process.env.ELEVENLABS_API_KEY;
  if (!result) throw new Error("ElevenLabs is not configured.");
  return result;
}

export type ElevenVoice = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  previewUrl: string | null;
};

export async function createInstantVoice(options: {
  name: string;
  bytes: Buffer;
  filename: string;
  mimeType: "audio/mpeg" | "audio/wav" | "audio/ogg";
  apiKey?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ voiceId: string; requiresVerification: boolean }> {
  if (!options.name.trim() || !options.bytes.length || options.bytes.length > 20_000_000) {
    throw new Error("Invalid voice clone sample.");
  }
  const form = new FormData();
  form.set("name", options.name);
  form.append("files[]", new Blob([new Uint8Array(options.bytes)], { type: options.mimeType }), options.filename);
  const response = await (options.fetcher ?? fetch)(BASE_URL + "/v1/voices/add", {
    method: "POST", headers: { "xi-api-key": key(options.apiKey) },
    body: form, signal: options.signal, cache: "no-store"
  });
  if (!response.ok) throw new ElevenLabsError(response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("voice_id" in payload) ||
    typeof payload.voice_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.voice_id)) {
    throw new Error("ElevenLabs returned an invalid voice ID.");
  }
  return { voiceId: payload.voice_id,
    requiresVerification: "requires_verification" in payload && payload.requires_verification === true };
}

export async function getInstantVoiceVerification(options: {
  voiceId: string;
  apiKey?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<"ready" | "verification_required" | "unknown"> {
  const response = await (options.fetcher ?? fetch)(BASE_URL + "/v1/voices/" + encodeURIComponent(options.voiceId), {
    headers: { "xi-api-key": key(options.apiKey) }, signal: options.signal, cache: "no-store"
  });
  if (!response.ok) throw new ElevenLabsError(response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("voice_id" in payload) ||
    payload.voice_id !== options.voiceId) throw new Error("ElevenLabs returned an invalid voice record.");
  const verification = "voice_verification" in payload ? payload.voice_verification : null;
  if (!verification || typeof verification !== "object") return "unknown";
  if ("is_verified" in verification && verification.is_verified === true) return "ready";
  if ("requires_verification" in verification && verification.requires_verification === false) return "ready";
  if ("requires_verification" in verification && verification.requires_verification === true) {
    return "verification_required";
  }
  return "unknown";
}

// Search is read-only. The exact provider name includes the local request UUID,
// so an uncertain create can be linked without repeating the paid POST.
export async function findInstantVoiceByExactName(options: {
  name: string;
  apiKey?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<string | null> {
  let nextPageToken: string | null = null;
  let match: string | null = null;
  for (let page = 0; page < 10; page++) {
    const url = new URL(BASE_URL + "/v2/voices");
    url.searchParams.set("page_size", "100");
    url.searchParams.set("category", "cloned");
    url.searchParams.set("search", options.name);
    if (nextPageToken) url.searchParams.set("next_page_token", nextPageToken);
    const response = await (options.fetcher ?? fetch)(url, {
      headers: { "xi-api-key": key(options.apiKey) }, signal: options.signal, cache: "no-store"
    });
    if (!response.ok) throw new ElevenLabsError(response.status);
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("voices" in payload) ||
      !Array.isArray(payload.voices)) throw new Error("ElevenLabs returned an invalid voice list.");
    for (const item of payload.voices) {
      if (!item || typeof item !== "object" || !("name" in item) || item.name !== options.name ||
        !("voice_id" in item) || typeof item.voice_id !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(item.voice_id)) continue;
      if (match && match !== item.voice_id) throw new Error("Several provider voices have this request name.");
      match = item.voice_id;
    }
    if (!("has_more" in payload) || payload.has_more !== true) return match;
    nextPageToken = "next_page_token" in payload && typeof payload.next_page_token === "string"
      ? payload.next_page_token : null;
    if (!nextPageToken) throw new Error("ElevenLabs voice search could not be completed.");
  }
  throw new Error("ElevenLabs voice search exceeded the safe page limit.");
}

async function boundedAudio(response: Response, limit: number): Promise<Buffer> {
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) > limit) throw new Error("Speech output is too large.");
  if (!response.body) throw new Error("ElevenLabs returned no speech output.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Speech output is too large.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}

export async function listElevenVoices(options: {
  search?: string;
  apiKey?: string;
  fetcher?: typeof fetch;
} = {}): Promise<ElevenVoice[]> {
  const url = new URL(BASE_URL + "/v2/voices");
  url.searchParams.set("page_size", "100");
  if (options.search) url.searchParams.set("search", options.search);
  const response = await (options.fetcher || fetch)(url, {
    headers: { "xi-api-key": key(options.apiKey) },
    cache: "no-store"
  });
  if (!response.ok) throw new ElevenLabsError(response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("voices" in payload) ||
      !Array.isArray(payload.voices)) throw new Error("ElevenLabs returned an invalid voice list.");
  return payload.voices.flatMap((voice: unknown): ElevenVoice[] => {
    if (!voice || typeof voice !== "object" || !("voice_id" in voice) ||
        typeof voice.voice_id !== "string" || !("name" in voice) ||
        typeof voice.name !== "string") return [];
    const item = voice as Record<string, unknown>;
    return [{
      id: voice.voice_id,
      name: voice.name,
      description: typeof item.description === "string" ? item.description : null,
      category: typeof item.category === "string" ? item.category : null,
      previewUrl: typeof item.preview_url === "string" ? item.preview_url : null
    }];
  });
}

export async function synthesizeSpeech(options: {
  text: string;
  voiceId: string;
  modelId?: string;
  languageCode?: string;
  apiKey?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<Buffer> {
  if (!options.text.trim()) throw new Error("Speech text is required.");
  const url = BASE_URL + "/v1/text-to-speech/" + encodeURIComponent(options.voiceId) +
    "?output_format=mp3_44100_128";
  const response = await (options.fetcher || fetch)(url, {
    method: "POST",
    headers: { "xi-api-key": key(options.apiKey), "Content-Type": "application/json" },
    body: JSON.stringify({
      text: options.text,
      model_id: options.modelId || "eleven_v3",
      ...(options.languageCode ? { language_code: options.languageCode } : {})
    }),
    signal: options.signal,
    cache: "no-store"
  });
  if (!response.ok) throw new ElevenLabsError(response.status);
  return boundedAudio(response, 20_000_000);
}

export type Transcript = {
  text: string;
  languageCode: string | null;
  words: Array<{ text: string; start: number; end: number; speakerId: string | null }>;
};

export async function transcribeAudio(options: {
  bytes: Buffer;
  filename: string;
  mimeType: string;
  languageCode?: string;
  diarize?: boolean;
  apiKey?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<Transcript> {
  if (!options.bytes.length) throw new Error("Audio file is empty.");
  const form = new FormData();
  form.set("model_id", "scribe_v2");
  form.set("timestamps_granularity", "word");
  form.set("file", new Blob([new Uint8Array(options.bytes)], { type: options.mimeType }), options.filename);
  if (options.languageCode) form.set("language_code", options.languageCode);
  if (options.diarize) form.set("diarize", "true");
  const response = await (options.fetcher || fetch)(BASE_URL + "/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key(options.apiKey) },
    body: form,
    signal: options.signal,
    cache: "no-store"
  });
  if (!response.ok) throw new ElevenLabsError(response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("text" in payload) ||
      typeof payload.text !== "string") {
    throw new Error("ElevenLabs returned an invalid transcript.");
  }
  const rawWords = "words" in payload && Array.isArray(payload.words) ? payload.words : [];
  const words = rawWords.flatMap((word: unknown): Transcript["words"] => {
    if (!word || typeof word !== "object" || !("text" in word) ||
        typeof word.text !== "string" || !("start" in word) ||
        typeof word.start !== "number" || !("end" in word) ||
        typeof word.end !== "number") return [];
    return [{
      text: word.text,
      start: word.start,
      end: word.end,
      speakerId: "speaker_id" in word && typeof word.speaker_id === "string" ? word.speaker_id : null
    }];
  });
  return {
    text: payload.text,
    languageCode: "language_code" in payload && typeof payload.language_code === "string"
      ? payload.language_code : null,
    words
  };
}
