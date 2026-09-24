import { z } from "zod";
import { createKieTask, getKieTask } from "../providers/kie";
import { getFalResult, getFalTask, submitFalTask } from "../providers/fal";
import { getWaveSpeedTask, submitWaveSpeedTask } from "../providers/wavespeed";
import {
  getMediaModel, type MediaModel, type MediaOperation, type MediaProvider
} from "./registry";

export type MediaPriceEstimate = {
  amountUsd: number;
  asOf: "2026-09-24";
  basis: string;
  caveat: string;
};

export type PreparedMediaRequest = {
  provider: MediaProvider;
  modelId: string;
  operation: MediaOperation;
  providerInput: Record<string, unknown>;
  priceEstimate: MediaPriceEstimate | null;
};

export type MediaSubmission = {
  provider: MediaProvider;
  modelId: string;
  operation: MediaOperation;
  providerTaskId: string;
  state: "queued" | "running" | "completed" | "failed";
  priceEstimate: MediaPriceEstimate | null;
};

export type MediaAsset = {
  kind: "image" | "video" | "audio";
  url: string;
  contentType: string | null;
};

export type MediaTask = {
  provider: MediaProvider;
  modelId: string;
  providerTaskId: string;
  state: "queued" | "running" | "completed" | "failed";
  assets: MediaAsset[];
  failureCode: string | null;
  progress: number | null;
};

export class MediaRequestError extends Error {
  constructor(
    public readonly code: "unsupported_model" | "unsupported_operation" | "invalid_input",
    public readonly fields: string[] = []
  ) {
    super(code === "unsupported_model" ? "This media model is not available."
      : code === "unsupported_operation" ? "This model does not support that operation."
      : "Invalid media request.");
    this.name = "MediaRequestError";
  }
}

export type ServiceOptions = {
  apiKeys?: Partial<Record<MediaProvider, string>>;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  webhookUrl?: string;
};

const prompt = z.string().trim().min(1).max(4000);
const speechText = z.string().trim().min(1).max(5000);
const safeUrl = z.string().max(2048).url().refine(value => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    // Asset input must be an HTTPS URL supplied through the server's asset flow.
    // Direct loopback/private hostnames and IP literals are not accepted here.
    return url.protocol === "https:" && !url.username && !url.password && !url.hash &&
      (!url.port || url.port === "443") &&
      host !== "localhost" && !host.endsWith(".localhost") &&
      !host.endsWith(".local") && !host.endsWith(".internal") &&
      !/^\d+\.\d+\.\d+\.\d+$/.test(host) && !host.startsWith("[");
  } catch { return false; }
}, "Use a public HTTPS asset URL.");

