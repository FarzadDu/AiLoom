import type { TemplateDefinition } from "./templates";

type StarterTemplate = {
  title: string;
  description: string;
  category: string;
  definition: TemplateDefinition;
};

/** Editable recipes. Opening a stage copies its prompt into the matching Studio. */
export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    title: "Product hero image",
    description: "Turn one product reference into a polished campaign image, then refine the scene without changing the product.",
    category: "image",
    definition: {
      version: 1,
      inputs: [
        { key: "product", label: "Product and key details", type: "text", required: true },
        { key: "reference", label: "Product reference photo", type: "image", required: false },
        { key: "brand", label: "Brand colors and visual rules", type: "text", required: false }
      ],
      steps: [
        { id: "brief", title: "Art direction", kind: "chat", modelId: "openrouter/auto", prompt: "Create a concise art direction brief for {{product}}. Consider the supplied product reference and these brand rules: {{brand}}. Specify setting, light, camera angle, palette and details that must remain unchanged." },
        { id: "hero", title: "Generate hero image", kind: "image", modelId: "fal-ai/flux-2-pro", prompt: "Create a premium editorial product hero image of {{product}}. Preserve the exact product shape, packaging, logo and typography from the reference when one is attached. Use deliberate lighting, a clean composition and these brand cues: {{brand}}. No extra products or invented text." },
        { id: "refine", title: "Refine the scene", kind: "image", modelId: "fal-ai/qwen-image-edit", prompt: "Using the previous image as a reference, refine only the background, lighting and shadows. Keep the product, logo, label, proportions and camera angle unchanged. Match these brand rules: {{brand}}." }
      ]
    }
  },
  {
    title: "Consistent portrait",
    description: "Establish one character reference and create a new scene while keeping recognizable features consistent.",
    category: "image",
    definition: {
      version: 1,
      inputs: [
        { key: "subject", label: "Subject description", type: "text", required: true },
        { key: "reference", label: "Consenting subject reference", type: "image", required: false },
        { key: "scene", label: "New scene and wardrobe", type: "text", required: true }
      ],
      steps: [
        { id: "identity", title: "Character brief", kind: "chat", modelId: "openrouter/auto", prompt: "Write a short visual continuity brief for {{subject}} using the supplied reference if present. Record stable facial features, hairstyle, age presentation and distinguishing details. Then describe the new scene: {{scene}}." },
        { id: "anchor", title: "Create anchor portrait", kind: "image", modelId: "fal-ai/flux-2-pro", prompt: "Make a natural, detailed portrait of {{subject}} in {{scene}}. Keep defining facial features, hairstyle and age presentation consistent with the supplied reference. Use realistic light and anatomy; avoid adding extra people or text." },
        { id: "variation", title: "Create matching variation", kind: "image", modelId: "fal-ai/qwen-image-edit", prompt: "Use the anchor portrait as the reference. Change the pose and framing for {{scene}}, while preserving the subject's identity, hairstyle, clothing details and overall photographic style." }
      ]
    }
  },
  {
    title: "Short film scene",
    description: "Plan a brief shot, make a key frame and animate it into a video with model-aware duration.",
    category: "video",
    definition: {
      version: 1,
      inputs: [
        { key: "story", label: "Story and subject", type: "text", required: true },
        { key: "style", label: "Visual style", type: "text", required: false },
        { key: "keyframe", label: "Optional first-frame reference", type: "image", required: false }
      ],
      steps: [
        { id: "storyboard", title: "Write shot plan", kind: "chat", modelId: "openrouter/auto", prompt: "Plan one 4–8 second cinematic shot for {{story}} in this style: {{style}}. Specify the subject, opening frame, camera movement, action, ending frame and sound. Keep the action achievable within the selected model duration." },
        { id: "frame", title: "Make key frame", kind: "image", modelId: "fal-ai/flux-2-pro", prompt: "Create a cinematic first frame for {{story}}. Visual style: {{style}}. Show clear subject placement, environment and lighting suitable for the start of a short moving shot. No captions or watermarks." },
        { id: "motion", title: "Animate shot", kind: "video", modelId: "fal-ai/veo3.1/fast/image-to-video", prompt: "Animate the supplied first frame as a coherent short film shot for {{story}}. Preserve subject and scene continuity. Camera motion and action should be controlled and readable, with a clear ending. Visual style: {{style}}." }
      ]
    }
  },
  {
    title: "Voiceover take",
    description: "Polish a script for speech and generate a paced narration in the requested language.",
    category: "audio",
    definition: {
      version: 1,
      inputs: [
        { key: "script", label: "Raw script", type: "text", required: true },
        { key: "language", label: "Language", type: "text", required: true },
        { key: "delivery", label: "Voice and delivery direction", type: "text", required: false }
      ],
      steps: [
        { id: "polish", title: "Polish spoken script", kind: "chat", modelId: "openrouter/auto", prompt: "Rewrite {{script}} for a natural voiceover in {{language}}. Keep the meaning and names accurate. Add punctuation that supports clear pacing, and keep the spoken text separate from production notes. Delivery direction: {{delivery}}." },
        { id: "speak", title: "Generate narration", kind: "audio", modelId: "fal-ai/elevenlabs/tts/eleven-v3", prompt: "{{script}}" },
        { id: "review", title: "Review pronunciation", kind: "chat", modelId: "openrouter/auto", prompt: "Review this voiceover script for likely pronunciation or pacing problems in {{language}}. Suggest only the minimal text changes needed for the next take. Voice direction: {{delivery}}. Script: {{script}}" }
      ]
    }
  },
  {
    title: "Social launch clip",
    description: "Build a concise hook, visual, motion clip and voiceover for a social announcement.",
    category: "video",
    definition: {
      version: 1,
      inputs: [
        { key: "offer", label: "Product or announcement", type: "text", required: true },
        { key: "audience", label: "Audience and platform", type: "text", required: true },
        { key: "brand", label: "Brand voice and visual rules", type: "text", required: false },
        { key: "reference", label: "Optional product reference", type: "image", required: false }
      ],
      steps: [
        { id: "hook", title: "Write the hook", kind: "chat", modelId: "openrouter/auto", prompt: "Write a short, specific social video hook for {{offer}} aimed at {{audience}}. Use this brand voice: {{brand}}. Include one clear visual action and a concise call to action. Avoid unsupported claims." },
        { id: "cover", title: "Create cover frame", kind: "image", modelId: "fal-ai/flux-2-pro", prompt: "Create a striking but clean vertical social cover image for {{offer}} and {{audience}}. Respect these brand rules: {{brand}}. If a product reference is attached, preserve its real shape, label and logo. Leave usable negative space for later typography; do not render text." },
        { id: "clip", title: "Animate the clip", kind: "video", modelId: "fal-ai/veo3.1/fast/image-to-video", prompt: "Create a short vertical social clip from the supplied cover frame for {{offer}}. Open with a clear visual hook, use smooth readable motion, keep any referenced product consistent, and end on a useful call-to-action frame. Brand direction: {{brand}}." },
        { id: "voice", title: "Add voiceover take", kind: "audio", modelId: "fal-ai/elevenlabs/tts/eleven-v3", prompt: "Create a concise, energetic voiceover announcing {{offer}} to {{audience}}. Match this brand voice: {{brand}}." }
      ]
    }
  }
];
