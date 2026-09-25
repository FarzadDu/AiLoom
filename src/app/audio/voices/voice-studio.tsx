"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./voices.module.css";

type Locale = "en" | "fa";
type Theme = "light" | "dark";
type Voice = { id: string; name: string; state: "submitting" | "ready" | "verification_required" | "failed" | "uncertain"; createdAt: string };
type Speech = { id: string; cloneId: string; state: "submitting" | "ready" | "failed" | "uncertain"; outputUrl: string | null; createdAt: string };

const copy = {
  en: {
    back: "Back to Ailoom", title: "Your voices", subtitle: "Build an instant clone from a recording you own or have permission to use, then speak in your own voice.",
    signIn: "Sign in on the Ailoom home page to use private voice tools.",
    yourName: "Signed in as", refresh: "Refresh", create: "Create a voice", voiceName: "Voice name", namePlaceholder: "e.g. My narration voice",
    sample: "Voice recording", choose: "Choose MP3, WAV or OGG", sampleHint: "One clear 1–2 minute recording is recommended. Maximum file size: 20 MB. The sample is sent to ElevenLabs and is not stored by Ailoom.",
    consent: "I own this voice or have the speaker's permission to clone and use it.",
    createAction: "Create instant clone", working: "Working…", voices: "Saved voices", noVoices: "No voices yet.",
    speech: "Speak with a saved voice", selectVoice: "Voice", text: "Text to speak", textPlaceholder: "Write the words you want spoken…",
    generate: "Generate speech", noReady: "Create a ready voice before generating speech.", outputs: "Private speech outputs", noOutputs: "Your speech outputs will appear here.",
    providerNote: "ElevenLabs receives your recording or speech text when you submit. The resulting audio stays private in Ailoom. Your provider plan may charge for these requests.",
    verification: "Verification required in ElevenLabs before this voice can be used.",
    uncertain: "The provider outcome is uncertain. Check its status below; Ailoom will not submit the same request twice.",
    checkProvider: "Check in ElevenLabs", checkingProvider: "Checking…",
    notFound: "No matching voice was found yet. Check your ElevenLabs account before creating a new one.",
    unknownStatus: "The voice was found, but ElevenLabs has not reported a usable verification state yet.",
    failed: "The provider rejected this request.", submitting: "Submitting", ready: "Ready", verified: "Verification required", failedState: "Failed", uncertainState: "Check provider",
    sampleMissing: "Choose one valid recording up to 20 MB.", nameMissing: "Enter a voice name between 2 and 80 characters.",
    consentMissing: "Confirm your right or permission to use this voice.", textMissing: "Enter up to 5,000 characters of speech text.",
    requestFailed: "The request could not be completed. Refresh the list to check its status.",
    played: "Generated speech", english: "English", persian: "فارسی", light: "Light", dark: "Dark"
  },
  fa: {
    back: "بازگشت به Ailoom", title: "صداهای تو", subtitle: "از صدایی که متعلق به توست یا برای استفاده از آن اجازه داری، نمونهٔ فوری بساز و سپس متن را با همان صدا بخوان.",
    signIn: "برای استفاده از ابزارهای خصوصی صدا، در صفحهٔ اصلی Ailoom وارد شو.",
    yourName: "واردشده با نام", refresh: "تازه‌سازی", create: "ساخت صدای تازه", voiceName: "نام صدا", namePlaceholder: "مثلاً صدای گویندگی من",
    sample: "نمونهٔ صدا", choose: "انتخاب MP3، WAV یا OGG", sampleHint: "یک ضبط واضح ۱ تا ۲ دقیقه‌ای پیشنهاد می‌شود. حداکثر اندازهٔ فایل ۲۰ مگابایت است. نمونه به ElevenLabs فرستاده می‌شود و Ailoom آن را ذخیره نمی‌کند.",
    consent: "این صدا متعلق به من است یا برای شبیه‌سازی و استفاده از آن از صاحب صدا اجازه دارم.",
    createAction: "ساخت نسخهٔ فوری صدا", working: "در حال انجام…", voices: "صداهای ذخیره‌شده", noVoices: "هنوز صدایی ساخته نشده است.",
    speech: "گفتار با صدای ذخیره‌شده", selectVoice: "صدا", text: "متن گفتار", textPlaceholder: "متنی را که باید خوانده شود بنویس…",
    generate: "ساخت گفتار", noReady: "ابتدا یک صدای آماده بساز.", outputs: "خروجی‌های گفتار خصوصی", noOutputs: "خروجی‌های گفتار اینجا نمایش داده می‌شوند.",
    providerNote: "پس از ارسال، ElevenLabs نمونهٔ صدا یا متن گفتار را دریافت می‌کند. فایل صوتی حاصل در Ailoom خصوصی می‌ماند. ممکن است حساب سرویس‌دهنده برای این درخواست‌ها هزینه داشته باشد.",
    verification: "برای استفاده از این صدا باید تأیید آن را در ElevenLabs کامل کنی.",
    uncertain: "وضعیت درخواست نزد سرویس‌دهنده نامشخص است. از دکمهٔ بررسی وضعیت استفاده کن؛ Ailoom این درخواست را دوباره ارسال نمی‌کند.",
    checkProvider: "بررسی در ElevenLabs", checkingProvider: "در حال بررسی…",
    notFound: "هنوز صدای مطابق پیدا نشد. پیش از ساخت درخواست تازه، حساب ElevenLabs را بررسی کن.",
    unknownStatus: "صدا پیدا شد، اما ElevenLabs هنوز وضعیت تأیید قابل استفاده را گزارش نکرده است.",
    failed: "سرویس‌دهنده این درخواست را رد کرد.", submitting: "در حال ارسال", ready: "آماده", verified: "نیازمند تأیید", failedState: "ناموفق", uncertainState: "بررسی در سرویس‌دهنده",
    sampleMissing: "یک ضبط معتبر تا ۲۰ مگابایت انتخاب کن.", nameMissing: "نامی بین ۲ تا ۸۰ نویسه برای صدا وارد کن.",
    consentMissing: "حق یا اجازهٔ استفاده از این صدا را تأیید کن.", textMissing: "متن گفتار را با حداکثر ۵۰۰۰ نویسه وارد کن.",
    requestFailed: "درخواست کامل نشد. فهرست را تازه کن و وضعیت را بررسی کن.",
    played: "گفتار تولیدشده", english: "English", persian: "فارسی", light: "روشن", dark: "تیره"
  }
} as const;

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.error === "string") return body.error;
  } catch { /* Keep the generic message. */ }
  return "Request failed.";
}