const imageSize = z.enum([
  "square_hd", "square", "portrait_4_3", "portrait_16_9",
  "landscape_4_3", "landscape_16_9"
]);
const veoDuration = z.union([z.literal(4), z.literal(6), z.literal(8)]);
const veoResolution = z.enum(["720p", "1080p"]);
const veoAspect = z.enum(["16:9", "9:16"]);
const imageFormat = z.enum(["jpeg", "png"]);
const seedanceDuration = z.union([z.number().int().min(4).max(30), z.literal("auto")]);
const seedanceResolution = z.enum(["480p", "720p", "1080p"]);
const seedanceAspect = z.enum(["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
const seedanceControls = {
  prompt,
  durationSec: seedanceDuration.optional(),
  aspectRatio: seedanceAspect.optional(),
  resolution: seedanceResolution.optional(),
  audio: z.boolean().optional(),
  bitrateMode: z.enum(["standard", "high"]).optional()
};

const kieImageSchema = z.strictObject({
  modelId: z.literal("nano-banana-2"),
  operation: z.literal("text_to_image"),
  prompt
});
const waveImageSchema = z.strictObject({
  modelId: z.literal("wavespeed-ai/z-image/turbo"),
  operation: z.literal("text_to_image"),
  prompt,
  width: z.number().int().min(256).max(1536).optional(),
  height: z.number().int().min(256).max(1536).optional(),
  outputFormat: z.enum(["jpeg", "png", "webp"]).optional()
}).refine(value => (value.width === undefined) === (value.height === undefined), {
  path: ["width"], message: "Width and height must be supplied together."
});
const fluxImageSchema = z.strictObject({
  modelId: z.literal("fal-ai/flux-2-pro"),
  operation: z.literal("text_to_image"),
  prompt,
  imageSize: imageSize.optional(),
  outputFormat: imageFormat.optional()
});
const qwenEditSchema = z.strictObject({
  modelId: z.literal("fal-ai/qwen-image-edit"),
  operation: z.literal("image_edit"),
  prompt,
  imageUrl: safeUrl,
  imageSize: imageSize.optional(),
  outputFormat: imageFormat.optional()
});
const topazPrecisionSchema = z.strictObject({
  modelId: z.literal("topaz/upscale/image/precision"),
  operation: z.literal("image_upscale"),
  imageUrl: safeUrl,
  upscaleFactor: z.union([z.literal(2), z.literal(4)]).optional(),
  upscaleModel: z.enum([
    "Standard V2", "High Fidelity V3", "High Fidelity V2",
    "Low Resolution V2", "CGI", "Text Refine", "Faces"
  ]).optional(),
  outputFormat: imageFormat.optional()
});
const veoTextSchema = z.strictObject({
  modelId: z.literal("fal-ai/veo3.1/fast"),
  operation: z.literal("text_to_video"),
  prompt,
  durationSec: veoDuration.optional(),
  aspectRatio: veoAspect.optional(),
  resolution: veoResolution.optional(),
  audio: z.boolean().optional()
});
const veoImageSchema = z.strictObject({
  modelId: z.literal("fal-ai/veo3.1/fast/image-to-video"),
  operation: z.literal("image_to_video"),
  prompt,
  imageUrl: safeUrl,
  durationSec: veoDuration.optional(),
  aspectRatio: z.enum(["auto", "16:9", "9:16"]).optional(),
  resolution: veoResolution.optional(),
  audio: z.boolean().optional()
});
const veoFirstLastSchema = z.strictObject({
  modelId: z.literal("fal-ai/veo3.1/fast/first-last-frame-to-video"),
  operation: z.literal("first_last_frame_to_video"),
  prompt,
  firstFrameUrl: safeUrl,
  lastFrameUrl: safeUrl,
  durationSec: veoDuration.optional(),
  aspectRatio: z.enum(["auto", "16:9", "9:16"]).optional(),
  resolution: veoResolution.optional(),
  audio: z.boolean().optional()
});
const seedanceTextSchema = z.strictObject({
  modelId: z.literal("bytedance/seedance-2.5/text-to-video"),
  operation: z.literal("text_to_video"),
  ...seedanceControls
});
const seedanceReferenceSchema = z.strictObject({
  modelId: z.literal("bytedance/seedance-2.5/reference-to-video"),
  operation: z.literal("reference_to_video"),
  ...seedanceControls,
  imageUrls: z.array(safeUrl).max(30).optional(),
  videoUrls: z.array(safeUrl).max(10).optional(),
  audioUrls: z.array(safeUrl).max(10).optional()
}).superRefine((value, context) => {
  const imageCount = value.imageUrls?.length ?? 0;
  const videoCount = value.videoUrls?.length ?? 0;
  const audioCount = value.audioUrls?.length ?? 0;
  if (imageCount + videoCount === 0) {
    context.addIssue({ code: "custom", path: ["imageUrls"],
      message: "At least one image or video reference is required." });
  }
  if (imageCount + videoCount + audioCount > 50) {
    context.addIssue({ code: "custom", path: ["imageUrls"],
      message: "The combined reference limit is 50 files." });
  }
});
const temporalInpaintSchema = z.strictObject({
  modelId: z.literal("fal-ai/ltx-2.3-quality/inpaint"),
  operation: z.literal("temporal_inpaint"),
  prompt,
  videoUrl: safeUrl,
  maskVideoUrl: safeUrl,
  frameCount: z.number().int().min(1).max(240),
  fps: z.number().min(1).max(60)
});
const speechSchema = z.strictObject({
  modelId: z.literal("fal-ai/elevenlabs/tts/eleven-v3"),
  operation: z.literal("text_to_speech"),
  text: speechText,
  voice: z.string().trim().min(1).max(128).optional(),
  languageCode: z.enum(["en", "fa"]).optional()
});
const elevenMusicSchema = z.strictObject({
  modelId: z.literal("elevenlabs/music/v2"),
  operation: z.literal("text_to_music"),
  prompt,
  durationSec: z.number().int().min(3).max(600).optional(),
  forceInstrumental: z.boolean().optional()
});
const stableMusicSchema = z.strictObject({
  modelId: z.literal("fal-ai/stable-audio-3/small/music/text-to-audio"),
  operation: z.literal("text_to_music"),
  prompt,
  durationSec: z.number().int().min(3).max(120).optional()
});

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function checked<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map(issue => issue.path.join(".")).filter(Boolean))];
    throw new MediaRequestError("invalid_input", fields);
  }
  return result.data;
}

