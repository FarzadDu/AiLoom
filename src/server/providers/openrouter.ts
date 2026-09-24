const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatPart[];
};

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  sessionId?: string;
  signal?: AbortSignal;
  apiKey?: string;
  fetcher?: typeof fetch;
  siteUrl?: string;
};

export type OpenRouterModel = {
  id: string;
  name: string;
  description: string | null;
  contextLength: number | null;
  inputModalities: string[];
  outputModalities: string[];
  pricing: Record<string, string>;
};

export class OpenRouterError extends Error {
  constructor(public readonly status: number) {
    super(status === 401 ? "OpenRouter API key is invalid." : status === 402
      ? "OpenRouter account needs credit."
      : status === 429 ? "OpenRouter rate limit reached."
      : "OpenRouter request failed.");
    this.name = "OpenRouterError";
  }
}

function headers(apiKey: string, siteUrl?: string): HeadersInit {
  const result: Record<string, string> = {
    Authorization: "Bearer " + apiKey,
    "Content-Type": "application/json",
    "X-Title": "Ailoom"
  };
  if (siteUrl) result["HTTP-Referer"] = siteUrl;
  return result;
}

function requiredKey(apiKey?: string): string {
  const value = apiKey || process.env.OPENROUTER_API_KEY;
  if (!value) throw new Error("OpenRouter is not configured.");
  return value;
}

export async function createChatCompletion(request: ChatRequest): Promise<Response> {
  const apiKey = requiredKey(request.apiKey);
  const response = await (request.fetcher || fetch)(OPENROUTER_BASE_URL + "/chat/completions", {
    method: "POST",
    headers: headers(apiKey, request.siteUrl),
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      stream: request.stream ?? true,
      ...(request.sessionId ? { session_id: request.sessionId } : {})
    }),
    signal: request.signal,
    cache: "no-store"
  });
  if (!response.ok) throw new OpenRouterError(response.status);
  return response;
}

type RawModel = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  context_length?: unknown;
  architecture?: {
    input_modalities?: unknown;
    output_modalities?: unknown;
  };
  pricing?: unknown;
};

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseModel(raw: RawModel): OpenRouterModel | null {
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const pricing = raw.pricing && typeof raw.pricing === "object" && !Array.isArray(raw.pricing)
    ? Object.fromEntries(Object.entries(raw.pricing).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};
  return {
    id: raw.id,
    name: raw.name,
    description: typeof raw.description === "string" ? raw.description : null,
    contextLength: typeof raw.context_length === "number" ? raw.context_length : null,
    inputModalities: stringList(raw.architecture?.input_modalities),
    outputModalities: stringList(raw.architecture?.output_modalities),
    pricing
  };
}

export async function listChatModels(options: {
  apiKey?: string;
  fetcher?: typeof fetch;
  siteUrl?: string;
} = {}): Promise<OpenRouterModel[]> {
  const apiKey = requiredKey(options.apiKey);
  const response = await (options.fetcher || fetch)(OPENROUTER_BASE_URL + "/models", {
    headers: headers(apiKey, options.siteUrl),
    cache: "no-store"
  });
  if (!response.ok) throw new OpenRouterError(response.status);
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !("data" in data) || !Array.isArray(data.data)) {
    throw new Error("OpenRouter returned an invalid model catalog.");
  }
  return data.data
    .map((item: RawModel) => parseModel(item))
    .filter((model: OpenRouterModel | null): model is OpenRouterModel =>
      model !== null &&
      model.inputModalities.includes("text") &&
      model.outputModalities.includes("text"))
    .sort((a: OpenRouterModel, b: OpenRouterModel) => a.name.localeCompare(b.name));
}
