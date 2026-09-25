"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./captions.module.css";

type Locale = "en" | "fa";
type Theme = "light" | "dark";
type VideoAsset = { id: string; kind: string; mimeType: string; originalName: string | null;
  sizeBytes: number; createdAt: string; url: string };
type RenderedAsset = { id: string; url: string; sizeBytes: number };

const words = {
  en: {
    back: "Back to Ailoom", title: "Make every word visible.",
    intro: "Burn English or Persian captions into a private copy of your video. The original stays untouched.",
    signIn: "Sign in to use your private video library and render captions.",
    signInLink: "Go to Ailoom", source: "Source video", library: "Choose from your library",
    chooseVideo: "Select a video", upload: "Or upload a video", uploading: "Uploading…",
    uploadHint: "MP4 or WebM · up to 75 MB · up to 2 minutes · 1080p",
    subtitles: "Captions", format: "Format", loadFile: "Load SRT or VTT file",
    paste: "Paste your subtitles here, or load a file. Up to 300 cues and 48 KB.",
    render: "Render private MP4", rendering: "Rendering captions…", result: "Your captioned video",
    download: "Download MP4", private: "Private by default", local: "Rendered locally",
    noVideo: "No videos in your library yet. Upload one to begin.",
    loadError: "Could not load your video library.", uploadError: "Could not upload this video.",
    formatError: "Choose an SRT or VTT file under 48 KB.", sizeError: "Choose an MP4 or WebM under 75 MB.",
    required: "Choose a source video and add captions first.", retry: "Rendering is still in progress. Please keep this page open.",
    renderError: "Could not render captions. Check the video and subtitle timing, then try again.",
    theme: "Change theme", language: "Language"
  },
  fa: {
    back: "بازگشت به Ailoom", title: "همهٔ واژه‌ها را دیدنی کن.",
    intro: "زیرنویس فارسی یا انگلیسی را روی یک نسخهٔ خصوصی از ویدیو ثبت کن. فایل اصلی دست‌نخورده می‌ماند.",
    signIn: "برای استفاده از ویدیوهای خصوصی و ساخت زیرنویس وارد حساب شو.",
    signInLink: "رفتن به Ailoom", source: "ویدیوی اصلی", library: "انتخاب از کتابخانه",
    chooseVideo: "یک ویدیو انتخاب کن", upload: "یا ویدیو آپلود کن", uploading: "در حال آپلود…",
    uploadHint: "MP4 یا WebM · حداکثر ۷۵ مگابایت · ۲ دقیقه · وضوح 1080p",
    subtitles: "زیرنویس", format: "فرمت", loadFile: "بارگذاری فایل SRT یا VTT",
    paste: "زیرنویس را اینجا وارد کن یا فایل بارگذاری کن. تا ۳۰۰ بخش و ۴۸ کیلوبایت.",
    render: "ساخت MP4 خصوصی", rendering: "در حال ثبت زیرنویس…", result: "ویدیوی زیرنویس‌دار شما",
    download: "دانلود MP4", private: "خصوصی به صورت پیش‌فرض", local: "پردازش روی سرور خودمان",
    noVideo: "هنوز ویدیویی در کتابخانه نیست. برای شروع یکی آپلود کن.",
    loadError: "کتابخانهٔ ویدیو بارگذاری نشد.", uploadError: "ویدیو آپلود نشد.",
    formatError: "فایل SRT یا VTT زیر ۴۸ کیلوبایت انتخاب کن.", sizeError: "فایل MP4 یا WebM زیر ۷۵ مگابایت انتخاب کن.",
    required: "ابتدا ویدیو را انتخاب و زیرنویس را وارد کن.", retry: "پردازش هنوز ادامه دارد. این صفحه را باز نگه دار.",
    renderError: "ثبت زیرنویس انجام نشد. ویدیو و زمان‌بندی زیرنویس را بررسی و دوباره تلاش کن.",
    theme: "تغییر پوسته", language: "زبان"
  }
} as const;

function safeStored(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function saveStored(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* Private browsing may disable storage. */ }
}