function priceEstimate(amountUsd: number, basis: string): MediaPriceEstimate {
  return {
    amountUsd: Math.round(amountUsd * 100000) / 100000,
    asOf: "2026-09-24",
    basis,
    caveat: "Published-rate estimate only; live provider charge, account discounts and extras may differ."
  };
}

function veoInput(value: {
  prompt: string;
  durationSec?: 4 | 6 | 8;
  aspectRatio?: "auto" | "16:9" | "9:16";
  resolution?: "720p" | "1080p";
  audio?: boolean;
}): Record<string, unknown> {
  return {
    prompt: value.prompt,
    duration: String(value.durationSec ?? 8) + "s",
    aspect_ratio: value.aspectRatio ?? "16:9",
    resolution: value.resolution ?? "720p",
    generate_audio: value.audio ?? true
  };
}

type SeedanceControls = {
  prompt: string;
  durationSec?: number | "auto";
  aspectRatio?: "auto" | "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
  resolution?: "480p" | "720p" | "1080p";
  audio?: boolean;
  bitrateMode?: "standard" | "high";
};

function seedanceInput(value: SeedanceControls): Record<string, unknown> {
  return {
    prompt: value.prompt,
    ...(value.durationSec === undefined ? {} : { duration: String(value.durationSec) }),
    ...(value.aspectRatio === undefined ? {} : { aspect_ratio: value.aspectRatio }),
    ...(value.resolution === undefined ? {} : { resolution: value.resolution }),
    ...(value.audio === undefined ? {} : { generate_audio: value.audio }),
    ...(value.bitrateMode === undefined ? {} : { bitrate_mode: value.bitrateMode })
  };
}

// Fal's published token formula covers fixed 480p/720p output dimensions. We do
// not guess a charge for auto settings, 1080p dimensions, or input-video duration.
function seedanceEstimate(value: SeedanceControls, hasVideoReference = false): MediaPriceEstimate | null {
  if (hasVideoReference || typeof value.durationSec !== "number" ||
    !value.aspectRatio || value.aspectRatio === "auto" || value.resolution === "1080p") return null;
  const dimensions: Record<"480p" | "720p", Record<Exclude<NonNullable<SeedanceControls["aspectRatio"]>, "auto">, [number, number]>> = {
    "480p": { "21:9": [992, 432], "16:9": [864, 496], "4:3": [752, 560],
      "1:1": [640, 640], "3:4": [560, 752], "9:16": [496, 864] },
    "720p": { "21:9": [1470, 630], "16:9": [1280, 720], "4:3": [1112, 834],
      "1:1": [960, 960], "3:4": [834, 1112], "9:16": [720, 1280] }
  };
  const [width, height] = dimensions[value.resolution ?? "720p"][value.aspectRatio];
  const tokens = width * height * value.durationSec * 24 / 1024;
  return priceEstimate(tokens * 0.0214 / 1000,
    "Fal Seedance 2.5 published output-pixel token formula (fixed duration and aspect); audio does not change token price");
}

