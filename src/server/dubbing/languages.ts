// ElevenLabs Dubbing v2 supported BCP-47 targets (base tags and supported
// dialects). Keep this list aligned with the provider's published table:
// https://elevenlabs.io/docs/overview/capabilities/dubbing#supported-languages
export const DUBBING_LANGUAGES = [
  "af", "ak", "sq", "am", "ar", "ar-EG", "hy", "as", "az", "eu", "be", "bs", "bg", "my",
  "yue", "ca", "ceb", "zh", "zh-TW", "hr", "cs", "da", "dgo", "nl", "en", "en-AU",
  "en-CA", "en-GB", "en-US", "et", "fil", "fi", "fr", "fr-CA", "fr-FR", "gl", "ka",
  "de", "el", "gu", "ha", "he", "hi", "hu", "is", "id", "it", "ja", "jv", "kn",
  "kk", "ki", "rw", "rn", "ko", "ky", "lv", "lt", "lg", "mk", "ms", "ml", "cmn",
  "mr", "mn", "ne", "no", "fa", "pl", "pt", "pt-BR", "pt-PT", "pa", "ro", "ru",
  "nso", "st", "sd", "sk", "sl", "es", "es-AR", "es-CL", "es-ES", "es-MX", "su",
  "sw", "ss", "sv", "tg", "ta", "te", "th", "bo", "ts", "tn", "tr", "uk", "ur",
  "ug", "uz", "ve", "vi", "war", "cy", "wo", "yo", "zu"
] as const;

export type DubbingLanguage = typeof DUBBING_LANGUAGES[number];
export const DUBBING_LANGUAGE_SET: ReadonlySet<string> = new Set(DUBBING_LANGUAGES);
