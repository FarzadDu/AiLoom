import { OpenRouterError } from "./openrouter";

const BASE_URL = "https://openrouter.ai/api/v1";

export type ImageReference = {
  type: "image_url";
  image_url: { url: string };
};

export type ImageModel = {
  id: string;
  name: string;
  description: string | null;
  inputModalities: string[];
  supportedParameters: Record<string, unknown>;
  supportsStreaming: boolean;
};

export type GeneratedImage = {
  bytes: Buffer;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
};

export type ImageResult = {
  images: GeneratedImage[];
  costUsd: number | null;
};

export type ImageRequest = {
  model: string;
  prompt: string;
  count?: number;
  resolution?: string;
  aspectRatio?: string;
  quality?: "auto" | "low" | "medium" | "high";
  outputFormat?: "png" | "jpeg" | "webp";
  references?: ImageReference[];
  apiKey?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
};

function key(apiKey?: string): string {
  const result = apiKey || process.env.OPENROUTER_API_KEY;
  if (!result) throw new Error("OpenRouter is not configured.");
  return result;
}

function requestHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: "Bearer " + apiKey,
    "Content-Type": "application/json",
    "X-Title": "Ailoom"
  };
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((part): part is string => typeof part === "string") : [];
}

export async function listImageModels(options: {
  apiKey?: string;
  fetcher?: typeof fetch;
} = {}): Promise<ImageModel[]> {
  const response = await (options.fetcher || fetch)(BASE_URL + "/images/models", {
    headers: requestHeaders(key(options.apiKey)),
    cache: "no-store"
  });
  if (!response.ok) throw new OpenRouterError(response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("data" in payload) || !Array.isArray(payload.data)) {
    throw new Error("OpenRouter returned an invalid image model catalog.");
  }
  return payload.data.flatMap((item: unknown): ImageModel[] => {
    if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "string" ||
        !("name" in item) || typeof item.name !== "string") return [];
    const model = item as {
      id: string;
      name: string;
      description?: unknown;
      architecture?: { input_modalities?: unknown };
      supported_parameters?: unknown;
      supports_streaming?: unknown;
    };
    return [{
      id: model.id,
      name: model.name,
      description: typeof model.description === "string" ? model.description : null,
      inputModalities: textArray(model.architecture?.input_modalities),
      supportedParameters: model.supported_parameters && typeof model.supported_parameters === "object" &&
        !Array.isArray(model.supported_parameters) ? model.supported_parameters as Record<string, unknown> : {},
      supportsStreaming: model.supports_streaming === true
    }];
  }).sort((a: ImageModel, b: ImageModel) => a.name.localeCompare(b.name));
}

export async function generateImage(request: ImageRequest): Promise<ImageResult> {
  const count = request.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("Image count must be between 1 and 10.");
  if (!request.prompt.trim()) throw new Error("Image prompt is required.");
  const response = await (request.fetcher || fetch)(BASE_URL + "/images", {
    method: "POST",
    headers: requestHeaders(key(request.apiKey)),
    body: JSON.stringify({
      model: request.model,
      prompt: request.prompt,
      n: count,
      ...(request.resolution ? { resolution: request.resolution } : {}),
      ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
      ...(request.quality ? { quality: request.quality } : {}),
      ...(request.outputFormat ? { output_format: request.outputFormat } : {}),
      ...(request.references?.length ? { input_references: request.references } : {})
    }),
    signal: request.signal,
    cache: "no-store"
  });
  if (!response.ok) throw new OpenRouterError(response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("data" in payload) || !Array.isArray(payload.data)) {
    throw new Error("OpenRouter returned an invalid image result.");
  }
  const images: GeneratedImage[] = payload.data.map((item: unknown) => {
    if (!item || typeof item !== "object" || !("b64_json" in item) || typeof item.b64_json !== "string") {
      throw new Error("OpenRouter returned an invalid image.");
    }
    const mediaType = "media_type" in item ? item.media_type : "image/png";
    if (mediaType !== "image/png" && mediaType !== "image/jpeg" && mediaType !== "image/webp") {
      throw new Error("Unsupported generated image format.");
    }
    return { bytes: Buffer.from(item.b64_json, "base64"), mediaType };
  });
  const usage = "usage" in payload && payload.usage && typeof payload.usage === "object" ? payload.usage : null;
  const costUsd = usage && "cost" in usage && typeof usage.cost === "number" ? usage.cost : null;
  return { images, costUsd };
}