function assertSupported(value: unknown): MediaModel {
  const input = record(value);
  if (!input || typeof input.modelId !== "string") {
    throw new MediaRequestError("invalid_input", ["modelId"]);
  }
  const model = getMediaModel(input.modelId);
  if (!model) throw new MediaRequestError("unsupported_model", ["modelId"]);
  if (typeof input.operation !== "string" ||
      !model.operations.includes(input.operation as MediaOperation)) {
    throw new MediaRequestError("unsupported_operation", ["operation"]);
  }
  return model;
}

export function prepareMediaRequest(input: unknown): PreparedMediaRequest {
  const model = assertSupported(input);
  let providerInput: Record<string, unknown>;
  let estimate: MediaPriceEstimate | null = null;
  switch (model.id) {
    case "nano-banana-2": {
      const value = checked(kieImageSchema, input);
      providerInput = {
        prompt: value.prompt,
        image_input: [],
        aspect_ratio: "auto",
        resolution: "1K",
        output_format: "png"
      };
      break;
    }
    case "wavespeed-ai/z-image/turbo": {
      const value = checked(waveImageSchema, input);
      providerInput = {
        prompt: value.prompt,
        size: String(value.width ?? 1024) + "*" + String(value.height ?? 1024),
        output_format: value.outputFormat ?? "jpeg"
      };
      break;
    }
    case "fal-ai/flux-2-pro": {
      const value = checked(fluxImageSchema, input);
      providerInput = {
        prompt: value.prompt,
        image_size: value.imageSize ?? "landscape_4_3",
        output_format: value.outputFormat ?? "jpeg",
        enable_safety_checker: true
      };
      break;
    }
    case "fal-ai/qwen-image-edit": {
      const value = checked(qwenEditSchema, input);
      providerInput = {
        prompt: value.prompt,
        image_url: value.imageUrl,
        ...(value.imageSize ? { image_size: value.imageSize } : {}),
        output_format: value.outputFormat ?? "png",
        num_images: 1,
        enable_safety_checker: true
      };
      break;
    }
    case "topaz/upscale/image/precision": {
      const value = checked(topazPrecisionSchema, input);
      providerInput = {
        image_url: value.imageUrl,
        model: value.upscaleModel ?? "Standard V2",
        upscale_factor: value.upscaleFactor ?? 2,
        output_format: value.outputFormat ?? "jpeg"
      };
      // The provider bills per started output-megapixel block. The source
      // dimensions are not known from a signed URL alone, so no fixed quote.
      break;
    }
    case "fal-ai/veo3.1/fast": {
      const value = checked(veoTextSchema, input);
      providerInput = veoInput(value);
      estimate = priceEstimate((value.durationSec ?? 8) * (value.audio === false ? 0.10 : 0.15),
        "fal Veo 3.1 Fast, 720p/1080p, generated video seconds");
      break;
    }
    case "fal-ai/veo3.1/fast/image-to-video": {
      const value = checked(veoImageSchema, input);
      providerInput = {
        ...veoInput(value),
        aspect_ratio: value.aspectRatio ?? "auto",
        image_url: value.imageUrl
      };
      estimate = priceEstimate((value.durationSec ?? 8) * (value.audio === false ? 0.10 : 0.15),
        "fal Veo 3.1 Fast image-to-video, 720p/1080p, generated video seconds");
      break;
    }
    case "fal-ai/veo3.1/fast/first-last-frame-to-video": {
      const value = checked(veoFirstLastSchema, input);
      providerInput = {
        ...veoInput(value),
        aspect_ratio: value.aspectRatio ?? "auto",
        first_frame_url: value.firstFrameUrl,
        last_frame_url: value.lastFrameUrl
      };
      estimate = priceEstimate((value.durationSec ?? 8) * (value.audio === false ? 0.10 : 0.15),
        "fal Veo 3.1 Fast first/last frame, 720p/1080p, generated video seconds");
      break;
    }
    case "bytedance/seedance-2.5/text-to-video": {
      const value = checked(seedanceTextSchema, input);
      providerInput = seedanceInput(value);
      estimate = seedanceEstimate(value);
      break;
    }
    case "bytedance/seedance-2.5/reference-to-video": {
      const value = checked(seedanceReferenceSchema, input);
      providerInput = {
        ...seedanceInput(value),
        task: "reference",
        ...(value.imageUrls?.length ? { image_urls: value.imageUrls } : {}),
        ...(value.videoUrls?.length ? { video_urls: value.videoUrls } : {}),
        ...(value.audioUrls?.length ? { audio_urls: value.audioUrls } : {})
      };
      estimate = seedanceEstimate(value, !!value.videoUrls?.length);
      break;
    }
    case "fal-ai/ltx-2.3-quality/inpaint": {
      const value = checked(temporalInpaintSchema, input);
      providerInput = {
        prompt: value.prompt,
        video_url: value.videoUrl,
        mask_video_url: value.maskVideoUrl,
        num_frames: value.frameCount,
        frames_per_second: value.fps,
        generate_audio: false,
        enable_safety_checker: true
      };
      break;
    }
    case "fal-ai/elevenlabs/tts/eleven-v3": {
      const value = checked(speechSchema, input);
      providerInput = {
        text: value.text,
        ...(value.voice ? { voice: value.voice } : {}),
        ...(value.languageCode ? { language_code: value.languageCode } : {}),
        apply_text_normalization: "auto"
      };
      estimate = priceEstimate(value.text.length * 0.10 / 1000,
        "fal Eleven v3, requested text characters");
      break;
    }
    case "elevenlabs/music/v2": {
      const value = checked(elevenMusicSchema, input);
      const durationSec = value.durationSec ?? 30;
      providerInput = {
        prompt: value.prompt,
        music_length_ms: durationSec * 1000,
        force_instrumental: value.forceInstrumental ?? false,
        output_format: "mp3_48000_192"
      };
      estimate = priceEstimate(Math.ceil(durationSec / 60) * 0.60,
        "fal ElevenLabs Music v2, started output minutes");
      break;
    }
    case "fal-ai/stable-audio-3/small/music/text-to-audio": {
      const value = checked(stableMusicSchema, input);
      providerInput = {
        prompt: value.prompt,
        duration: value.durationSec ?? 30,
        output_format: "mp3",
        bitrate: "192k"
      };
      // The playground shows a sample request price, not a duration formula.
      break;
    }
    default:
      throw new MediaRequestError("unsupported_model", ["modelId"]);
  }
  return {
    provider: model.provider,
    modelId: model.id,
    operation: model.operations[0],
    providerInput,
    priceEstimate: estimate
  };
}

