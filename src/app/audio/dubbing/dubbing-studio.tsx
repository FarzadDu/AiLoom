"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { DUBBING_LANGUAGES } from "@/server/dubbing/languages";
import { ThemedSelect } from "@/components/themed-select";
import styles from "./dubbing.module.css";

type Locale = "en" | "fa";
type Theme = "light" | "dark";
type Asset = { id: string; kind: "audio" | "video"; visibility: "private" | "public";
  originalName: string | null; sizeBytes: number; url: string };
type Dub = { id: string; sourceAssetId: string; sourceKind: "audio" | "video";
  sourceLanguage: string | null; targetLanguage: string;
  state: "queued" | "submitting" | "running" | "importing" | "ready" | "failed" | "uncertain";
  errorCode: string | null; outputUrl: string | null; createdAt: string };

const common = ["en", "fa", "es", "fr", "de", "ar", "pt", "it", "ja", "ko", "tr", "hi", "zh"];
const orderedLanguages = [...common, ...DUBBING_LANGUAGES.filter(code => !common.includes(code))];
const copy = {
  en: {
    back: "Back to Ailoom", eyebrow: "AUDIO / DUBBING", title: "Your story, in another language.",
    subtitle: "Translate a private recording or video with ElevenLabs Dubbing v2. Your finished dub returns as a private lossless audio track.",
    signIn: "Sign in on the home page to use your private media library.",
    signedIn: "Signed in as", refresh: "Refresh", newDub: "Create a dub", source: "Source recording or video",
    choose: "Choose a private file", noSource: "No private audio or video yet. Upload a file to begin.",
    upload: "Upload source", uploadHint: "MP3, WAV, OGG, FLAC, MP4 or WebM · up to 100 MB.",
    uploading: "Uploading…", sourceLanguage: "Source language", auto: "Detect automatically",
    targetLanguage: "Target language", submit: "Start dubbing", working: "Queuing…",
    providerNote: "ElevenLabs receives a short-lived private link to the selected file. Creating a dubbing project prepays one language and may charge your provider account immediately.",
    outputNote: "Dubbing v2 returns a lossless audio track, even for video input. A dubbed video file is not produced here. The provider may use a replacement voice if cloning is not permitted. Imported output is limited to 100 MB.",
    jobs: "Your private dubs", noJobs: "No dubs yet.", download: "Download lossless audio",
    sourceVideo: "Video source", sourceAudio: "Audio source", output: "Dubbed audio",
    checkProvider: "Check provider", checkingProvider: "Checking…", notFound: "No matching provider project was found yet. This request was not sent again.",
    queued: "Queued", submitting: "Submitting", running: "Dubbing", importing: "Saving private output",
    ready: "Ready", failed: "Failed", uncertain: "Check provider",
    uncertainNote: "The paid request's outcome is uncertain. Ailoom will not submit it twice. Check the matching Ailoom request in ElevenLabs before starting another.",
    sourceUnavailable: "The source file could not be reached from the public HTTPS site.",
    providerRejected: "ElevenLabs rejected this request.", outputUnavailable: "The lossless output could not be saved within the 100 MB limit.",
    providerFailed: "ElevenLabs could not finish this dub.", retrying: "Ailoom is retrying the private download with a fresh provider link.",
    chooseFirst: "Choose a private source file.", requestFailed: "The request could not be completed. Refresh the list before trying again.",
    uploadFailed: "The source upload failed.", english: "English", persian: "فارسی", light: "Light", dark: "Dark"
  },
  fa: {
    back: "بازگشت به Ailoom", eyebrow: "صدا / دوبله", title: "داستانت، به زبانی دیگر.",
    subtitle: "با Dubbing v2 از ElevenLabs فایل صوتی یا ویدئوی خصوصی‌ات را ترجمه کن. خروجی به‌صورت فایل صوتی بدون افت کیفیت و خصوصی ذخیره می‌شود.",
    signIn: "برای استفاده از کتابخانهٔ خصوصی رسانه در صفحهٔ اصلی وارد شو.",
    signedIn: "واردشده با نام", refresh: "تازه‌سازی", newDub: "ساخت دوبله", source: "فایل صوتی یا ویدئوی منبع",
    choose: "فایل خصوصی را انتخاب کن", noSource: "هنوز فایل صوتی یا ویدئوی خصوصی نداری. اول یک فایل بارگذاری کن.",
    upload: "بارگذاری منبع", uploadHint: "MP3، WAV، OGG، FLAC، MP4 یا WebM · حداکثر ۱۰۰ مگابایت.",
    uploading: "در حال بارگذاری…", sourceLanguage: "زبان منبع", auto: "تشخیص خودکار",
    targetLanguage: "زبان مقصد", submit: "شروع دوبله", working: "در حال ثبت…",
    providerNote: "ElevenLabs لینک خصوصی کوتاه‌مدت فایل انتخاب‌شده را دریافت می‌کند. ساخت پروژه هزینهٔ یک زبان را پیش‌پرداخت می‌کند و ممکن است همان لحظه از حساب سرویس‌دهنده کم شود.",
    outputNote: "Dubbing v2 حتی برای ویدئو فقط یک فایل صوتی بدون افت کیفیت برمی‌گرداند. اینجا فایل ویدئوی دوبله‌شده ساخته نمی‌شود. اگر شبیه‌سازی صدا مجاز نباشد، سرویس‌دهنده ممکن است از صدای جایگزین استفاده کند. سقف ذخیرهٔ خروجی ۱۰۰ مگابایت است.",
    jobs: "دوبله‌های خصوصی تو", noJobs: "هنوز دوبله‌ای نداری.", download: "دانلود صدای بدون افت کیفیت",
    sourceVideo: "منبع ویدئویی", sourceAudio: "منبع صوتی", output: "صدای دوبله‌شده",
    checkProvider: "بررسی در ElevenLabs", checkingProvider: "در حال بررسی…", notFound: "هنوز پروژهٔ مطابق در سرویس‌دهنده پیدا نشد. این درخواست دوباره فرستاده نشد.",
    queued: "در صف", submitting: "در حال ارسال", running: "در حال دوبله", importing: "در حال ذخیرهٔ خصوصی",
    ready: "آماده", failed: "ناموفق", uncertain: "بررسی در سرویس‌دهنده",
    uncertainNote: "نتیجهٔ درخواست هزینه‌دار نامشخص است. Ailoom آن را دوباره نمی‌فرستد. پیش از ساخت درخواست تازه، پروژهٔ مطابق را در ElevenLabs بررسی کن.",
    sourceUnavailable: "سایت HTTPS به فایل منبع دسترسی نداشت.",
    providerRejected: "ElevenLabs این درخواست را رد کرد.", outputUnavailable: "خروجی بدون افت کیفیت در سقف ۱۰۰ مگابایت قابل ذخیره نبود.",
    providerFailed: "ElevenLabs نتوانست دوبله را کامل کند.", retrying: "Ailoom با لینک تازهٔ سرویس‌دهنده، دانلود خصوصی را دوباره امتحان می‌کند.",
    chooseFirst: "یک فایل منبع خصوصی انتخاب کن.", requestFailed: "درخواست کامل نشد. پیش از تلاش دوباره فهرست را تازه کن.",
    uploadFailed: "بارگذاری فایل منبع ناموفق بود.", english: "English", persian: "فارسی", light: "روشن", dark: "تیره"
  }
} as const;

