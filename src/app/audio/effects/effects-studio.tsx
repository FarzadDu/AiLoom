"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ThemedSelect } from "@/components/themed-select";
import styles from "./effects.module.css";

type Locale = "en" | "fa";
type Theme = "light" | "dark";
type Effect = {
  id: string;
  providerModel: string;
  state: "queued" | "submitting" | "running" | "succeeded" | "failed" | "cancelled";
  errorCode: string | null;
  createdAt: string;
  output: unknown;
};
type EffectInput = {
  modelId: typeof STABLE_MODEL_ID | typeof ELEVEN_MODEL_ID;
  operation: "text_to_sound_effect";
  prompt: string;
  durationSec: number;
  negativePrompt?: string;
  outputFormat?: "mp3" | "wav";
  seed?: number;
  loop?: boolean;
  promptInfluence?: number;
};

const STABLE_MODEL_ID = "fal-ai/stable-audio-3/small/sfx/text-to-audio";
const ELEVEN_MODEL_ID = "fal-ai/elevenlabs/sound-effects/v2";
const modelDocs: Record<EffectInput["modelId"], string> = {
  [STABLE_MODEL_ID]: "https://fal.ai/models/fal-ai/stable-audio-3/small/sfx/text-to-audio/api",
  [ELEVEN_MODEL_ID]: "https://fal.ai/models/fal-ai/elevenlabs/sound-effects/v2/api"
};
const presets = [
  { en: "Footsteps", fa: "صدای قدم", prompt: "Close, realistic footsteps crossing a wet stone corridor, with natural reflections and no music." },
  { en: "Cinematic hit", fa: "ضربهٔ سینمایی", prompt: "A single deep cinematic impact with a crisp metallic attack and a long spacious tail, no melody." },
  { en: "Rain ambience", fa: "فضای بارانی", prompt: "Steady rain on a window at night, distant thunder, a soft room tone, natural stereo ambience, no speech." }
] as const;

const copy = {
  en: {
    back: "Back to Ailoom", eyebrow: "AUDIO / SOUND EFFECTS", formEyebrow: "01 / CREATE", libraryEyebrow: "02 / LIBRARY", seconds: "s", title: "Make the moment sound real.",
    subtitle: "Describe a scene, movement, impact, or atmosphere. Choose a model and create a private sound effect.",
    signIn: "Sign in on the home page to create and hear your private sound effects.", signedIn: "Signed in as",
    formTitle: "Create a sound", prompt: "Describe the sound", placeholder: "A heavy wooden door creaks open in an empty hall…",
    examples: "Start with a scene", model: "Model", duration: "Length", format: "Format", avoid: "Avoid (optional)",
    loop: "Seamless loop", influence: "Prompt influence (0–1)",
    avoidPlaceholder: "e.g. music, voices, distortion", seed: "Seed (optional)", seedHint: "Use the same number to reproduce a similar take.",
    create: "Generate sound", creating: "Adding to queue…", provider: "fal · sound effects",
    cost: "fal may charge for each generation. The exact price depends on your settings and account; this studio does not quote a fixed price.",
    private: "Prompts go to fal when you submit. Completed audio is saved in your private Ailoom library (up to 100 MB per file).",
    source: "Model documentation", list: "Your sound effects", empty: "No effects yet. Describe a sound to begin.",
    refresh: "Refresh", queued: "Queued", submitting: "Submitting", running: "Generating", succeeded: "Ready", failed: "Failed", cancelled: "Cancelled",
    uncertain: "The provider may have accepted this paid request. Ailoom will not submit it again automatically; check fal request history before making a new one.",
    genericFailure: "The sound could not be completed. Check the provider status before trying again.",
    retryDownload: "The sound was generated, but its private download failed. Ailoom may retry the import.",
    download: "Download", promptRequired: "Describe a sound in up to 4,000 characters.",
    requestFailed: "Could not queue the sound. Refresh your library before trying again.",
    english: "English", persian: "فارسی", light: "Light", dark: "Dark"
  },
  fa: {
    back: "بازگشت به Ailoom", eyebrow: "صدا / افکت صوتی", formEyebrow: "۰۱ / ساخت", libraryEyebrow: "۰۲ / کتابخانه", seconds: "ثانیه", title: "به لحظه جان بده.",
    subtitle: "صحنه، حرکت، ضربه یا فضا را توصیف کن. مدل را انتخاب کن و افکت صوتی خصوصی بساز.",
    signIn: "برای ساختن و شنیدن افکت‌های خصوصی‌ات در صفحهٔ اصلی وارد شو.", signedIn: "واردشده با نام",
    formTitle: "ساخت صدا", prompt: "صدا را توصیف کن", placeholder: "در چوبی سنگین در تالاری خالی با صدای جیرجیر باز می‌شود…",
    examples: "از یک صحنه شروع کن", model: "مدل", duration: "زمان", format: "فرمت", avoid: "چیزهایی که نباشد (اختیاری)",
    loop: "حلقهٔ پیوسته", influence: "میزان پیروی از توصیف (۰ تا ۱)",
    avoidPlaceholder: "مثلاً موسیقی، گفتار، اعوجاج", seed: "عدد تکرار (اختیاری)", seedHint: "برای ساخت برداشت مشابه از یک عدد یکسان استفاده کن.",
    create: "ساخت افکت صوتی", creating: "در حال افزودن به صف…", provider: "fal · افکت صوتی",
    cost: "ممکن است fal برای هر تولید هزینه بگیرد. مبلغ دقیق به تنظیمات و حسابت بستگی دارد؛ این صفحه قیمت قطعی اعلام نمی‌کند.",
    private: "پس از ارسال، متن توصیف به fal فرستاده می‌شود. صدای نهایی در کتابخانهٔ خصوصی Ailoom ذخیره می‌شود (حداکثر ۱۰۰ مگابایت برای هر فایل).",
    source: "مستندات مدل", list: "افکت‌های صوتی تو", empty: "هنوز افکتی ساخته نشده است. یک صدا را توصیف کن.",
    refresh: "تازه‌سازی", queued: "در صف", submitting: "در حال ارسال", running: "در حال ساخت", succeeded: "آماده", failed: "ناموفق", cancelled: "لغوشده",
    uncertain: "ممکن است سرویس‌دهنده این درخواست هزینه‌دار را پذیرفته باشد. Ailoom آن را خودکار دوباره ارسال نمی‌کند؛ پیش از درخواست تازه، تاریخچهٔ fal را بررسی کن.",
    genericFailure: "ساخت صدا کامل نشد. پیش از تلاش دوباره، وضعیت سرویس‌دهنده را بررسی کن.",
    retryDownload: "صدا ساخته شد، اما ذخیرهٔ خصوصی آن ناموفق بود. ممکن است Ailoom دریافت فایل را دوباره امتحان کند.",
    download: "دریافت", promptRequired: "یک صدا را در حداکثر ۴۰۰۰ نویسه توصیف کن.",
    requestFailed: "درخواست در صف ثبت نشد. پیش از تلاش دوباره، فهرست را تازه کن.",
    english: "English", persian: "فارسی", light: "روشن", dark: "تیره"
  }
} as const;