function serviceWebhook(value?: string): string | undefined {
  if (!value) return undefined;
  if (!safeUrl.safeParse(value).success) {
    throw new MediaRequestError("invalid_input", ["webhookUrl"]);
  }
  return value;
}

export async function submitMediaRequest(
  input: unknown,
  options: ServiceOptions = {}
): Promise<MediaSubmission> {
  const prepared = prepareMediaRequest(input);
  const webhookUrl = serviceWebhook(options.webhookUrl);
  const common = {
    apiKey: options.apiKeys?.[prepared.provider],
    fetcher: options.fetcher,
    signal: options.signal
  };
  if (prepared.provider === "kie") {
    const id = await createKieTask({
      ...common, model: prepared.modelId, input: prepared.providerInput,
      callbackUrl: webhookUrl
    });
    return { provider: prepared.provider, modelId: prepared.modelId, operation: prepared.operation,
      providerTaskId: id, state: "queued", priceEstimate: prepared.priceEstimate };
  }
  if (prepared.provider === "fal") {
    const task = await submitFalTask({
      ...common, endpoint: prepared.modelId, input: prepared.providerInput,
      webhookUrl
    });
    return { provider: prepared.provider, modelId: prepared.modelId, operation: prepared.operation,
      providerTaskId: task.requestId, state: task.state, priceEstimate: prepared.priceEstimate };
  }
  const task = await submitWaveSpeedTask({
    ...common, model: prepared.modelId, input: prepared.providerInput,
    webhookUrl
  });
  return { provider: prepared.provider, modelId: prepared.modelId, operation: prepared.operation,
    providerTaskId: task.predictionId, state: task.state, priceEstimate: prepared.priceEstimate };
}