export default function VoiceStudio({ signedIn, name }: { signedIn: boolean; name: string }) {
  const [locale, setLocale] = useState<Locale>("en");
  const [theme, setTheme] = useState<Theme>("light");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [voiceName, setVoiceName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [speech, setSpeech] = useState<Speech[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("");
  const [spokenText, setSpokenText] = useState("");
  const [busy, setBusy] = useState<"clone" | "speech" | null>(null);
  const [checkingVoiceId, setCheckingVoiceId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cloneRequest = useRef<{ file: File; name: string; key: string } | null>(null);
  const speechRequest = useRef<{ voiceId: string; text: string; key: string } | null>(null);
  const t = copy[locale];

  useEffect(() => {
    try {
      setLocale(localStorage.getItem("ailoom.locale") === "fa" ? "fa" : "en");
      setTheme(localStorage.getItem("ailoom.theme") === "dark" ? "dark" : "light");
    } catch { /* Private browser mode may disable local storage. */ }
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

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    try {
      const [voiceResponse, speechResponse] = await Promise.all([
        fetch("/api/audio/voices", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/audio/voices/speech", { credentials: "same-origin", cache: "no-store" })
      ]);
      if (!voiceResponse.ok || !speechResponse.ok) throw new Error("Could not load private voices.");
      const [voiceBody, speechBody] = await Promise.all([voiceResponse.json(), speechResponse.json()]);
      setVoices(Array.isArray(voiceBody?.voices) ? voiceBody.voices : []);
      setSpeech(Array.isArray(speechBody?.speech) ? speechBody.speech : []);
    } catch { setError(copy[locale].requestFailed); }
  }, [signedIn, locale]);
  useEffect(() => { void refresh(); }, [refresh]);
  const readyVoices = voices.filter(voice => voice.state === "ready");
  const effectiveVoiceId = readyVoices.some(voice => voice.id === selectedVoice)
    ? selectedVoice : readyVoices[0]?.id ?? "";
  const voiceNames = new Map(voices.map(voice => [voice.id, voice.name]));
  const statusName = (state: Voice["state"] | Speech["state"]) => state === "ready" ? t.ready
    : state === "submitting" ? t.submitting : state === "verification_required" ? t.verified
    : state === "uncertain" ? t.uncertainState : t.failedState;

  const createVoice = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = voiceName.trim();
    if (trimmed.length < 2 || trimmed.length > 80) { setError(t.nameMissing); return; }
    if (!file || !["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg"].includes(file.type) ||
      file.size === 0 || file.size > 20_000_000) { setError(t.sampleMissing); return; }
    if (!consent) { setError(t.consentMissing); return; }
    if (busy) return;
    const prior = cloneRequest.current;
    const key = prior?.file === file && prior.name === trimmed ? prior.key : crypto.randomUUID();
    cloneRequest.current = { file, name: trimmed, key };
    setBusy("clone"); setError(""); setNotice("");
    try {
      const form = new FormData();
      form.set("name", trimmed);
      form.set("file", file);
      form.set("consent", "true");
      const response = await fetch("/api/audio/voices", { method: "POST", credentials: "same-origin",
        headers: { "Idempotency-Key": key }, body: form });
      if (!response.ok) {
        if (response.status === 422) cloneRequest.current = null;
        throw new Error(await responseError(response));
      }
      const body = await response.json();
      const state = body?.voice?.state as Voice["state"] | undefined;
      setNotice(state === "uncertain" ? t.uncertain : state === "verification_required" ? t.verification :
        state === "failed" ? t.failed : state === "ready" ? t.ready : t.submitting);
      if (state === "ready" || state === "verification_required") {
        cloneRequest.current = null; setFile(null); setConsent(false); setVoiceName("");
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
      if (state === "failed") cloneRequest.current = null;
    } catch (failure) { setError(failure instanceof Error ? failure.message : t.requestFailed); }
    finally { setBusy(null); void refresh(); }
  };

  const createSpeech = async (event: FormEvent) => {
    event.preventDefault();
    const text = spokenText.trim();
    if (!effectiveVoiceId) { setError(t.noReady); return; }
    if (!text || text.length > 5000) { setError(t.textMissing); return; }
    if (busy) return;
    const prior = speechRequest.current;
    const key = prior?.voiceId === effectiveVoiceId && prior.text === text ? prior.key : crypto.randomUUID();
    speechRequest.current = { voiceId: effectiveVoiceId, text, key };
    setBusy("speech"); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/audio/voices/${encodeURIComponent(effectiveVoiceId)}/speech`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ text })
      });
      if (!response.ok) {
        if (response.status === 422) speechRequest.current = null;
        throw new Error(await responseError(response));
      }
      const body = await response.json();
      const state = body?.speech?.state as Speech["state"] | undefined;
      setNotice(state === "ready" ? t.ready : state === "uncertain" ? t.uncertain :
        state === "failed" ? t.failed : t.submitting);
      if (state === "ready" || state === "failed") speechRequest.current = null;
    } catch (failure) { setError(failure instanceof Error ? failure.message : t.requestFailed); }
    finally { setBusy(null); void refresh(); }
  };

  const checkVoice = async (id: string) => {
    if (checkingVoiceId) return;
    setCheckingVoiceId(id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/audio/voices/${encodeURIComponent(id)}/refresh`, {
        method: "POST", credentials: "same-origin"
      });
      if (!response.ok) throw new Error(await responseError(response));
      const body = await response.json();
      setNotice(body?.matched === false ? t.notFound : body?.voice?.state === "ready" ? t.ready :
        body?.voice?.state === "verification_required" ? t.verification : t.unknownStatus);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t.requestFailed); }
    finally { setCheckingVoiceId(null); void refresh(); }
  };

  return <main className={styles.page}>
    <header className={styles.header}>
      <a className={styles.brand} href="/">Ailoom</a>
      <div className={styles.controls}>
        <button type="button" onClick={() => setLocale(locale === "en" ? "fa" : "en")} aria-label={locale === "en" ? t.persian : t.english}>{locale === "en" ? "فارسی" : "English"}</button>
        <button type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={theme === "light" ? t.dark : t.light}>{theme === "light" ? t.dark : t.light}</button>
      </div>
    </header>
    <div className={styles.content}>
      <a className={styles.back} href="/#audio">← {t.back}</a>
      <div className={styles.intro}><p>VOICE STUDIO / 01</p><h1>{t.title}</h1><span>{t.subtitle}</span></div>
      {!signedIn ? <section className={styles.card}><p>{t.signIn}</p><a className={styles.action} href="/#audio">{t.back}</a></section> : <>
        <div className={styles.meta}><span>{t.yourName} {name}</span><button type="button" onClick={() => void refresh()}>{t.refresh}</button></div>
        {(error || notice) && <p className={error ? styles.error : styles.notice} role={error ? "alert" : "status"}>{error || notice}</p>}
        <div className={styles.grid}>
          <section className={styles.card} aria-labelledby="clone-title"><h2 id="clone-title">{t.create}</h2>
            <form onSubmit={event => void createVoice(event)}>
              <label htmlFor="voice-name">{t.voiceName}</label><input id="voice-name" value={voiceName} onChange={event => setVoiceName(event.target.value)} maxLength={80} placeholder={t.namePlaceholder} />
              <label htmlFor="voice-file">{t.sample}</label><input id="voice-file" ref={fileInputRef} type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg" onChange={event => setFile(event.target.files?.[0] ?? null)} />
              {file && <small className={styles.filename}>{file.name}</small>}
              <p className={styles.hint}>{t.sampleHint}</p>
              <label className={styles.consent}><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>{t.consent}</span></label>
              <button className={styles.action} type="submit" disabled={Boolean(busy)}>{busy === "clone" ? t.working : t.createAction}</button>
            </form>
          </section>
          <section className={styles.card} aria-labelledby="speech-title"><h2 id="speech-title">{t.speech}</h2>
            <form onSubmit={event => void createSpeech(event)}>
              <label htmlFor="speech-voice">{t.selectVoice}</label><select id="speech-voice" value={effectiveVoiceId} onChange={event => setSelectedVoice(event.target.value)} disabled={!readyVoices.length}>{readyVoices.length ? readyVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>) : <option value="">{t.noReady}</option>}</select>
              <label htmlFor="speech-text">{t.text}</label><textarea id="speech-text" value={spokenText} onChange={event => setSpokenText(event.target.value)} maxLength={5000} dir={/[\u0590-\u08ff]/.test(spokenText) ? "rtl" : "ltr"} placeholder={t.textPlaceholder} rows={7} />
              <p className={styles.hint}>{t.providerNote}</p>
              <button className={styles.action} type="submit" disabled={Boolean(busy) || !readyVoices.length}>{busy === "speech" ? t.working : t.generate}</button>
            </form>
          </section>
        </div>
        <section className={styles.listSection}><h2>{t.voices}</h2>{!voices.length ? <p>{t.noVoices}</p> : <ul className={styles.list}>{voices.map(voice => <li key={voice.id}><strong>{voice.name}</strong><span>{statusName(voice.state)}</span>{voice.state === "verification_required" && <small>{t.verification}</small>}{voice.state === "uncertain" && <small>{t.uncertain}</small>}{(voice.state === "verification_required" || voice.state === "uncertain") && <button className={styles.check} type="button" disabled={Boolean(checkingVoiceId)} onClick={() => void checkVoice(voice.id)}>{checkingVoiceId === voice.id ? t.checkingProvider : t.checkProvider}</button>}</li>)}</ul>}</section>
        <section className={styles.listSection}><h2>{t.outputs}</h2>{!speech.length ? <p>{t.noOutputs}</p> : <ul className={styles.list}>{speech.map(item => <li key={item.id}><strong>{voiceNames.get(item.cloneId) ?? t.played}</strong><span>{statusName(item.state)}</span>{item.outputUrl && <audio controls preload="none" src={item.outputUrl} aria-label={t.played} />}{item.state === "uncertain" && <small>{t.uncertain}</small>}</li>)}</ul>}</section>
      </>}
    </div>
  </main>;
}