export default function CaptionStudio({ signedIn }: { signedIn: boolean }) {
  const [locale, setLocale] = useState<Locale>("en");
  const [theme, setTheme] = useState<Theme>("light");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [assets, setAssets] = useState<VideoAsset[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [format, setFormat] = useState<"srt" | "vtt">("srt");
  const [captionText, setCaptionText] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RenderedAsset | null>(null);
  const requestRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const t = words[locale];

  useEffect(() => {
    const storedLocale = safeStored("ailoom.locale");
    const storedTheme = safeStored("ailoom.theme");
    if (storedLocale === "en" || storedLocale === "fa") setLocale(storedLocale);
    if (storedTheme === "light" || storedTheme === "dark") setTheme(storedTheme);
    setPreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "fa" ? "rtl" : "ltr";
    document.documentElement.dataset.theme = theme;
    saveStored("ailoom.locale", locale);
    saveStored("ailoom.theme", theme);
  }, [locale, theme, preferencesLoaded]);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    fetch("/api/assets?kind=video&limit=100", { credentials: "same-origin", cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Library unavailable");
        return response.json() as Promise<{ assets?: VideoAsset[] }>;
      })
      .then(payload => { if (active) setAssets(Array.isArray(payload.assets) ? payload.assets : []); })
      .catch(() => { if (active) setError(words[locale].loadError); });
    return () => { active = false; };
  }, [signedIn]);

  async function uploadVideo(file: File) {
    if (!["video/mp4", "video/webm"].includes(file.type) || file.size < 1 || file.size > 75_000_000) {
      setError(t.sizeError);
      return;
    }
    setUploadBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/assets", { method: "POST", body: form, credentials: "same-origin" });
      if (!response.ok) throw new Error("Upload failed");
      const payload = await response.json() as { asset?: VideoAsset };
      if (!payload.asset?.id) throw new Error("Upload missing asset");
      setAssets(previous => [payload.asset!, ...previous]);
      setSourceId(payload.asset.id);
      setResult(null);
    } catch { setError(t.uploadError); }
    finally { setUploadBusy(false); }
  }

  async function loadCaptionFile(file: File) {
    const extension = file.name.toLowerCase().split(".").at(-1);
    if ((extension !== "srt" && extension !== "vtt") || file.size < 1 || file.size > 48_000) {
      setError(t.formatError);
      return;
    }
    setFormat(extension);
    setCaptionText(await file.text());
    setResult(null);
    setError("");
  }

  async function render() {
    if (!sourceId || !captionText.trim()) { setError(t.required); return; }
    const input = { sourceAssetId: sourceId, format, text: captionText };
    const fingerprint = JSON.stringify(input);
    if (requestRef.current?.fingerprint !== fingerprint) {
      requestRef.current = { fingerprint, key: crypto.randomUUID() };
    }
    const key = requestRef.current.key;
    setBusy(true);
    setResult(null);
    setError("");
    try {
      for (let attempt = 0; attempt < 80; attempt++) {
        const response = await fetch("/api/video/captions", {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key },
          body: fingerprint
        });
        const payload = await response.json() as { status?: string; error?: string; asset?: RenderedAsset };
        if (response.status === 202) {
          await new Promise(done => setTimeout(done, 2500));
          continue;
        }
        if (!response.ok || !payload.asset?.id) throw new Error(payload.error || "Render failed");
        setResult(payload.asset);
        return;
      }
      setError(t.retry);
    } catch { setError(t.renderError); }
    finally { setBusy(false); }
  }

  const source = assets.find(asset => asset.id === sourceId);
  return <main className={styles.page} dir={locale === "fa" ? "rtl" : "ltr"}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <a className={styles.brand} href="/">Ailoom<span className={styles.brandDot}>.</span></a>
        <div className={styles.headerRight}>
          <a className={styles.back} href="/#video">{t.back}</a>
          <div className={styles.switch} role="group" aria-label={t.language}>
            <button type="button" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>EN</button>
            <button type="button" aria-pressed={locale === "fa"} onClick={() => setLocale("fa")}>فا</button>
          </div>
          <button className={styles.theme} type="button" aria-label={t.theme}
            onClick={() => setTheme(value => value === "light" ? "dark" : "light")}>{theme === "light" ? "◐" : "☼"}</button>
        </div>
      </header>
      <div className={styles.hero}>
        <div className={styles.eyebrow}><span className={styles.spark} /> AILOOM / VIDEO TOOLS</div>
        <h1>{t.title}</h1>
        <p>{t.intro}</p>
        <div className={styles.notes}><span>{t.private}</span><span>{t.local}</span></div>
      </div>
      {!signedIn ? <section className={styles.card}>
        <p>{t.signIn}</p><a className={styles.primaryLink} href="/">{t.signInLink} ↗</a>
      </section> : <div className={styles.grid}>
        <section className={styles.card} aria-label={t.source}>
          <div className={styles.sectionHead}><span>01</span><h2>{t.source}</h2></div>
          <label className={styles.label} htmlFor="caption-source">{t.library}</label>
          <select id="caption-source" className={styles.select} value={sourceId}
            onChange={event => { setSourceId(event.target.value); setResult(null); }}>
            <option value="">{t.chooseVideo}</option>
            {assets.map(asset => <option key={asset.id} value={asset.id}>
              {asset.originalName || `${new Date(asset.createdAt).toLocaleDateString(locale)} · ${asset.id.slice(0, 8)}`}
            </option>)}
          </select>
          {!assets.length && <p className={styles.hint}>{t.noVideo}</p>}
          <label className={styles.fileLabel} htmlFor="caption-video-upload">
            <span className={styles.fileIcon}>＋</span>{uploadBusy ? t.uploading : t.upload}
          </label>
          <input className={styles.hiddenInput} id="caption-video-upload" type="file"
            accept="video/mp4,video/webm" disabled={uploadBusy || busy}
            onChange={event => { const file = event.target.files?.[0]; if (file) void uploadVideo(file); event.target.value = ""; }} />
          <p className={styles.hint}>{t.uploadHint}</p>
          {source && <video className={styles.preview} controls preload="metadata" src={source.url} />}
        </section>
        <section className={styles.card} aria-label={t.subtitles}>
          <div className={styles.sectionHead}><span>02</span><h2>{t.subtitles}</h2></div>
          <div className={styles.formatRow}>
            <label className={styles.label} htmlFor="caption-format">{t.format}</label>
            <select id="caption-format" className={styles.select} value={format}
              onChange={event => { setFormat(event.target.value as "srt" | "vtt"); setResult(null); }}>
              <option value="srt">SRT</option><option value="vtt">WebVTT</option>
            </select>
          </div>
          <label className={styles.fileLabel} htmlFor="caption-text-upload">
            <span className={styles.fileIcon}>⇧</span>{t.loadFile}
          </label>
          <input className={styles.hiddenInput} id="caption-text-upload" type="file"
            accept=".srt,.vtt,text/vtt,text/plain" disabled={busy}
            onChange={event => { const file = event.target.files?.[0]; if (file) void loadCaptionFile(file); event.target.value = ""; }} />
          <textarea className={styles.textarea} value={captionText} placeholder={t.paste}
            onChange={event => { setCaptionText(event.target.value); setResult(null); }}
            dir="auto" spellCheck={false} rows={10} disabled={busy} />
          <button type="button" className={styles.renderButton} disabled={busy || uploadBusy}
            onClick={() => void render()}>{busy ? t.rendering : t.render}<span aria-hidden="true">↗</span></button>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </section>
      </div>}
      {result && <section className={`${styles.card} ${styles.result}`}>
        <div className={styles.sectionHead}><span>03</span><h2>{t.result}</h2></div>
        <video controls className={styles.output} src={result.url} />
        <a className={styles.primaryLink} href={result.url} download="ailoom-captioned.mp4">{t.download} ↗</a>
      </section>}
    </div>
  </main>;
}