async function responseError(response: Response): Promise<string> {
  try { const payload = await response.json(); if (typeof payload?.error === "string") return payload.error; }
  catch { /* Use a generic error. */ }
  return "Request failed.";
}

function languageName(code: string, locale: Locale): string {
  try { return `${new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code} · ${code}`; }
  catch { return code; }
}

export default function DubbingStudio({ signedIn, name }: { signedIn: boolean; name: string }) {
  const [locale, setLocale] = useState<Locale>("en");
  const [theme, setTheme] = useState<Theme>("light");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [jobs, setJobs] = useState<Dub[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("fa");
  const [busy, setBusy] = useState<"upload" | "dub" | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestRef = useRef<{ sourceId: string; sourceLanguage: string; targetLanguage: string; key: string } | null>(null);
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
      const [assetResponse, jobResponse] = await Promise.all([
        fetch("/api/assets?limit=200", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/audio/dubbing", { credentials: "same-origin", cache: "no-store" })
      ]);
      if (!assetResponse.ok || !jobResponse.ok) throw new Error("Unavailable");
      const [assetData, jobData] = await Promise.all([assetResponse.json(), jobResponse.json()]);
      setAssets((Array.isArray(assetData?.assets) ? assetData.assets : []).filter((asset: Asset) =>
        asset.visibility === "private" && (asset.kind === "audio" || asset.kind === "video") &&
        asset.sizeBytes > 0 && asset.sizeBytes <= 100_000_000));
      setJobs(Array.isArray(jobData?.jobs) ? jobData.jobs : []);
    } catch { setError(copy[locale].requestFailed); }
  }, [signedIn, locale]);
  useEffect(() => { void refresh(); }, [refresh]);
  const hasActive = jobs.some(job => ["queued", "submitting", "running", "importing"].includes(job.state));
  useEffect(() => {
    if (!signedIn || !hasActive) return;
    const timer = window.setInterval(() => { void refresh(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [signedIn, hasActive, refresh]);
  const selectedAsset = useMemo(() => assets.find(asset => asset.id === sourceId) ?? null, [assets, sourceId]);
  const selectedId = selectedAsset ? sourceId : assets[0]?.id ?? "";

  async function uploadSource(file: File) {
    if (busy) return;
    if (file.size < 1 || file.size > 100_000_000) { setError(t.uploadHint); return; }
    setBusy("upload"); setError(""); setNotice("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/assets", { method: "POST", credentials: "same-origin", body: form });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = await response.json();
      if (!payload?.asset?.id || !["audio", "video"].includes(payload.asset.kind)) throw new Error(t.uploadFailed);
      setSourceId(payload.asset.id);
      await refresh();
      setNotice(file.name);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t.uploadFailed); }
    finally { setBusy(null); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!selectedId) { setError(t.chooseFirst); return; }
    const prior = requestRef.current;
    const key = prior?.sourceId === selectedId && prior.sourceLanguage === sourceLanguage &&
      prior.targetLanguage === targetLanguage ? prior.key : crypto.randomUUID();
    requestRef.current = { sourceId: selectedId, sourceLanguage, targetLanguage, key };
    setBusy("dub"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/audio/dubbing", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ sourceAssetId: selectedId, sourceLanguage: sourceLanguage || null, targetLanguage }) });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = await response.json();
      if (payload?.job?.id) setNotice(copy[locale][payload.job.state as keyof typeof t] as string || t.queued);
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : t.requestFailed); }
    finally { setBusy(null); }
  }

  async function checkProvider(id: string) {
    if (checkingId) return;
    setCheckingId(id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/audio/dubbing/${encodeURIComponent(id)}/refresh`, {
        method: "POST", credentials: "same-origin"
      });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = await response.json();
      setNotice(payload?.found ? t.running : t.notFound);
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : t.requestFailed); }
    finally { setCheckingId(null); }
  }

  function detail(job: Dub) {
    if (job.state === "uncertain") return t.uncertainNote;
    if (job.errorCode === "source_unavailable") return t.sourceUnavailable;
    if (job.errorCode === "provider_rejected") return t.providerRejected;
    if (job.errorCode === "output_unavailable") return t.outputUnavailable;
    if (job.errorCode === "provider_retrying") return t.retrying;
    if (job.state === "failed") return t.providerFailed;
    return "";
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <a className={styles.brand} href="/">Ailoom</a>
      <div className={styles.controls}>
        <button type="button" onClick={() => setLocale(locale === "en" ? "fa" : "en")} aria-label="Switch language">{locale === "en" ? t.persian : t.english}</button>
        <button type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label="Switch theme">{theme === "light" ? t.dark : t.light}</button>
      </div>
    </header>
    <div className={styles.content}>
      <a className={styles.back} href="/">← {t.back}</a>
      <section className={styles.intro}><p>{t.eyebrow}</p><h1>{t.title}</h1><span>{t.subtitle}</span></section>
      {!signedIn ? <section className={styles.card}><p>{t.signIn}</p><a className={styles.action} href="/">{t.back}</a></section> : <>
        <div className={styles.meta}><span>{t.signedIn}: {name}</span><button type="button" onClick={() => void refresh()}>{t.refresh}</button></div>
        {error && <div className={styles.error} role="alert">{error}</div>}
        {notice && <div className={styles.notice} role="status">{notice}</div>}
        <div className={styles.grid}>
          <section className={styles.card}>
            <h2>{t.newDub}</h2>
            <form onSubmit={event => void submit(event)}>
              <label htmlFor="dub-source">{t.source}</label>
              <ThemedSelect id="dub-source" value={selectedId} onValueChange={setSourceId} disabled={Boolean(busy)}>
                {!assets.length && <option value="">{t.noSource}</option>}
                {assets.map(asset => <option key={asset.id} value={asset.id}>{asset.originalName || asset.id.slice(0, 8)} · {asset.kind === "video" ? t.sourceVideo : t.sourceAudio}</option>)}
              </ThemedSelect>
              <label htmlFor="dub-upload">{t.upload}</label>
              <input id="dub-upload" type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/flac,video/mp4,video/webm"
                onChange={event => { const file = event.target.files?.[0]; if (file) void uploadSource(file); event.currentTarget.value = ""; }} disabled={Boolean(busy)} />
              <p className={styles.hint}>{busy === "upload" ? t.uploading : t.uploadHint}</p>
              <div className={styles.languages}>
                <div><label htmlFor="dub-source-language">{t.sourceLanguage}</label>
                  <ThemedSelect id="dub-source-language" value={sourceLanguage} onValueChange={setSourceLanguage} disabled={Boolean(busy)}>
                    <option value="">{t.auto}</option>
                    {orderedLanguages.map(code => <option key={code} value={code}>{languageName(code, locale)}</option>)}
                  </ThemedSelect></div>
                <div><label htmlFor="dub-target-language">{t.targetLanguage}</label>
                  <ThemedSelect id="dub-target-language" value={targetLanguage} onValueChange={setTargetLanguage} disabled={Boolean(busy)}>
                    {orderedLanguages.map(code => <option key={code} value={code}>{languageName(code, locale)}</option>)}
                  </ThemedSelect></div>
              </div>
              <button className={styles.action} type="submit" disabled={Boolean(busy) || !selectedId}>{busy === "dub" ? t.working : t.submit}</button>
            </form>
          </section>
          <aside className={styles.card}>
            <h2>{t.output}</h2>
            {selectedAsset && (selectedAsset.kind === "video"
              ? <video className={styles.preview} controls preload="metadata" src={selectedAsset.url} />
              : <audio className={styles.audio} controls preload="metadata" src={selectedAsset.url} />)}
            <p className={styles.hint}>{t.providerNote}</p>
            <p className={styles.hint}>{t.outputNote}</p>
          </aside>
        </div>
        <section className={styles.results}><h2>{t.jobs}</h2>
          {!jobs.length ? <p>{t.noJobs}</p> : <ul className={styles.list}>{jobs.map(job => {
            const source = assets.find(item => item.id === job.sourceAssetId);
            return <li key={job.id}>
              <div className={styles.listTop}><strong>{source?.originalName || (job.sourceKind === "video" ? t.sourceVideo : t.sourceAudio)} → {languageName(job.targetLanguage, locale)}</strong><span data-state={job.state}>{t[job.state]}</span></div>
              {detail(job) && <p className={styles.hint}>{detail(job)}</p>}
              {job.state === "uncertain" && <button className={styles.check} type="button"
                disabled={checkingId === job.id} onClick={() => void checkProvider(job.id)}>
                {checkingId === job.id ? t.checkingProvider : t.checkProvider}
              </button>}
              {job.outputUrl && <><audio className={styles.audio} controls preload="metadata" src={job.outputUrl} /><a href={job.outputUrl} download={`ailoom-dub-${job.targetLanguage}.flac`}>{t.download}</a></>}
            </li>;
          })}</ul>}
        </section>
      </>}
    </div>
  </main>;
}
