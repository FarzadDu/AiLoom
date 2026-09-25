"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./studio.module.css";

type Locale = "en" | "fa";
type Theme = "light" | "dark";
type State = "queued" | "submitting" | "running" | "importing" | "ready" | "failed" | "uncertain";
type Dataset = { id: string; sizeBytes: number; imageCount: number; createdAt: string };
type Model = { id: string; datasetId: string; name: string; triggerWord: string | null;
  steps: number; rank: number; state: State; errorCode: string | null; weightSizeBytes: number | null; createdAt: string };
type Inference = { id: string; modelId: string; prompt: string; scale: number; size: string;
  state: State; errorCode: string | null; outputUrl: string | null; createdAt: string };

const copy = {
  en: {
    back: "Back to Ailoom", eyebrow: "PERSONAL MODEL STUDIO", title: "Teach an image model your look.",
    intro: "Train a private FLUX Dev LoRA from your own image set, then use it to create new images.",
    signIn: "Sign in on the Ailoom home page to use your private models.",
    datasets: "Training datasets", upload: "Upload a ZIP", choose: "Choose ZIP archive",
    uploadHint: "Use 4–100 JPG, PNG or WebP images, with optional same-name .txt captions. ZIP limit: 100 MB. The dataset remains private in Ailoom; WaveSpeed receives a temporary download link when training starts.",
    train: "Train a LoRA", modelName: "Model name", modelNamePlaceholder: "e.g. My editorial style",
    dataset: "Dataset", trigger: "Trigger word", triggerHint: "Optional. Add this word to prompts to activate the LoRA.",
    steps: "Training steps", rank: "LoRA rank", trainButton: "Start training", noDatasets: "Upload a dataset first.",
    generate: "Generate with your LoRA", model: "Trained model", prompt: "Prompt", promptPlaceholder: "Describe the image you want…",
    scale: "LoRA strength", size: "Image size", generateButton: "Generate image", noReady: "Finish training a model first.",
    saved: "Your models", none: "No models yet.", outputs: "Private outputs", noOutputs: "Your images will appear here.",
    provider: "Training uses WaveSpeed FLUX Dev LoRA Trainer (listed from $1 per run). Images use WaveSpeed FLUX Dev LoRA (listed around $0.015 per image). Provider pricing may change and your WaveSpeed account is charged. Dataset ZIP, prompts and LoRA weights are sent to WaveSpeed through temporary URLs. Output weights and images are stored privately in Ailoom.",
    queued: "Queued", submitting: "Submitting", running: "Training / generating", importing: "Saving privately", ready: "Ready", failed: "Failed", uncertain: "Check provider",
    uncertainHelp: "The paid submission may have succeeded, but its prediction ID was not received. Ailoom will not submit it again. Check WaveSpeed history before creating another request.",
    reconcile: "Attach WaveSpeed prediction", prediction: "Prediction ID", attach: "Verify and attach", refresh: "Refresh",
    working: "Working…", error: "The request did not complete. Refresh to check its status.",
    english: "English", persian: "فارسی", light: "Light", dark: "Dark", download: "Download weights",
    fileMissing: "Choose a ZIP file up to 100 MB.", nameMissing: "Enter a model name with 2–80 characters.",
    promptMissing: "Enter a prompt with 2–4000 characters.", noDatasetSelected: "Select a dataset."
  },
  fa: {
    back: "بازگشت به Ailoom", eyebrow: "استودیوی مدل شخصی", title: "سبک خودت را به مدل تصویر یاد بده.",
    intro: "از مجموعهٔ عکس‌های خودت یک LoRA خصوصی برای FLUX Dev آموزش بده و با آن تصویرهای تازه بساز.",
    signIn: "برای استفاده از مدل‌های خصوصی، در صفحهٔ اصلی Ailoom وارد شو.",
    datasets: "مجموعه‌های آموزشی", upload: "بارگذاری ZIP", choose: "انتخاب فایل ZIP",
    uploadHint: "۴ تا ۱۰۰ تصویر JPG، PNG یا WebP قرار بده. فایل متنی هم‌نام برای توضیح هر تصویر اختیاری است. سقف ZIP: صد مگابایت. مجموعه در Ailoom خصوصی است؛ هنگام آموزش، WaveSpeed پیوند دانلود موقت دریافت می‌کند.",
    train: "آموزش LoRA", modelName: "نام مدل", modelNamePlaceholder: "مثلاً سبک مجلهٔ من",
    dataset: "مجموعهٔ تصاویر", trigger: "کلمهٔ فعال‌ساز", triggerHint: "اختیاری؛ آن را در پرامپت بنویس تا LoRA فعال شود.",
    steps: "گام‌های آموزش", rank: "رتبهٔ LoRA", trainButton: "شروع آموزش", noDatasets: "اول یک مجموعه بارگذاری کن.",
    generate: "تولید با LoRA", model: "مدل آموزش‌دیده", prompt: "پرامپت", promptPlaceholder: "تصویری را که می‌خواهی شرح بده…",
    scale: "قدرت LoRA", size: "اندازهٔ تصویر", generateButton: "تولید تصویر", noReady: "اول آموزش یک مدل را تمام کن.",
    saved: "مدل‌های تو", none: "هنوز مدلی وجود ندارد.", outputs: "خروجی‌های خصوصی", noOutputs: "تصویرهای تو اینجا ظاهر می‌شوند.",
    provider: "آموزش با WaveSpeed FLUX Dev LoRA Trainer انجام می‌شود (قیمت اعلام‌شده از ۱ دلار برای هر بار). تصویر با WaveSpeed FLUX Dev LoRA تولید می‌شود (حدود ۰٫۰۱۵ دلار برای هر تصویر). قیمت سرویس‌دهنده ممکن است تغییر کند و حساب WaveSpeed هزینه را می‌پردازد. ZIP، پرامپت و وزن‌های LoRA از راه پیوند موقت به WaveSpeed فرستاده می‌شوند. وزن‌ها و تصویرهای خروجی در Ailoom خصوصی ذخیره می‌شوند.",
    queued: "در صف", submitting: "در حال ارسال", running: "در حال آموزش / تولید", importing: "ذخیرهٔ خصوصی", ready: "آماده", failed: "ناموفق", uncertain: "بررسی سرویس‌دهنده",
    uncertainHelp: "ممکن است درخواست هزینه‌دار پذیرفته شده باشد ولی شناسه‌اش نرسیده باشد. Ailoom آن را دوباره ارسال نمی‌کند. پیش از درخواست تازه، تاریخچهٔ WaveSpeed را بررسی کن.",
    reconcile: "اتصال پیش‌بینی WaveSpeed", prediction: "شناسهٔ پیش‌بینی", attach: "بررسی و اتصال", refresh: "تازه‌سازی",
    working: "در حال انجام…", error: "درخواست کامل نشد. صفحه را تازه کن و وضعیت را ببین.",
    english: "English", persian: "فارسی", light: "روشن", dark: "تیره", download: "دریافت وزن‌ها",
    fileMissing: "یک ZIP تا صد مگابایت انتخاب کن.", nameMissing: "برای مدل نامی با ۲ تا ۸۰ نویسه بنویس.",
    promptMissing: "پرامپتی با ۲ تا ۴۰۰۰ نویسه بنویس.", noDatasetSelected: "مجموعه‌ای را انتخاب کن."
  }
} as const;