function assetUrl(value: string): string | null {
  return safeUrl.safeParse(value).success ? value : null;
}

export async function getMediaTask(
  reference: { modelId: string; providerTaskId: string },
  options: Omit<ServiceOptions, "webhookUrl"> = {}
): Promise<MediaTask> {
  const model = getMediaModel(reference.modelId);
  if (!model) throw new MediaRequestError("unsupported_model", ["modelId"]);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(reference.providerTaskId)) {
    throw new MediaRequestError("invalid_input", ["providerTaskId"]);
  }
  const common = {
    apiKey: options.apiKeys?.[model.provider],
    fetcher: options.fetcher,
    signal: options.signal
  };
  if (model.provider === "kie") {
    const task = await getKieTask({ ...common, taskId: reference.providerTaskId });
    const state = task.state === "waiting" || task.state === "queuing" ? "queued"
      : task.state === "generating" ? "running"
      : task.state === "success" ? "completed" : "failed";
    return {
      provider: model.provider,
      modelId: model.id,
      providerTaskId: reference.providerTaskId,
      state,
      assets: state === "completed" ? task.resultUrls
        .map(url => assetUrl(url))
        .filter((url): url is string => url !== null)
        .map(url => ({ kind: model.outputKind, url, contentType: null })) : [],
      failureCode: state === "failed" ? "provider_failed" : null,
      progress: task.progress
    };
  }
  if (model.provider === "fal") {
    const task = await getFalTask({
      ...common, endpoint: model.id, requestId: reference.providerTaskId
    });
    const result = task.state === "completed" ? await getFalResult({
      ...common, endpoint: model.id, requestId: reference.providerTaskId
    }) : null;
    return {
      provider: model.provider,
      modelId: model.id,
      providerTaskId: reference.providerTaskId,
      state: task.state,
      assets: result ? result.outputs
        .filter(output => (output.kind === model.outputKind || output.kind === "file") && assetUrl(output.url) !== null)
        .map(output => ({ kind: model.outputKind, url: output.url, contentType: output.contentType })) : [],
      failureCode: task.state === "failed" ? task.failureType ?? "provider_failed" : null,
      progress: null
    };
  }
  const task = await getWaveSpeedTask({
    ...common, predictionId: reference.providerTaskId
  });
  return {
    provider: model.provider,
    modelId: model.id,
    providerTaskId: reference.providerTaskId,
    state: task.state,
    assets: task.outputs
      .filter((output): output is Extract<typeof output, { kind: "media" }> => output.kind === "media")
      .filter(output => assetUrl(output.url) !== null)
      .map(output => ({ kind: model.outputKind, url: output.url, contentType: output.contentType })),
    failureCode: task.state === "failed" ? task.providerStatus : null,
    progress: null
  };
}

