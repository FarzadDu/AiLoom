/**
 * Allowlist of media endpoints verified against provider API references.
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
    id: "nano-banana-pro", provider: "kie", name: "Nano Banana Pro",
    operations: ["text_to_image"], outputKind: "image",
    docsUrl: "https://docs.kie.ai/market/google/pro-image-to-image",
    priceNote: "Kie pricing depends on resolution and account terms."
  },
  {
    id: "google/imagen4", provider: "kie", name: "Imagen 4",
    operations: ["text_to_image"], outputKind: "image",
    docsUrl: "https://docs.kie.ai/market/google/imagen4",
    priceNote: "Kie pricing depends on model and account terms."
  },
  {
    id: "google/imagen4-fast", provider: "kie", name: "Imagen 4 Fast",
    operations: ["text_to_image"], outputKind: "image",
    docsUrl: "https://docs.kie.ai/market/google/imagen4-fast",
    priceNote: "Kie pricing depends on model and account terms."
  },
  {
    id: "google/imagen4-ultra", provider: "kie", name: "Imagen 4 Ultra",
    operations: ["text_to_image"], outputKind: "image",
    docsUrl: "https://docs.kie.ai/market/google/imagen4-ultra",
    priceNote: "Kie pricing depends on model and account terms."
  },
  {
    id: "wavespeed-ai/flux-2-flash/text-to-image", provider: "wavespeed", name: "FLUX.2 Flash",
    operations: ["text_to_image"], outputKind: "image",
    docsUrl: "https://wavespeed.ai/docs/docs-api/wavespeed-ai/flux-2-flash-text-to-image",
    priceNote: "WaveSpeed charge depends on account and output size."
  },
  {
    id: "openai/gpt-image-2.5/flare/text-to-image", provider: "fal", name: "GPT Image 2.5 Flare",
    operations: ["text_to_image"], outputKind: "image",
    docsUrl: "https://fal.ai/models/openai/gpt-image-2.5/flare/text-to-image/api",
    priceNote: "Fal bills token usage; quality and image size affect cost."
  },
  {
    id: "openai/gpt-image-2.5/sunburst/text-to-image", provider: "fal", name: "GPT Image 2.5 Sunburst",
    operations: ["text_to_image"], outputKind: "image",
    docsUrl: "https://fal.ai/models/openai/gpt-image-2.5/sunburst/text-to-image/api",
    priceNote: "Fal bills token usage; quality and image size affect cost."
  },
  {
    id: "bytedance/seedream/v5/flash/text-to-image", provider: "fal", name: "Seedream 5.0 Flash",
    operations: ["text_to_image"], outputKind: "image",
    docsUrl: "https://fal.ai/models/bytedance/seedream/v5/flash/text-to-image/api",
    priceNote: "Fal pricing varies with the image request and account."
  },
  {
    id: "bytedance/seedream/v5/lite/text-to-image", provider: "fal", name: "Seedream 5.0 Lite",
    operations: ["text_to_image"], outputKind: "image",
    docsUrl: "https://fal.ai/models/bytedance/seedream/v5/lite/text-to-image/api",
    priceNote: "Fal pricing varies with the image request and account."
  },
  {
    id: "fal-ai/bytedance/seedream/v4.5/text-to-image", provider: "fal", name: "Seedream 4.5",
    operations: ["text_to_image"], outputKind: "image",
    docsUrl: "https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/text-to-image/api",
    priceNote: "Fal pricing varies with the image request and account."
  },
  {
    id: "fal-ai/flux-2-flex", provider: "fal", name: "FLUX.2 Flex",
    operations: ["text_to_image"], outputKind: "image",
    docsUrl: "https://fal.ai/models/fal-ai/flux-2-flex/api",
    priceNote: "Fal pricing depends on output size and account."
  },
  {
    id: "fal-ai/flux-2/flash", provider: "fal", name: "FLUX.2 Flash",
    operations: ["text_to_image"], outputKind: "image",
    docsUrl: "https://fal.ai/models/fal-ai/flux-2/flash/api",
    priceNote: "Fal pricing depends on output size and account."
  },
  {
    id: "alibaba/qwen-image-3/text-to-image", provider: "fal", name: "Qwen Image 3",
    operations: ["text_to_image"], outputKind: "image",
    docsUrl: "https://fal.ai/models/alibaba/qwen-image-3/text-to-image/api",
    priceNote: "Fal pricing depends on output size and account."
  },
  {
    id: "fal-ai/qwen-image-2512", provider: "fal", name: "Qwen Image 2512",
    operations: ["text_to_image"], outputKind: "image",
    docsUrl: "https://fal.ai/models/fal-ai/qwen-image-2512/api",
    priceNote: "Fal pricing depends on output size and account."
  },
  {
    id: "ideogram/v4", provider: "fal", name: "Ideogram 4",
    operations: ["text_to_image"], outputKind: "image",
    docsUrl: "https://fal.ai/models/ideogram/v4/api",
    priceNote: "Fal pricing varies with rendering speed and image size."
  },
  {
    id: "fal-ai/recraft/v3/text-to-image", provider: "fal", name: "Recraft V3",
    operations: ["text_to_image"], outputKind: "image",
    docsUrl: "https://fal.ai/models/fal-ai/recraft/v3/text-to-image/api",
    priceNote: "Fal pricing varies with style and output size."
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
    id: "openai/gpt-image-2.5/flare/edit", provider: "fal", name: "GPT Image 2.5 Flare Edit",
    operations: ["image_edit"], outputKind: "image",
    docsUrl: "https://fal.ai/models/openai/gpt-image-2.5/flare/edit/api",
    priceNote: "Fal bills token usage; quality, image size and references affect cost."
  },
  {
    id: "openai/gpt-image-2.5/sunburst/edit", provider: "fal", name: "GPT Image 2.5 Sunburst Edit",
    operations: ["image_edit"], outputKind: "image",
    docsUrl: "https://fal.ai/models/openai/gpt-image-2.5/sunburst/edit/api",
    priceNote: "Fal bills token usage; quality, image size and references affect cost."
  },
  {
    id: "bytedance/seedream/v5/flash/edit", provider: "fal", name: "Seedream 5.0 Flash Edit",
    operations: ["image_edit"], outputKind: "image",
    docsUrl: "https://fal.ai/models/bytedance/seedream/v5/flash/edit/api",
    priceNote: "Fal pricing varies with image request and account."
  },
  {
    id: "bytedance/seedream/v5/lite/edit", provider: "fal", name: "Seedream 5.0 Lite Edit",
    operations: ["image_edit"], outputKind: "image",
    docsUrl: "https://fal.ai/models/bytedance/seedream/v5/lite/edit/api",
    priceNote: "Fal pricing varies with image request and account."
  },
  {
    id: "fal-ai/bytedance/seedream/v4.5/edit", provider: "fal", name: "Seedream 4.5 Edit",
    operations: ["image_edit"], outputKind: "image",
    docsUrl: "https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/edit/api",
    priceNote: "Fal pricing varies with image request and account."
  },
  {
    id: "fal-ai/flux-2-pro/edit", provider: "fal", name: "FLUX.2 Pro Edit",
    operations: ["image_edit"], outputKind: "image",
    docsUrl: "https://fal.ai/models/fal-ai/flux-2-pro/edit/api",
    priceNote: "Fal pricing depends on input and output size."
  },
  {
    id: "alibaba/qwen-image-3/edit", provider: "fal", name: "Qwen Image 3 Edit",
    operations: ["image_edit"], outputKind: "image",
    docsUrl: "https://fal.ai/models/alibaba/qwen-image-3/edit/api",
    priceNote: "Fal pricing depends on input and output size."
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
    id: "kling-3.0/video",
    provider: "kie",
    name: "Kling 3.0",
    operations: ["text_to_video", "image_to_video"],
    outputKind: "video",
    docsUrl: "https://docs.kie.ai/market/kling/kling-3-0",
    priceNote: "Kie credits depend on duration, sound and std/pro/4K mode; no published rate formula is available for a reliable estimate."
  },
  {
    id: "bytedance/seedance-2-5",
    provider: "kie",
    name: "Seedance 2.5",
    operations: ["text_to_video"],
    outputKind: "video",
    docsUrl: "https://docs.kie.ai/market/bytedance/seedance-2-5",
    priceNote: "Kie credits depend on the generated video; no published rate formula is available for a reliable estimate."
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
    id: "fal-ai/veo3.1",
    provider: "fal",
    name: "Veo 3.1 Standard",
    operations: ["text_to_video"],
    outputKind: "video",
    docsUrl: "https://fal.ai/models/fal-ai/veo3.1/api",
    priceNote: "Published rate is $0.20/s without audio or $0.40/s with audio at 720p/1080p; 4K costs $0.40/s or $0.60/s respectively."
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
    id: "fal-ai/kling-video/v3/standard/text-to-video",
    provider: "fal",
    name: "Kling 3.0 Standard · Text to Video",
    operations: ["text_to_video"],
    outputKind: "video",
    docsUrl: "https://fal.ai/models/fal-ai/kling-video/v3/standard/text-to-video/api",
    priceNote: "Published rate is $0.084/s without native audio or $0.126/s with native audio; voice controls cost extra."
  },
  {
    id: "fal-ai/kling-video/v3/turbo/standard/text-to-video",
    provider: "fal",
    name: "Kling 3.0 Turbo Standard · Text to Video",
    operations: ["text_to_video"],
    outputKind: "video",
    docsUrl: "https://fal.ai/models/fal-ai/kling-video/v3/turbo/standard/text-to-video/api",
    priceNote: "Published rate is $0.112 per generated second at 720p."
  },
  {
    id: "fal-ai/kling-video/v3/standard/image-to-video",
    provider: "fal",
    name: "Kling 3.0 Standard · Image to Video",
    operations: ["image_to_video"],
    outputKind: "video",
    docsUrl: "https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video/api",
    priceNote: "Published rate is $0.084/s without native audio or $0.126/s with native audio; voice controls cost extra."
  },
  {
    id: "fal-ai/wan/v2.7/text-to-video",
    provider: "fal",
    name: "Wan 2.7 · Text to Video",
    operations: ["text_to_video"],
    outputKind: "video",
    docsUrl: "https://fal.ai/models/fal-ai/wan/v2.7/text-to-video/api",
    priceNote: "Published rate is $0.10/s at 720p or $0.15/s at 1080p. The model creates a soundtrack automatically."
  },
  {
    id: "fal-ai/minimax/hailuo-2.3/standard/text-to-video",
    provider: "fal",
    name: "MiniMax Hailuo 2.3 Standard · Text to Video",
    operations: ["text_to_video"],
    outputKind: "video",
    docsUrl: "https://fal.ai/models/fal-ai/minimax/hailuo-2.3/standard/text-to-video/api",
    priceNote: "Published price is $0.28 for 6s or $0.56 for 10s at 768p."
  },
  {
    id: "fal-ai/minimax/hailuo-2.3/standard/image-to-video",
    provider: "fal",
    name: "MiniMax Hailuo 2.3 Standard · Image to Video",
    operations: ["image_to_video"],
    outputKind: "video",
    docsUrl: "https://fal.ai/models/fal-ai/minimax/hailuo-2.3/standard/image-to-video/api",
    priceNote: "Published price is $0.28 for 6s or $0.56 for 10s at 768p."
  },
  {
    id: "fal-ai/luma-dream-machine/ray-2-flash",
    provider: "fal",
    name: "Luma Ray 2 Flash · Text to Video",
    operations: ["text_to_video"],
    outputKind: "video",
    docsUrl: "https://fal.ai/models/fal-ai/luma-dream-machine/ray-2-flash/api",
    priceNote: "Published base price is $0.20 for 5s at 540p. 9s doubles cost, 720p doubles resolution cost, and 1080p quadruples it."
  },
  {
    id: "fal-ai/wan/v2.7/image-to-video",
    provider: "fal",
    name: "Wan 2.7 · Image to Video",
    operations: ["image_to_video"],
    outputKind: "video",
    docsUrl: "https://fal.ai/models/fal-ai/wan/v2.7/image-to-video/api",
    priceNote: "Published rate is $0.10/s at 720p or $0.15/s at 1080p."
  },
  {
    id: "fal-ai/wan/v2.7/reference-to-video",
    provider: "fal",
    name: "Wan 2.7 · Reference to Video",
    operations: ["reference_to_video"],
    outputKind: "video",
    docsUrl: "https://fal.ai/models/fal-ai/wan/v2.7/reference-to-video/api",
    priceNote: "Published rate is $0.10 per billed second, including input-video duration when video references are used."
  },
  {
    id: "wavespeed-ai/open-video/image-to-video",
    provider: "wavespeed",
    name: "OpenVideo · Image to Video",
    operations: ["image_to_video"],
    outputKind: "video",
    docsUrl: "https://wavespeed.ai/docs/docs-api/wavespeed-ai/open-video-image-to-video",
    priceNote: "Published rate is $0.02/s at 480p, $0.04/s at 720p, or $0.06/s at 1080p; native audio is included."
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
    id: "fal-ai/elevenlabs/tts/turbo-v2.5",
    provider: "fal",
    name: "ElevenLabs Turbo v2.5 Speech",
    operations: ["text_to_speech"],
    outputKind: "audio",
    docsUrl: "https://fal.ai/models/fal-ai/elevenlabs/tts/turbo-v2.5/api",
    priceNote: "Published rate is $0.05 per 1,000 characters. Persian is not an officially listed language for this model."
  },
  {
    id: "fal-ai/elevenlabs/tts/multilingual-v2",
    provider: "fal",
    name: "ElevenLabs Multilingual v2 Speech",
    operations: ["text_to_speech"],
    outputKind: "audio",
    docsUrl: "https://fal.ai/models/fal-ai/elevenlabs/tts/multilingual-v2/api",
    priceNote: "Published rate is $0.10 per 1,000 characters. Persian is not an officially listed language for this model."
  },
  {
    id: "fal-ai/gemini-tts",
    provider: "fal",
    name: "Gemini 2.5 Flash TTS",
    operations: ["text_to_speech"],
    outputKind: "audio",
    docsUrl: "https://fal.ai/models/fal-ai/gemini-tts/api",
    priceNote: "Fal price depends on request and account; Gemini supports Persian (Iran) as a preview language."
  },
  {
    id: "minimax/speech-2.8-hd",
    provider: "wavespeed",
    name: "MiniMax Speech 2.8 HD",
    operations: ["text_to_speech"],
    outputKind: "audio",
    docsUrl: "https://wavespeed.ai/docs/docs-api/minimax/minimax-speech-2.8-hd",
    priceNote: "Published rate is $0.10 per 1,000 characters; final WaveSpeed account charge may vary."
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
    id: "elevenlabs/music/v2.5",
    provider: "fal",
    name: "ElevenLabs Music v2.5",
    operations: ["text_to_music"],
    outputKind: "audio",
    docsUrl: "https://fal.ai/models/elevenlabs/music/v2.5/api",
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
    id: "fal-ai/stable-audio-3/medium/text-to-audio",
    provider: "fal",
    name: "Stable Audio 3 Medium Music",
    operations: ["text_to_music"],
    outputKind: "audio",
    docsUrl: "https://fal.ai/models/fal-ai/stable-audio-3/medium/text-to-audio/api",
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
  },
  {
    id: "fal-ai/elevenlabs/sound-effects/v2",
    provider: "fal",
    name: "ElevenLabs Sound Effects v2",
    operations: ["text_to_sound_effect"],
    outputKind: "audio",
    docsUrl: "https://fal.ai/models/fal-ai/elevenlabs/sound-effects/v2/api",
    priceNote: "Published fal rate is $0.002 per generated second; actual cost depends on output and account."
  }
];

export function listMediaModels(operation?: MediaOperation): MediaModel[] {
  return MEDIA_MODELS.filter(model => !operation || model.operations.includes(operation));
}

export function getMediaModel(id: string): MediaModel | null {
  return MEDIA_MODELS.find(model => model.id === id) ?? null;
}