function privateAudioUrl(output: unknown): string | null {
  if (!output || typeof output !== "object" || !("assets" in output) || !Array.isArray(output.assets)) return null;
  for (const asset of output.assets) {
    if (asset && typeof asset === "object" && "url" in asset && typeof asset.url === "string" &&
        /^\/api\/assets\/[0-9a-f-]{36}$/i.test(asset.url)) return asset.url;
  }
  return null;
}

async function responseError(response: Response): Promise<string> {
  try { const body = await response.json(); if (typeof body?.error === "string") return body.error; }
  catch { /* Use a generic message. */ }
  return "Request failed.";
}

export default function EffectsStudio({ signedIn, name, userId }: {
  signedIn: boolean; name: string; userId: string | null;
}) {
  const [locale, setLocale] = useState<Locale>("en");
  const [theme, setTheme] = useState<Theme>("light");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState<EffectInput["modelId"]>(STABLE_MODEL_ID);
  const [negativePrompt, setNegativePrompt] = useState("");
  const [durationSec, setDurationSec] = useState(10);
  const [outputFormat, setOutputFormat] = useState<"mp3" | "wav">("mp3");
  const [seed, setSeed] = useState("");
  const [loop, setLoop] = useState(false);
  const [promptInfluence, setPromptInfluence] = useState(0.3);
  const [effects, setEffects] = useState<Effect[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const pendingStorageKey = userId ? `ailoom.soundEffectsPending.${userId}` : null;
  const t = copy[locale];

  useEffect(() => {
    if (!pendingStorageKey) return;
    try {
      const value = window.sessionStorage.getItem(pendingStorageKey);
      const stored: unknown = value ? JSON.parse(value) : null;
      if (stored && typeof stored === "object" && "fingerprint" in stored && "key" in stored &&
          typeof stored.fingerprint === "string" && stored.fingerprint.length < 8_000 &&
          typeof stored.key === "string" && /^[0-9a-f-]{36}$/i.test(stored.key)) {
        pending.current = { fingerprint: stored.fingerprint, key: stored.key };
      }
    } catch { /* In-page retries still use the in-memory key. */ }
  }, [pendingStorageKey]);

  useEffect(() => {
    if (!pending.current || !effects.some(item => item.id === pending.current?.key &&
      ["succeeded", "failed", "cancelled"].includes(item.state))) return;
    pending.current = null;
    if (pendingStorageKey) {
      try { window.sessionStorage.removeItem(pendingStorageKey); }
      catch { /* Browser storage can be unavailable. */ }
    }
  }, [effects, pendingStorageKey]);

  useEffect(() => {
    let initialLocale: Locale = "en";
    let initialTheme: Theme = "light";
    try {
      initialLocale = localStorage.getItem("ailoom.locale") === "fa" ? "fa" : "en";
      initialTheme = localStorage.getItem("ailoom.theme") === "dark" ? "dark" : "light";
    } catch { /* Browser storage may be unavailable. */ }
    document.documentElement.lang = initialLocale;
    document.documentElement.dir = initialLocale === "fa" ? "rtl" : "ltr";
    document.documentElement.dataset.theme = initialTheme;
    setLocale(initialLocale);
    setTheme(initialTheme);
    setPreferencesLoaded(true);
  }, []);
  useEffect(() => {
    if (!preferencesLoaded) return;
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "fa" ? "rtl" : "ltr";
    try { localStorage.setItem("ailoom.locale", locale); } catch { /* Ignore storage denial. */ }
  }, [locale, preferencesLoaded]);
  useEffect(() => {
    if (!preferencesLoaded) return;
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("ailoom.theme", theme); } catch { /* Ignore storage denial. */ }
  }, [theme, preferencesLoaded]);

  const refresh = useCallback(async (quiet = false) => {
    if (!signedIn) return;
    try {
      const response = await fetch("/api/audio/effects", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Could not load effects.");
      const body = await response.json();
      setEffects(Array.isArray(body?.effects) ? body.effects : []);
    } catch { if (!quiet) setError(copy[locale].requestFailed); }
  }, [signedIn, locale]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!signedIn || !effects.some(item => ["queued", "submitting", "running"].includes(item.state))) return;
    const timer = setInterval(() => void refresh(true), 5000);
    return () => clearInterval(timer);
  }, [signedIn, effects, refresh]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const description = prompt.trim();
    if (!description || description.length > 4000) { setError(t.promptRequired); return; }
    if (busy) return;
    const input: EffectInput = modelId === ELEVEN_MODEL_ID
      ? { modelId, operation: "text_to_sound_effect", prompt: description, durationSec,
        outputFormat: "mp3", loop, promptInfluence }
      : { modelId, operation: "text_to_sound_effect", prompt: description, durationSec, outputFormat,
        ...(negativePrompt.trim() ? { negativePrompt: negativePrompt.trim() } : {}),
        ...(seed.trim() ? { seed: Number(seed) } : {}) };
    const fingerprint = JSON.stringify(input);
    const key = pending.current?.fingerprint === fingerprint ? pending.current.key : crypto.randomUUID();
    pending.current = { fingerprint, key };
    if (pendingStorageKey) {
      try { window.sessionStorage.setItem(pendingStorageKey, JSON.stringify(pending.current)); }
      catch { /* In-page retries still use the in-memory key. */ }
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/audio/effects", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: fingerprint });
      if (!response.ok) {
        if (response.status === 422 || response.status === 409 || response.status === 400) {
          pending.current = null;
          if (pendingStorageKey) {
            try { window.sessionStorage.removeItem(pendingStorageKey); }
            catch { /* The in-memory key is already cleared. */ }
          }
        }
        throw new Error(await responseError(response));
      }
      pending.current = null;
      if (pendingStorageKey) {
        try { window.sessionStorage.removeItem(pendingStorageKey); }
        catch { /* The in-memory key is already cleared. */ }
      }
      setNotice(t.queued);
      await refresh(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t.requestFailed); }
    finally { setBusy(false); }
  };

  return <main className={styles.page} style={{ visibility: preferencesLoaded ? "visible" : "hidden" }}>
    <header className={styles.header}>
      <a className={styles.brand} href="/">Ailoom</a>
      <div className={styles.controls}>
        <button type="button" onClick={() => setLocale(locale === "en" ? "fa" : "en")}>{locale === "en" ? "فارسی" : "English"}</button>
        <button type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? t.dark : t.light}</button>
      </div>
    </header>
    <div className={styles.content}>
      <a href="/#audio" className={styles.back}>← {t.back}</a>
      <div className={styles.intro}><p>{t.eyebrow}</p><h1>{t.title}</h1><span>{t.subtitle}</span></div>
      {!signedIn ? <section className={styles.card}><p>{t.signIn}</p><a className={styles.action} href="/#audio">{t.back}</a></section> : <>
        <div className={styles.meta}><span>{t.signedIn} {name}</span><span>{t.provider}</span></div>
        {(error || notice) && <p className={error ? styles.error : styles.notice} role={error ? "alert" : "status"}>{error || notice}</p>}
        <section className={styles.card} aria-labelledby="effects-form-title">
          <div className={styles.cardHeading}><div><small>{t.formEyebrow}</small><h2 id="effects-form-title">{t.formTitle}</h2></div><span className={styles.modelBadge}>SFX</span></div>
          <form onSubmit={event => void create(event)}>
            <label htmlFor="effect-model">{t.model}<ThemedSelect id="effect-model" value={modelId} onValueChange={value => {
              setModelId(value as EffectInput["modelId"]);
              if (value === ELEVEN_MODEL_ID && durationSec > 22) setDurationSec(20);
            }}>
              <option value={STABLE_MODEL_ID}>Stable Audio 3 Small SFX · fal</option>
              <option value={ELEVEN_MODEL_ID}>ElevenLabs Sound Effects v2 · fal</option>
            </ThemedSelect></label>
            <label htmlFor="effect-prompt">{t.prompt}</label>
            <textarea id="effect-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={4000} rows={5}
              placeholder={t.placeholder} dir={/[\u0590-\u08ff]/.test(prompt) ? "rtl" : "ltr"} />
            <p className={styles.label}>{t.examples}</p>
            <div className={styles.presets}>{presets.map(item => <button key={item.en} type="button" onClick={() => setPrompt(item.prompt)}>{item[locale]}</button>)}</div>
            <div className={styles.settings}>
              <label htmlFor="effect-duration">{t.duration}<ThemedSelect id="effect-duration" value={durationSec} onValueChange={value => setDurationSec(Number(value))}>
                {(modelId === ELEVEN_MODEL_ID ? [5, 10, 20, 22] : [5, 10, 20, 30])
                  .map(seconds => <option key={seconds} value={seconds}>{seconds} {t.seconds}</option>)}</ThemedSelect></label>
              {modelId === STABLE_MODEL_ID ? <label htmlFor="effect-format">{t.format}<ThemedSelect id="effect-format" value={outputFormat} onValueChange={value => setOutputFormat(value as "mp3" | "wav")}><option value="mp3">MP3</option><option value="wav">WAV</option></ThemedSelect></label>
                : <label htmlFor="effect-influence">{t.influence}<input id="effect-influence" type="number" min={0} max={1} step={0.1} value={promptInfluence} onChange={event => setPromptInfluence(Number(event.target.value))} /></label>}
            </div>
            {modelId === STABLE_MODEL_ID ? <div className={styles.settings}>
              <label htmlFor="effect-negative">{t.avoid}<input id="effect-negative" value={negativePrompt} onChange={event => setNegativePrompt(event.target.value)} maxLength={1000} placeholder={t.avoidPlaceholder} /></label>
              <label htmlFor="effect-seed">{t.seed}<input id="effect-seed" type="number" min={0} max={2147483647} step={1} value={seed} onChange={event => setSeed(event.target.value)} placeholder={t.seedHint} /></label>
            </div> : <label className={styles.checkbox}><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} />{t.loop}</label>}
            <div className={styles.submitRow}><button className={styles.action} type="submit" disabled={busy}>{busy ? t.creating : t.create}</button><p>{t.cost}</p></div>
          </form>
          <div className={styles.disclosure}><p>{t.private}</p><a href={modelDocs[modelId]} target="_blank" rel="noreferrer">{t.source} ↗</a></div>
        </section>
        <section className={styles.library} aria-labelledby="effects-list-title">
          <div className={styles.libraryHeading}><div><small>{t.libraryEyebrow}</small><h2 id="effects-list-title">{t.list}</h2></div><button type="button" onClick={() => void refresh()}>{t.refresh}</button></div>
          {!effects.length ? <p className={styles.empty}>{t.empty}</p> : <ul className={styles.list}>{effects.map(item => {
            const audioUrl = privateAudioUrl(item.output);
            return <li key={item.id} className={styles.effect}>
              <div className={styles.effectTop}><span className={styles.soundGlyph} aria-hidden="true">◍</span><div><strong>{new Date(item.createdAt).toLocaleString(locale)}</strong><small>{item.providerModel === ELEVEN_MODEL_ID ? "ElevenLabs SFX v2" : "Stable Audio 3 Small SFX"} · {item.id.slice(0, 8)}</small></div><span className={styles.state} data-state={item.state}>{t[item.state]}</span></div>
              {audioUrl && <div className={styles.player}><audio controls preload="none" src={audioUrl} /><a href={audioUrl} download>{t.download} ↗</a></div>}
              {item.state === "failed" && <p className={styles.failure}>{item.errorCode === "submission_uncertain" ? t.uncertain : item.errorCode === "output_import_failed" ? t.retryDownload : t.genericFailure}</p>}
            </li>;
          })}</ul>}
        </section>
      </>}
    </div>
  </main>;
}
