"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Circle, Download, Eye, EyeOff,
  FileJson, ImagePlus, Layers3, LockKeyhole, Moon, Redo2, Square, Sun, Trash2, Type,
  Undo2, UploadCloud } from "lucide-react";
import { drawDocument } from "./layer-render";
import { hitLayer, imageDocument, MAX_LAYERS, parseProject, reorderLayer, serializeProject,
  type EditorDocument, type EditorLayer } from "./layer-model";
import styles from "./image-editor.module.css";

type Locale = "en" | "fa";
type Theme = "light" | "dark";
type LibraryImage = { id: string; kind: "image"; visibility: "private" | "public";
  mimeType: string; originalName: string | null; sizeBytes: number; url: string };
type History = { past: EditorDocument[]; present: EditorDocument | null; future: EditorDocument[] };
type Drag = { pointerId: number; id: string; mode: "move" | "resize"; startX: number; startY: number;
  initial: EditorLayer; before: EditorDocument; moved: boolean };

const words = {
  en: {
    eyebrow: "Image Studio / Layers",
    back: "Back to Ailoom", title: "Make it yours, layer by layer.", intro: "Arrange private images, type and shapes in a canvas you control.",
    private: "Private workspace", signIn: "Sign in to open your private image library.", goHome: "Go to Ailoom",
    library: "Your images", addImage: "Add image", selectImage: "Choose an image to begin", noImages: "No private images yet. Upload one to start.",
    upload: "Upload image", uploadHint: "PNG, JPEG or WebP · up to 20 MB", more: "Load more", loading: "Loading images…",
    canvas: "Canvas", empty: "Select an image from your library to start a layered composition.",
    layers: "Layers", noLayers: "No layers yet", text: "Text", rectangle: "Rectangle", ellipse: "Ellipse", image: "Image",
    addText: "Add text", addRect: "Add rectangle", addEllipse: "Add ellipse", select: "Select a layer to edit it.",
    inspector: "Properties", content: "Text", color: "Color", fill: "Fill", size: "Font size", width: "Width", height: "Height", x: "X", y: "Y",
    undo: "Undo", redo: "Redo", show: "Show layer", hide: "Hide layer", delete: "Delete layer",
    forward: "Bring forward", backward: "Send backward", download: "Download PNG", save: "Save private PNG", saving: "Saving…",
    project: "Download editable project", openProject: "Open editable project", projectHint: "Your layers auto-save on this device for this account. PNG is flattened; keep a project JSON to edit elsewhere. Source images must remain in this account.",
    newCanvas: "New canvas", newConfirm: "Start a new canvas? Download the editable project first if you want a backup.",
    saved: "Saved to your private library.", viewSaved: "View saved PNG", limits: "Up to 24 layers · 2048 px canvas edge",
    flattened: "PNG exports are flattened. Your editable layers stay on this device and in the project JSON.",
    loadError: "Could not load your images.", imageError: "Could not open this image. It may be too large or unavailable.",
    uploadError: "Could not upload this image. Use PNG, JPEG or WebP under 20 MB.", exportError: "Could not export. Check that every visible image layer loaded.",
    projectError: "This project file is invalid, too large, or refers to images unavailable to this account.",
    tooMany: "This canvas supports up to 24 layers.", theme: "Change theme", language: "Language", keyboard: "Drag to move, drag the lower corner to resize, or use arrow keys to nudge the selected layer."
  },
  fa: {
    eyebrow: "استودیوی تصویر / لایه‌ها",
    back: "بازگشت به Ailoom", title: "تصویرت را لایه‌به‌لایه بساز.", intro: "عکس‌های خصوصی، نوشته و شکل‌ها را روی بوم دلخواه خود بچین.",
    private: "فضای خصوصی", signIn: "برای باز کردن کتابخانهٔ تصاویر خصوصی وارد حساب شو.", goHome: "رفتن به Ailoom",
    library: "تصاویر شما", addImage: "افزودن تصویر", selectImage: "برای شروع یک تصویر انتخاب کن", noImages: "هنوز تصویر خصوصی نداری. برای شروع یکی بارگذاری کن.",
    upload: "بارگذاری تصویر", uploadHint: "PNG، JPEG یا WebP · حداکثر ۲۰ مگابایت", more: "نمایش بیشتر", loading: "در حال بارگذاری تصاویر…",
    canvas: "بوم", empty: "برای ساخت یک ترکیب لایه‌ای، تصویری از کتابخانه انتخاب کن.",
    layers: "لایه‌ها", noLayers: "هنوز لایه‌ای نیست", text: "نوشته", rectangle: "مستطیل", ellipse: "بیضی", image: "تصویر",
    addText: "افزودن نوشته", addRect: "افزودن مستطیل", addEllipse: "افزودن بیضی", select: "برای ویرایش، لایه‌ای را انتخاب کن.",
    inspector: "ویژگی‌ها", content: "متن", color: "رنگ", fill: "رنگ", size: "اندازهٔ قلم", width: "عرض", height: "ارتفاع", x: "X", y: "Y",
    undo: "واگرد", redo: "بازانجام", show: "نمایش لایه", hide: "پنهان کردن لایه", delete: "حذف لایه",
    forward: "آوردن به جلو", backward: "بردن به عقب", download: "دریافت PNG", save: "ذخیرهٔ PNG خصوصی", saving: "در حال ذخیره…",
    project: "دریافت پروژهٔ قابل‌ویرایش", openProject: "باز کردن پروژهٔ قابل‌ویرایش", projectHint: "لایه‌ها برای این حساب روی همین دستگاه خودکار ذخیره می‌شوند. PNG تخت است؛ برای ویرایش در دستگاه دیگر فایل JSON پروژه را نگه دار. تصویرهای اصلی باید در همین حساب بمانند.",
    newCanvas: "بوم جدید", newConfirm: "بوم جدید بسازی؟ اگر نسخهٔ پشتیبان می‌خواهی، اول پروژهٔ قابل‌ویرایش را دریافت کن.",
    saved: "در کتابخانهٔ خصوصی ذخیره شد.", viewSaved: "نمایش PNG ذخیره‌شده", limits: "حداکثر ۲۴ لایه · ضلع بوم تا ۲۰۴۸ پیکسل",
    flattened: "خروجی PNG تخت است. لایه‌های قابل‌ویرایش روی همین دستگاه و در فایل JSON پروژه می‌مانند.",
    loadError: "تصاویر بارگذاری نشدند.", imageError: "این تصویر باز نشد؛ ممکن است خیلی بزرگ یا در دسترس نباشد.",
    uploadError: "بارگذاری انجام نشد. فایل PNG، JPEG یا WebP کمتر از ۲۰ مگابایت انتخاب کن.", exportError: "خروجی ساخته نشد. بارگذاری همهٔ لایه‌های تصویریِ نمایان را بررسی کن.",
    projectError: "فایل پروژه معتبر نیست، خیلی بزرگ است، یا به تصاویری اشاره می‌کند که در این حساب در دسترس نیستند.",
    tooMany: "این بوم حداکثر ۲۴ لایه دارد.", theme: "تغییر پوسته", language: "زبان", keyboard: "برای جابه‌جایی بکش، برای تغییر اندازه گوشهٔ پایینی را بکش، یا با کلیدهای جهت لایه را حرکت بده."
  }
} as const;