async function errorText(response: Response): Promise<string> {
  try { const body = await response.json(); if (typeof body?.error === "string") return body.error; }
  catch { /* Use generic message. */ }
  return "Request failed.";
}

export default function LoraStudio({ signedIn, isAdmin }: { signedIn: boolean; isAdmin: boolean }) {
  const [locale, setLocale] = useState<Locale>("en");
  const [theme, setTheme] = useState<Theme>("light");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [inferences, setInferences] = useState<Inference[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [datasetId, setDatasetId] = useState("");
  const [modelId, setModelId] = useState("");
  const [name, setName] = useState("");
  const [triggerWord, setTriggerWord] = useState("");
  const [steps, setSteps] = useState(1000);
  const [rank, setRank] = useState(16);
  const [prompt, setPrompt] = useState("");
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState("1024*1024");
  const [predictionId, setPredictionId] = useState("");
  const [busy, setBusy] = useState<"upload" | "train" | "generate" | "reconcile" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const trainKey = useRef<{ signature: string; id: string } | null>(null);
  const imageKey = useRef<{ signature: string; id: string } | null>(null);
  const t = copy[locale];

  useEffect(() => {
    try { setLocale(localStorage.getItem("ailoom.locale") === "fa" ? "fa" : "en");
      setTheme(localStorage.getItem("ailoom.theme") === "dark" ? "dark" : "light"); }
    catch { /* Local storage may be unavailable. */ }
    setPreferencesLoaded(true);
  }, []);
  useEffect(() => {
    if (!preferencesLoaded) return;
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "fa" ? "rtl" : "ltr";
    try { localStorage.setItem("ailoom.locale", locale); } catch { /* Ignore. */ }
  }, [locale, preferencesLoaded]);
  useEffect(() => {
    if (!preferencesLoaded) return;
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("ailoom.theme", theme); } catch { /* Ignore. */ }
  }, [theme, preferencesLoaded]);

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    try {
      const responses = await Promise.all(["datasets", "models", "inferences"].map(name =>
        fetch(`/api/lora/${name}`, { credentials: "same-origin", cache: "no-store" })));
      if (responses.some(response => !response.ok)) throw new Error();
      const [datasetBody, modelBody, imageBody] = await Promise.all(responses.map(response => response.json()));
      setDatasets(Array.isArray(datasetBody.datasets) ? datasetBody.datasets : []);
      setModels(Array.isArray(modelBody.models) ? modelBody.models : []);
      setInferences(Array.isArray(imageBody.inferences) ? imageBody.inferences : []);
    } catch { setError(copy[locale].error); }
  }, [signedIn, locale]);
  useEffect(() => { void refresh(); if (!signedIn) return;
    const timer = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(timer);
  }, [refresh, signedIn]);

  const selectedDataset = datasets.some(dataset => dataset.id === datasetId) ? datasetId : datasets[0]?.id ?? "";
  const readyModels = models.filter(model => model.state === "ready");
  const selectedModel = readyModels.some(model => model.id === modelId) ? modelId : readyModels[0]?.id ?? "";
  const modelNames = new Map(models.map(model => [model.id, model.name]));
  const uncertain = [
    ...models.filter(model => model.state === "uncertain").map(model => ({ kind: "training" as const, id: model.id, name: model.name })),
    ...inferences.filter(image => image.state === "uncertain").map(image => ({ kind: "inference" as const, id: image.id, name: image.prompt.slice(0, 48) }))
  ];

  async function uploadDataset(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    if (!file || file.size === 0 || file.size > 100 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".zip")) {
      setError(t.fileMissing); return;
    }
    setBusy("upload");
    try {
      const response = await fetch("/api/lora/datasets", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/zip" }, body: file });
      if (!response.ok) throw new Error(await errorText(response));
      const body = await response.json();
      setDatasetId(body.dataset.id); setFile(null); await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : t.error); }
    finally { setBusy(null); }
  }

  async function trainModel(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    if (!selectedDataset) { setError(t.noDatasetSelected); return; }
    if (name.trim().length < 2 || name.trim().length > 80) { setError(t.nameMissing); return; }
    const input = { datasetId: selectedDataset, name: name.trim(), triggerWord: triggerWord.trim(), steps, rank };
    const signature = JSON.stringify(input);
    if (trainKey.current?.signature !== signature) trainKey.current = { signature, id: crypto.randomUUID() };
    setBusy("train");
    try {
      const response = await fetch("/api/lora/models", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, requestId: trainKey.current.id }) });
      if (!response.ok) throw new Error(await errorText(response));
      trainKey.current = null; setName(""); setTriggerWord(""); await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : t.error); }
    finally { setBusy(null); }
  }

  async function generateImage(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    if (!selectedModel) { setError(t.noReady); return; }
    if (prompt.trim().length < 2 || prompt.trim().length > 4000) { setError(t.promptMissing); return; }
    const input = { modelId: selectedModel, prompt: prompt.trim(), scale, size };
    const signature = JSON.stringify(input);
    if (imageKey.current?.signature !== signature) imageKey.current = { signature, id: crypto.randomUUID() };
    setBusy("generate");
    try {
      const response = await fetch("/api/lora/inferences", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, requestId: imageKey.current.id }) });
      if (!response.ok) throw new Error(await errorText(response));
      imageKey.current = null; await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : t.error); }
    finally { setBusy(null); }
  }

  async function reconcile(kind: "training" | "inference", id: string) {
    if (!predictionId.trim()) return;
    setBusy("reconcile"); setError("");
    try {
      const response = await fetch("/api/lora/reconcile", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, predictionId: predictionId.trim() }) });
      if (!response.ok) throw new Error(await errorText(response));
      setPredictionId(""); await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : t.error); }
    finally { setBusy(null); }
  }

  return <div className={styles.page} dir={locale === "fa" ? "rtl" : "ltr"}>
    <header className={styles.header}><a className={styles.brand} href="/">Ailoom</a>
      <div className={styles.controls}>
        <button type="button" onClick={() => setLocale(locale === "en" ? "fa" : "en")}>{locale === "en" ? t.persian : t.english}</button>
        <button type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? t.dark : t.light}</button>
      </div></header>
    <main className={styles.content}>
      <a className={styles.back} href="/">← {t.back}</a>
      <section className={styles.intro}><p>{t.eyebrow}</p><h1>{t.title}</h1><span>{t.intro}</span></section>
      {!signedIn ? <div className={styles.notice}>{t.signIn}</div> : <>
        <div className={styles.toolbar}><span>{t.provider}</span><button type="button" onClick={() => void refresh()}>{t.refresh}</button></div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {notice && <p className={styles.notice}>{notice}</p>}
        <div className={styles.grid}>
          <section className={styles.card}><h2>{t.datasets}</h2><form onSubmit={uploadDataset}>
            <label htmlFor="lora-zip">{t.choose}</label><input id="lora-zip" type="file" accept=".zip,application/zip" onChange={event => setFile(event.target.files?.[0] ?? null)} />
            <p className={styles.hint}>{t.uploadHint}</p><button className={styles.action} disabled={Boolean(busy)}>{busy === "upload" ? t.working : t.upload}</button>
          </form><ul className={styles.smallList}>{datasets.map(dataset => <li key={dataset.id}>{dataset.imageCount} images · {(dataset.sizeBytes / 1048576).toFixed(1)} MB</li>)}</ul></section>
          <section className={styles.card}><h2>{t.train}</h2><form onSubmit={trainModel}>
            <label htmlFor="lora-name">{t.modelName}</label><input id="lora-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder={t.modelNamePlaceholder} />
            <label htmlFor="lora-dataset">{t.dataset}</label><select id="lora-dataset" value={selectedDataset} onChange={event => setDatasetId(event.target.value)}>
              {datasets.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.imageCount} images · {dataset.id.slice(0, 8)}</option>)}
            </select>
            <label htmlFor="lora-trigger">{t.trigger}</label><input id="lora-trigger" value={triggerWord} maxLength={80} onChange={event => setTriggerWord(event.target.value)} />
            <p className={styles.hint}>{t.triggerHint}</p><div className={styles.row}>
              <span><label htmlFor="lora-steps">{t.steps}</label><input id="lora-steps" type="number" min={500} max={10000} value={steps} onChange={event => setSteps(Number(event.target.value))} /></span>
              <span><label htmlFor="lora-rank">{t.rank}</label><input id="lora-rank" type="number" min={1} max={64} value={rank} onChange={event => setRank(Number(event.target.value))} /></span>
            </div><button className={styles.action} disabled={Boolean(busy) || !datasets.length}>{busy === "train" ? t.working : t.trainButton}</button>
            {!datasets.length && <p className={styles.hint}>{t.noDatasets}</p>}
          </form></section>
          <section className={styles.card}><h2>{t.generate}</h2><form onSubmit={generateImage}>
            <label htmlFor="lora-model">{t.model}</label><select id="lora-model" value={selectedModel} onChange={event => setModelId(event.target.value)}>
              {readyModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
            <label htmlFor="lora-prompt">{t.prompt}</label><textarea id="lora-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={t.promptPlaceholder} maxLength={4000} />
            <div className={styles.row}><span><label htmlFor="lora-scale">{t.scale}: {scale.toFixed(2)}</label><input id="lora-scale" type="range" min={0} max={4} step={0.05} value={scale} onChange={event => setScale(Number(event.target.value))} /></span>
              <span><label htmlFor="lora-size">{t.size}</label><select id="lora-size" value={size} onChange={event => setSize(event.target.value)}>
                {["512*512", "768*768", "1024*1024", "768*1024", "1024*768"].map(value => <option key={value} value={value}>{value.replace("*", " × ")}</option>)}
              </select></span></div>
            <button className={styles.action} disabled={Boolean(busy) || !readyModels.length}>{busy === "generate" ? t.working : t.generateButton}</button>
            {!readyModels.length && <p className={styles.hint}>{t.noReady}</p>}
          </form></section>
        </div>
        <section className={styles.listSection}><h2>{t.saved}</h2>{!models.length && <p>{t.none}</p>}<ul className={styles.list}>
          {models.map(model => <li key={model.id}><strong>{model.name}</strong><span>{t[model.state]}</span>
            <small>{model.steps} steps · rank {model.rank}{model.triggerWord ? ` · ${model.triggerWord}` : ""}</small>
            {model.state === "ready" && <a href={`/api/lora/files/weights/${model.id}`}>{t.download}</a>}
            {model.state === "uncertain" && <small>{t.uncertainHelp}</small>}
            {model.errorCode && model.state === "failed" && <small>{model.errorCode}</small>}
          </li>)}
        </ul></section>
        <section className={styles.listSection}><h2>{t.outputs}</h2>{!inferences.length && <p>{t.noOutputs}</p>}<div className={styles.outputs}>
          {inferences.map(image => <article key={image.id} className={styles.output}>
            {image.outputUrl && <img src={image.outputUrl} alt={image.prompt} />}
            <strong>{image.prompt}</strong><span>{modelNames.get(image.modelId) ?? image.modelId.slice(0, 8)} · {t[image.state]}</span>
            {image.state === "uncertain" && <small>{t.uncertainHelp}</small>}
          </article>)}
        </div></section>
        {isAdmin && uncertain.length > 0 && <section className={styles.listSection}><h2>{t.reconcile}</h2><p>{t.uncertainHelp}</p>
          <label htmlFor="lora-prediction">{t.prediction}</label><input id="lora-prediction" value={predictionId} onChange={event => setPredictionId(event.target.value)} />
          <ul className={styles.smallList}>{uncertain.map(item => <li key={item.id}>{item.name} · {item.id.slice(0, 8)} <button type="button" disabled={Boolean(busy) || !predictionId.trim()} onClick={() => void reconcile(item.kind, item.id)}>{t.attach}</button></li>)}</ul>
        </section>}
      </>}
    </main>
  </div>;
}
