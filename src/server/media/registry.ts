/**
 * Deliberately small allowlist of media endpoints verified against provider API references.
 * Model availability, rights, regions and live price still require account-side checks.
 */
export type MediaProvider = "kie" | "fal" | "wavespeed";
export type MediaOperation =
  | "text_to_image"
  | "image_edit"
  | "image_inpaint"
  | "character_to_image"
  | "image_upscale"
  | "text_to_video"
  | "image_to_video"
  | "first_last_frame_to_video"
  | "reference_to_video"
  | "temporal_inpaint"
  | "text_to_speech"
  | "text_to_music"
  | "text_to_sound_effect";

export type MediaModel = {
  id: string;
  provider: MediaProvider;
  name: string;
  operations: readonly MediaOperation[];
  outputKind: "image" | "video" | "audio";
  docsUrl: string;
  priceNote: string;
};

export const MEDIA_MODELS: readonly MediaModel[] = [
  {
    id: "nano-banana-2",
    provider: "kie",
    name: "Nano Banana 2",
    operations: ["text_to_image"],
    outputKind: "image",
    docsUrl: "https://docs.kie.ai/market/google/nanobanana2",
    priceNote: "Kie pricing is dynamic; confirm the applicable account price before submission."
  },
  {
    id: "wavespeed-ai/z-image/turbo",
    provider: "wavespeed",
    name: "Z Image Turbo",
    operations: ["text_to_image"],
    outputKind: "image",
    docsUrl: "https://wavespeed.ai/docs/docs-api/wavespeed-ai/z-image-turbo",
    priceNote: "Published base starts at $0.005 per image; final charge depends on inputs and account."
  },
  {
    id: "fal-ai/flux-2-pro",
    provider: "fal",
    name: "FLUX.2 Pro",
    operations: ["text_to_image"],
    outputKind: "image",
    docsUrl: "https://fal.ai/models/fal-ai/flux-2-pro/api",
    priceNote: "Published rate starts at $0.03 for the first output megapixel; input/output size changes price."
  },
  {
    id: "fal-ai/qwen-image-edit",
    provider: "fal",
    name: "Qwen Image Edit",
    operations: ["image_edit"],
    outputKind: "image",
    docsUrl: "https://fal.ai/models/fal-ai/qwen-image-edit/api",
    priceNote: "Published rate is $0.03 per output megapixel; final charge may vary by account."
  },
  {
    id: "wavespeed-ai/z-image/turbo-inpaint",
    provider: "wavespeed",
    name: "Z Image Turbo Inpaint",
    operations: ["image_inpaint"],
    outputKind: "image",
    docsUrl: "https://wavespeed.ai/docs/docs-api/wavespeed-ai/z-image-turbo-inpaint",
    priceNote: "Published rate is $0.02 per inpainted image; confirm the final account charge."
  },
  {
    id: "fal-ai/ideogram/character",
    provider: "fal",
    name: "Ideogram Character",
    operations: ["character_to_image"],
    outputKind: "image",
    docsUrl: "https://fal.ai/models/fal-ai/ideogram/character/api",
    priceNote: "Published price per image: $0.15 BALANCED or $0.20 QUALITY. Character similarity is not guaranteed."
  },
  {
    id: "topaz/upscale/image/precision",
    provider: "fal",
    name: "Topaz Precision Upscale",
    operations: ["image_upscale"],
    outputKind: "image",
    docsUrl: "https://fal.ai/models/topaz/upscale/image/precision/api",
    priceNote: "Published rate is $0.08 per started 24 megapixels of output. Final charge depends on actual output dimensions and account terms."
  },
  {
    id: "fal-ai/veo3.1/fast",
    provider: "fal",
    name: "Veo 3.1 Fast",
    operations: ["text_to_video"],
    outputKind: "video",
    docsUrl: "https://fal.ai/models/fal-ai/veo3.1/fast/api",
    priceNote: "Published 720p/1080p rate is $0.10/s without audio or $0.15/s with audio; estimate only."
  },
  {
    id: "fal-ai/veo3.1/fast/image-to-video",
    provider: "fal",
    name: "Veo 3.1 Fast Image to Video",
    operations: ["image_to_video"],
    outputKind: "video",
    docsUrl: "https://fal.ai/models/fal-ai/veo3.1/fast/image-to-video/api",
    priceNote: "Published 720p/1080p rate is $0.10/s without audio or $0.15/s with audio; estimate only."
  },
  {
    id: "fal-ai/veo3.1/fast/first-last-frame-to-video",
    provider: "fal",
    name: "Veo 3.1 Fast · First and Last Frame",
    operations: ["first_last_frame_to_video"],
    outputKind: "video",
    docsUrl: "https://fal.ai/models/fal-ai/veo3.1/fast/first-last-frame-to-video/api",
    priceNote: "Published 720p/1080p rate is $0.10/s without audio or $0.15/s with audio; estimate only."
  },
  {
    id: "bytedance/seedance-2.5/text-to-video",
    provider: "fal",
    name: "Seedance 2.5 · Text to Video",
    operations: ["text_to_video"],
    outputKind: "video",
    docsUrl: "https://fal.ai/models/bytedance/seedance-2.5/text-to-video/api",
    priceNote: "Fal bills output video tokens. Published 16:9 examples are about $0.22/s at 480p, $0.47/s at 720p and $1.16/s at 1080p; actual frame area, length and account terms determine cost."
  },
  {
    id: "bytedance/seedance-2.5/reference-to-video",
    provider: "fal",
    name: "Seedance 2.5 · Reference to Video",
    operations: ["reference_to_video"],
    outputKind: "video",
    docsUrl: "https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api",
    priceNote: "Fal bills video output and any input-video seconds; image/audio references add no billed seconds. 480p/720p/1080p rates are token-based, so cost cannot be known from URLs alone."
  },
  {
    id: "fal-ai/ltx-2.3-quality/inpaint",
    provider: "fal",
    name: "LTX 2.3 Video Inpaint",
    operations: ["temporal_inpaint"],
    outputKind: "video",
    docsUrl: "https://fal.ai/models/fal-ai/ltx-2.3-quality/inpaint/api",
    priceNote: "Charged by processed video pixels/frames; no fixed per-task estimate."
  },
  {
    id: "fal-ai/elevenlabs/tts/eleven-v3",
    provider: "fal",
    name: "Eleven v3 Speech",
    operations: ["text_to_speech"],
    outputKind: "audio",
    docsUrl: "https://fal.ai/models/fal-ai/elevenlabs/tts/eleven-v3/api",
    priceNote: "Published rate is $0.10 per 1,000 input characters; estimate only."
  },
  {
    id: "elevenlabs/music/v2",
    provider: "fal",
    name: "ElevenLabs Music v2",
    operations: ["text_to_music"],
    outputKind: "audio",
    docsUrl: "https://fal.ai/models/elevenlabs/music/v2/api",
    priceNote: "Published rate is $0.60 per started output minute; final charge may vary by account."
  },
  {
    id: "fal-ai/stable-audio-3/small/music/text-to-audio",
    provider: "fal",
    name: "Stable Audio 3 Small Music",
    operations: ["text_to_music"],
    outputKind: "audio",
    docsUrl: "https://fal.ai/models/fal-ai/stable-audio-3/small/music/text-to-audio/api",
    priceNote: "Fal displays a sample per-audio price; final charge depends on request settings and account."
  },
  {
    id: "fal-ai/stable-audio-3/small/sfx/text-to-audio",
    provider: "fal",
    name: "Stable Audio 3 Small SFX",
    operations: ["text_to_sound_effect"],
    outputKind: "audio",
    docsUrl: "https://fal.ai/models/fal-ai/stable-audio-3/small/sfx/text-to-audio/api",
    priceNote: "Fal shows a sample price per output, but the actual charge depends on request settings and account."
  }
];

export function listMediaModels(operation?: MediaOperation): MediaModel[] {
  return MEDIA_MODELS.filter(model => !operation || model.operations.includes(operation));
}

export function getMediaModel(id: string): MediaModel | null {
  return MEDIA_MODELS.find(model => model.id === id) ?? null;
}

