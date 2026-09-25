import { copy, type Locale } from "./workspace-data";

/** Present provider pricing caveats in the language of the audio studio. */
export function audioPriceNote(locale: Locale, modelId: string, providerNote?: string): string {
  if (locale === "en") return providerNote ?? copy.en.noPriceEstimate;
  if (modelId === "elevenlabs/music/v2" || modelId === "elevenlabs/music/v2.5") {
    return copy.fa.musicElevenCost;
  }
  if (modelId === "fal-ai/stable-audio-3/small/music/text-to-audio" ||
      modelId === "fal-ai/stable-audio-3/medium/text-to-audio") {
    return copy.fa.musicStableCost;
  }
  return copy.fa.noPriceEstimate;
}