function stored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function persist(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Private mode may disable storage. */ }
}
function clamp(number: number, min: number, max: number) { return Math.max(min, Math.min(max, number)); }
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function ImageLayerEditor({ userId }: { userId: string | null }) {
  const signedIn = Boolean(userId);
  const [locale, setLocale] = useState<Locale>("en");
  const [theme, setTheme] = useState<Theme>("light");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [history, setHistory] = useState<History>({ past: [], present: null, future: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryImage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [imageVersion, setImageVersion] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef(new Map<string, ImageBitmap>());
  const loadingRef = useRef(new Map<string, Promise<ImageBitmap>>());
  const dragRef = useRef<Drag | null>(null);
  const mountedRef = useRef(true);
  const t = words[locale];
  const doc = history.present;
  const selected = doc?.layers.find(layer => layer.id === selectedId) ?? null;

  useEffect(() => {
    const savedLocale = stored("ailoom.locale");
    const savedTheme = stored("ailoom.theme");
    if (savedLocale === "en" || savedLocale === "fa") setLocale(savedLocale);
    if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
    setPreferencesLoaded(true);
  }, []);
  useEffect(() => {
    if (!preferencesLoaded) return;
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "fa" ? "rtl" : "ltr";
    document.documentElement.dataset.theme = theme;
    persist("ailoom.locale", locale);
    persist("ailoom.theme", theme);
  }, [locale, theme, preferencesLoaded]);
  useEffect(() => {
    setHydrated(false);
    setHistory({ past: [], present: null, future: [] });
    setSelectedId(null);
    if (userId) {
      const raw = stored(`ailoom.image-editor.v1.${userId}`);
      if (raw) {
        try {
          const restored = parseProject(JSON.parse(raw) as unknown);
          setHistory({ past: [], present: restored, future: [] });
          setSelectedId(restored.layers.at(-1)?.id ?? null);
        } catch { setError(words[locale].projectError); }
      }
    }
    setHydrated(true);
  }, [userId]);
  useEffect(() => {
    if (!userId || !hydrated) return;
    const key = `ailoom.image-editor.v1.${userId}`;
    if (history.present) persist(key, serializeProject(history.present));
    else try { localStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
  }, [userId, hydrated, history.present]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const image of imagesRef.current.values()) image.close();
      imagesRef.current.clear();
    };
  }, []);

  const loadImage = useCallback(async (id: string): Promise<ImageBitmap> => {
    const existing = imagesRef.current.get(id);
    if (existing) return existing;
    const pending = loadingRef.current.get(id);
    if (pending) return pending;
    const job = (async () => {
      const metadata = await fetch(`/api/assets/${encodeURIComponent(id)}/metadata`, { credentials: "same-origin", cache: "no-store" });
      if (!metadata.ok || (await metadata.json() as { visibility?: string }).visibility !== "private") {
        throw new Error("Private image unavailable");
      }
      const response = await fetch(`/api/assets/${encodeURIComponent(id)}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok || Number(response.headers.get("content-length") || 0) > 20_000_000) throw new Error("Image unavailable");
      const blob = await response.blob();
      if (blob.size > 20_000_000 || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(blob.type)) {
        throw new Error("Image unavailable");
      }
      const bitmap = await createImageBitmap(blob);
      if (bitmap.width * bitmap.height > 16_000_000 || !mountedRef.current) {
        bitmap.close();
        throw new Error("Image too large");
      }
      imagesRef.current.set(id, bitmap);
      setImageVersion(value => value + 1);
      return bitmap;
    })();
    loadingRef.current.set(id, job);
    try { return await job; }
    finally { loadingRef.current.delete(id); }
  }, []);

  const loadLibrary = useCallback(async (next: string | null) => {
    setLibraryBusy(true);
    try {
      const params = new URLSearchParams({ kind: "image", limit: "100" });
      if (next) params.set("cursor", next);
      const response = await fetch(`/api/assets?${params}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Library unavailable");
      const data = await response.json() as { assets?: LibraryImage[]; nextCursor?: string | null };
      const privateImages = (data.assets ?? []).filter(item => item.kind === "image" && item.visibility === "private");
      setLibrary(current => next ? [...current, ...privateImages.filter(item => !current.some(old => old.id === item.id))] : privateImages);
      setCursor(data.nextCursor ?? null);
    } catch { setError(words[locale].loadError); }
    finally { setLibraryBusy(false); }
  }, [locale]);
  useEffect(() => { if (signedIn) void loadLibrary(null); }, [signedIn, loadLibrary]);

  useEffect(() => {
    if (!doc) return;
    const missing = [...new Set(doc.layers.filter(layer => layer.type === "image").map(layer => (layer as Extract<EditorLayer, { type: "image" }>).assetId))]
      .filter(id => !imagesRef.current.has(id));
    if (missing.length) void Promise.all(missing.map(id => loadImage(id))).catch(() => setError(words[locale].imageError));
  }, [doc, loadImage, locale]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    drawDocument(context, doc, imagesRef.current, selectedId);
  }, [doc, selectedId, imageVersion]);

  function commit(next: EditorDocument) {
    setHistory(previous => ({ past: previous.present ? [...previous.past.slice(-39), previous.present] : previous.past,
      present: next, future: [] }));
    setSavedId(null);
    setError("");
  }
  function updateDoc(update: (current: EditorDocument) => EditorDocument) {
    setHistory(previous => {
      if (!previous.present) return previous;
      const next = update(previous.present);
      if (next === previous.present) return previous;
      return { past: [...previous.past.slice(-39), previous.present], present: next, future: [] };
    });
    setSavedId(null);
  }
  function updateLayer(id: string, update: (layer: EditorLayer) => EditorLayer) {
    updateDoc(current => ({ ...current, layers: current.layers.map(layer => layer.id === id ? update(layer) : layer) }));
  }
  function undo() {
    setHistory(previous => {
      const prior = previous.past.at(-1);
      if (!prior || !previous.present) return previous;
      return { past: previous.past.slice(0, -1), present: prior, future: [previous.present, ...previous.future].slice(0, 40) };
    });
    setSavedId(null);
  }
  function redo() {
    setHistory(previous => {
      const next = previous.future[0];
      if (!next || !previous.present) return previous;
      return { past: [...previous.past.slice(-39), previous.present], present: next, future: previous.future.slice(1) };
    });
    setSavedId(null);
  }

  async function chooseImage(asset: LibraryImage) {
    setError("");
    try {
      const bitmap = await loadImage(asset.id);
      const id = crypto.randomUUID();
      if (!doc) {
        commit(imageDocument(asset.id, asset.originalName ?? t.image, bitmap.width, bitmap.height, id));
      } else {
        if (doc.layers.length >= MAX_LAYERS) { setError(t.tooMany); return; }
        const fit = Math.min(doc.width * .68 / bitmap.width, doc.height * .68 / bitmap.height, 1);
        const width = Math.max(1, Math.round(bitmap.width * fit));
        const height = Math.max(1, Math.round(bitmap.height * fit));
        const layer: EditorLayer = { type: "image", id, assetId: asset.id, name: asset.originalName ?? t.image,
          x: Math.round((doc.width - width) / 2), y: Math.round((doc.height - height) / 2), width, height, visible: true };
        updateDoc(current => ({ ...current, layers: [...current.layers, layer] }));
      }
      setSelectedId(id);
    } catch { setError(t.imageError); }
  }
  async function uploadImage(file: File) {
    if (!signedIn || file.size < 1 || file.size > 20_000_000 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError(t.uploadError); return;
    }
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/assets", { method: "POST", credentials: "same-origin", body: form });
      if (!response.ok) throw new Error("Upload failed");
      const payload = await response.json() as { asset?: LibraryImage };
      if (!payload.asset?.id) throw new Error("Upload failed");
      const asset: LibraryImage = { ...payload.asset, visibility: "private", kind: "image" };
      setLibrary(current => [asset, ...current]);
      await chooseImage(asset);
    } catch { setError(t.uploadError); }
    finally { setBusy(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  }
  function addPrimitive(type: "text" | "rectangle" | "ellipse") {
    if (!doc) return;
    if (doc.layers.length >= MAX_LAYERS) { setError(t.tooMany); return; }
    const id = crypto.randomUUID();
    const width = Math.max(48, Math.round(doc.width * (type === "text" ? .65 : .28)));
    const height = Math.max(36, Math.round(doc.height * (type === "text" ? .18 : .28)));
    const base = { id, x: Math.round((doc.width - width) / 2), y: Math.round((doc.height - height) / 2), width, height, visible: true };
    const layer: EditorLayer = type === "text"
      ? { ...base, type: "text", name: t.text, text: locale === "fa" ? "متن شما" : "Your text", color: "#ffffff",
        fontSize: clamp(Math.round(doc.width * .045), 16, 80) }
      : { ...base, type: "shape", name: type === "rectangle" ? t.rectangle : t.ellipse,
        shape: type, fill: "#0c6873" };
    updateDoc(current => ({ ...current, layers: [...current.layers, layer] }));
    setSelectedId(id);
  }

  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height };
  }
  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!doc || busy) return;
    const p = point(event);
    const currentSelection = doc.layers.find(item => item.id === selectedId && item.visible &&
      p.x >= item.x && p.y >= item.y && p.x <= item.x + item.width && p.y <= item.y + item.height);
    const hit = currentSelection?.id ?? hitLayer(doc.layers, p.x, p.y);
    setSelectedId(hit);
    if (!hit) return;
    const layer = doc.layers.find(item => item.id === hit)!;
    const handle = Math.max(12, Math.max(doc.width, doc.height) / 55);
    const resize = selectedId === hit && Math.abs(p.x - layer.x - layer.width) < handle &&
      Math.abs(p.y - layer.y - layer.height) < handle;
    dragRef.current = { pointerId: event.pointerId, id: hit, mode: resize ? "resize" : "move",
      startX: p.x, startY: p.y, initial: layer, before: doc, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const p = point(event);
    const dx = p.x - drag.startX; const dy = p.y - drag.startY;
    if (Math.abs(dx) < .5 && Math.abs(dy) < .5) return;
    drag.moved = true;
    const initial = drag.initial;
    const updated = drag.mode === "move"
      ? { ...initial, x: Math.round(initial.x + dx), y: Math.round(initial.y + dy) }
      : { ...initial, width: clamp(Math.round(initial.width + dx), 16, 4096),
          height: clamp(Math.round(initial.height + dy), 16, 4096) };
    setHistory(previous => ({ ...previous, present: { ...drag.before,
      layers: drag.before.layers.map(layer => layer.id === drag.id ? updated : layer) } }));
  }
  function pointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.moved) {
      setHistory(previous => ({ ...previous, past: [...previous.past.slice(-39), drag.before], future: [] }));
      setSavedId(null);
    }
  }
  function keyboardNudge(event: ReactKeyboardEvent<HTMLCanvasElement>) {
    if (!selectedId || !doc) return;
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    updateLayer(selectedId, layer => ({ ...layer, x: layer.x + direction[0] * step, y: layer.y + direction[1] * step }));
  }

  async function pngBlob(): Promise<Blob> {
    if (!doc) throw new Error("No canvas");
    for (const layer of doc.layers) if (layer.type === "image" && layer.visible) await loadImage(layer.assetId);
    await document.fonts.ready;
    const canvas = document.createElement("canvas");
    canvas.width = doc.width; canvas.height = doc.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    drawDocument(context, doc, imagesRef.current);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG unavailable")), "image/png"));
  }
  async function exportPng(save: boolean) {
    if (!doc || busy) return;
    setBusy(true); setError("");
    try {
      const blob = await pngBlob();
      if (!save) { downloadBlob(blob, "ailoom-layered-image.png"); return; }
      const form = new FormData();
      form.set("file", new File([blob], "ailoom-layered-image.png", { type: "image/png" }));
      const response = await fetch("/api/assets", { method: "POST", credentials: "same-origin", body: form });
      if (!response.ok) throw new Error("Save failed");
      const payload = await response.json() as { asset?: LibraryImage };
      if (!payload.asset?.id) throw new Error("Save failed");
      setSavedId(payload.asset.id);
      setLibrary(current => [{ ...payload.asset!, kind: "image", visibility: "private" }, ...current]);
    } catch { setError(t.exportError); }
    finally { setBusy(false); }
  }
  function exportProject() {
    if (!doc) return;
    downloadBlob(new Blob([serializeProject(doc)], { type: "application/json" }), "ailoom-editable-image.json");
  }
  function newCanvas() {
    if (!window.confirm(t.newConfirm)) return;
    setHistory({ past: [], present: null, future: [] });
    setSelectedId(null);
    setSavedId(null);
    setError("");
  }
  async function importProject(file: File) {
    if (!signedIn || file.size > 64_000 || file.size === 0) { setError(t.projectError); return; }
    setBusy(true); setError("");
    try {
      const project = parseProject(JSON.parse(await file.text()) as unknown);
      await Promise.all([...new Set(project.layers.filter(layer => layer.type === "image")
        .map(layer => (layer as Extract<EditorLayer, { type: "image" }>).assetId))].map(loadImage));
      commit(project);
      setSelectedId(project.layers.at(-1)?.id ?? null);
    } catch { setError(t.projectError); }
    finally { setBusy(false); if (projectInputRef.current) projectInputRef.current.value = ""; }
  }

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <a href="/" className={styles.brand}>Ailoom<span>.</span></a>
        <div className={styles.headerRight}>
          <a href="/" className={styles.back}>{locale === "fa" ? <ArrowRight size={15} /> : <ArrowLeft size={15} />}{t.back}</a>
          <div className={styles.switch} aria-label={t.language}>
            <button type="button" onClick={() => setLocale("en")} aria-pressed={locale === "en"}>EN</button>
            <button type="button" onClick={() => setLocale("fa")} aria-pressed={locale === "fa"}>فا</button>
          </div>
          <button type="button" className={styles.theme} onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={t.theme}>
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </div>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}><Layers3 size={15} />{t.eyebrow}</p>
        <h1>{t.title}</h1><p>{t.intro}</p>
        <span className={styles.privateBadge}><LockKeyhole size={13} />{t.private}</span>
      </section>

      {!signedIn ? <section className={styles.guest}><LockKeyhole size={26} /><p>{t.signIn}</p><a href="/">{t.goHome}</a></section> : <>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {savedId && <p className={styles.success} role="status">{t.saved} <a href={`/api/assets/${encodeURIComponent(savedId)}`} target="_blank" rel="noreferrer">{t.viewSaved}</a></p>}
        <div className={styles.editor}>
          <aside className={styles.libraryPanel} aria-label={t.library}>
            <div className={styles.panelTitle}><span>01 / {t.library}</span><ImagePlus size={17} /></div>
            <input ref={fileInputRef} className={styles.hiddenInput} id="layer-upload" type="file" accept="image/png,image/jpeg,image/webp"
              onChange={event => { const file = event.target.files?.[0]; if (file) void uploadImage(file); }} />
            <label htmlFor="layer-upload" className={styles.uploadButton} aria-disabled={busy}>
              <UploadCloud size={17} />{t.upload}
            </label>
            <p className={styles.hint}>{t.uploadHint}</p>
            <div className={styles.assetList}>
              {library.map(asset => <button type="button" className={styles.asset} key={asset.id} disabled={busy}
                onClick={() => void chooseImage(asset)} title={asset.originalName ?? t.image}>
                {/* Same-origin image URL is owner checked by the asset route. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.url} alt="" loading="lazy" />
                <span>{asset.originalName ?? t.image}</span><span className={styles.assetPlus}>＋</span>
              </button>)}
              {!libraryBusy && library.length === 0 && <p className={styles.emptyLibrary}>{t.noImages}</p>}
            </div>
            {libraryBusy && <p className={styles.hint}>{t.loading}</p>}
            {cursor && <button type="button" className={styles.more} disabled={libraryBusy} onClick={() => void loadLibrary(cursor)}>{t.more}</button>}
          </aside>

          <section className={styles.canvasPanel} aria-label={t.canvas}>
            <div className={styles.canvasToolbar}>
              <div className={styles.toolGroup}>
                <button type="button" disabled={!doc || doc.layers.length >= MAX_LAYERS || busy} onClick={() => addPrimitive("text")} title={t.addText} aria-label={t.addText}><Type size={18} /></button>
                <button type="button" disabled={!doc || doc.layers.length >= MAX_LAYERS || busy} onClick={() => addPrimitive("rectangle")} title={t.addRect} aria-label={t.addRect}><Square size={17} /></button>
                <button type="button" disabled={!doc || doc.layers.length >= MAX_LAYERS || busy} onClick={() => addPrimitive("ellipse")} title={t.addEllipse} aria-label={t.addEllipse}><Circle size={17} /></button>
              </div>
              <span className={styles.dimensions}>{doc ? `${doc.width} × ${doc.height}` : t.canvas}</span>
              <div className={styles.toolGroup}>
                <button type="button" disabled={!history.past.length || busy} onClick={undo} title={t.undo} aria-label={t.undo}><Undo2 size={17} /></button>
                <button type="button" disabled={!history.future.length || busy} onClick={redo} title={t.redo} aria-label={t.redo}><Redo2 size={17} /></button>
              </div>
            </div>
            <div className={styles.stage}>
              {doc ? <canvas ref={canvasRef} className={styles.canvas} width={doc.width} height={doc.height}
                tabIndex={0} aria-label={`${t.canvas}: ${doc.width} × ${doc.height}. ${t.keyboard}`}
                onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}
                onKeyDown={keyboardNudge} /> : <div className={styles.emptyCanvas}><ImagePlus size={28} /><strong>{t.selectImage}</strong><p>{t.empty}</p></div>}
            </div>
            <p className={styles.stageHint}>{t.keyboard}</p>
            <p className={styles.flattened}>{t.flattened}</p>
            <div className={styles.exportBar}>
              <button type="button" className={styles.secondaryButton} disabled={!doc || busy} onClick={() => void exportPng(false)}><Download size={16} />{t.download}</button>
              <button type="button" className={styles.primaryButton} disabled={!doc || busy} onClick={() => void exportPng(true)}><LockKeyhole size={16} />{busy ? t.saving : t.save}</button>
            </div>
          </section>

          <aside className={styles.layersPanel} aria-label={t.layers}>
            <div className={styles.panelTitle}><span>02 / {t.layers}</span><Layers3 size={17} /></div>
            <div className={styles.layerList}>
              {doc?.layers.slice().reverse().map(layer => <div className={`${styles.layerRow} ${selectedId === layer.id ? styles.activeLayer : ""}`} key={layer.id}>
                <button type="button" className={styles.layerPick} aria-pressed={selectedId === layer.id} onClick={() => setSelectedId(layer.id)}>
                  {layer.type === "image" ? <ImagePlus size={15} /> : layer.type === "text" ? <Type size={15} /> : layer.shape === "ellipse" ? <Circle size={15} /> : <Square size={15} />}
                  <span>{layer.name}</span>
                </button>
                <button type="button" className={styles.layerIcon} title={layer.visible ? t.hide : t.show} aria-label={`${layer.visible ? t.hide : t.show}: ${layer.name}`}
                  onClick={() => updateLayer(layer.id, current => ({ ...current, visible: !current.visible }))}>
                  {layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
              </div>)}
              {!doc?.layers.length && <p className={styles.emptyLibrary}>{t.noLayers}</p>}
            </div>
            {selected && doc && <div className={styles.inspector}>
              <h2>{t.inspector}</h2>
              <div className={styles.layerActions}>
                <button type="button" disabled={doc.layers.at(-1)?.id === selected.id} title={t.forward} aria-label={t.forward}
                  onClick={() => updateDoc(current => ({ ...current, layers: reorderLayer(current.layers, selected.id, 1) }))}><ChevronUp size={16} /></button>
                <button type="button" disabled={doc.layers[0]?.id === selected.id} title={t.backward} aria-label={t.backward}
                  onClick={() => updateDoc(current => ({ ...current, layers: reorderLayer(current.layers, selected.id, -1) }))}><ChevronDown size={16} /></button>
                <button type="button" title={t.delete} aria-label={t.delete} onClick={() => { updateDoc(current => ({ ...current, layers: current.layers.filter(layer => layer.id !== selected.id) })); setSelectedId(null); }}><Trash2 size={16} /></button>
              </div>
              {selected.type === "text" && <>
                <label className={styles.field}>{t.content}<textarea maxLength={500} rows={3} value={selected.text}
                  onChange={event => updateLayer(selected.id, layer => layer.type === "text" ? { ...layer, text: event.target.value } : layer)} /></label>
                <label className={styles.field}>{t.size}<input type="number" min="8" max="240" value={selected.fontSize}
                  onChange={event => updateLayer(selected.id, layer => layer.type === "text" ? { ...layer, fontSize: clamp(Number(event.target.value) || 8, 8, 240) } : layer)} /></label>
              </>}
              {selected.type !== "image" && <label className={styles.colorField}>{selected.type === "text" ? t.color : t.fill}
                <input type="color" value={selected.type === "text" ? selected.color : selected.fill}
                  onChange={event => updateLayer(selected.id, layer => layer.type === "text"
                    ? { ...layer, color: event.target.value } : layer.type === "shape" ? { ...layer, fill: event.target.value } : layer)} /></label>}
              <div className={styles.geometry}>
                {(["x", "y", "width", "height"] as const).map(key => <label className={styles.field} key={key}>{t[key]}
                  <input type="number" min={key === "width" || key === "height" ? 1 : -8192} max="8192" step="1"
                    value={Math.round(selected[key])} onChange={event => updateLayer(selected.id, layer => ({ ...layer,
                      [key]: clamp(Number(event.target.value) || 0, key === "width" || key === "height" ? 1 : -8192, 8192) }))} />
                </label>)}
              </div>
            </div>}
            <div className={styles.projectTools}>
              <button type="button" disabled={!doc || busy} onClick={newCanvas}><ImagePlus size={16} />{t.newCanvas}</button>
              <button type="button" disabled={!doc || busy} onClick={exportProject}><FileJson size={16} />{t.project}</button>
              <input ref={projectInputRef} className={styles.hiddenInput} id="layer-project" type="file" accept=".json,application/json"
                onChange={event => { const file = event.target.files?.[0]; if (file) void importProject(file); }} />
              <label htmlFor="layer-project"><UploadCloud size={16} />{t.openProject}</label>
              <p>{t.projectHint}</p>
            </div>
          </aside>
        </div>
        <p className={styles.limits}>{t.limits}</p>
      </>}
    </div>
  </main>;
}
