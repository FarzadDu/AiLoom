"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, Clapperboard,
  Film, Image as ImageIcon, Layers3, LoaderCircle, Moon, Plus, RefreshCw, Sun,
  Trash2, UploadCloud, WandSparkles, X } from "lucide-react";
import { mediaJobFromPayload, type MediaJob, type MediaModel } from "@/components/media-api";
import { responseError } from "@/components/chat-api";
import { chooseStoryboardRenderRequest, normalizeShotControls, storyboardAssetsFromPayload, storyboardFromPayload,
  storyboardRenderReadiness, storyboardRenderSnapshot, storyboardVideoModels, storyboardsFromPayload, type ShotAspect, type StoryboardAsset,
  type StoryboardDetail, type StoryboardShot, type StoryboardSummary } from "@/components/storyboard-ui-data";
import { storyboardCopy, type StoryboardLocale } from "./copy";
import styles from "./storyboards.module.css";

type User = { id: string; email: string; name: string | null } | null;
type ShotDraft = Omit<StoryboardShot, "id" | "storyboardId" | "position"> & { id?: string };
type Notice = { tone: "success" | "error"; text: string } | null;
const DEFAULT_MODEL = "fal-ai/veo3.1/fast";
const ASPECTS: ShotAspect[] = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const DONE_STATES = new Set(["succeeded", "failed", "cancelled"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function jsonRequest(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  if (!response.ok) throw new Error(await responseError(response));
  return response.status === 204 ? null : response.json();
}

function jsonMutation(method: "POST" | "PATCH" | "DELETE", body?: unknown): RequestInit {
  return { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) };
}

function assetLabel(asset: StoryboardAsset | undefined, id: string, copy: typeof storyboardCopy.en): string {
  if (!asset) return id.slice(0, 8);
  const kind = copy[asset.kind];
  return `${kind} · ${asset.originalName || asset.id.slice(0, 8)}`;
}

function clipFromJob(job: MediaJob | null): { url: string; id: string } | null {
  if (job?.state !== "succeeded" || typeof job.output !== "object" || !job.output || Array.isArray(job.output)) return null;
  const assets = (job.output as { assets?: unknown }).assets;
  if (!Array.isArray(assets)) return null;
  for (const raw of assets) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as { id?: unknown; kind?: unknown; url?: unknown };
    if (item.kind === "video" && typeof item.id === "string" && uuid.test(item.id) &&
        item.url === `/api/assets/${item.id}`) return { id: item.id, url: item.url };
  }
  return null;
}

function emptyDraft(modelId: string): ShotDraft {
  return { title: "", prompt: "", modelId, durationSec: 8, aspectRatio: "16:9",
    firstFrameAssetId: null, lastFrameAssetId: null, referenceAssetIds: [], outputAssetId: null };
}

function renderKey(boardId: string) { return `ailoom.storyboard-render.${boardId}`; }
function renderRequestKey(boardId: string) { return `ailoom.storyboard-render-request.${boardId}`; }

export default function StoryboardStudio({ user }: { user: User }) {
  const [locale, setLocale] = useState<StoryboardLocale>("en");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [boards, setBoards] = useState<StoryboardSummary[]>([]);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [board, setBoard] = useState<StoryboardDetail | null>(null);
  const [boardTitle, setBoardTitle] = useState("");
  const [boardDescription, setBoardDescription] = useState("");
  const [newBoardTitle, setNewBoardTitle] = useState("");
  const [models, setModels] = useState<MediaModel[]>([]);
  const [assets, setAssets] = useState<StoryboardAsset[]>([]);
  const [assetCursor, setAssetCursor] = useState<string | null>(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [draft, setDraft] = useState<ShotDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [boardLoading, setBoardLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [renderJob, setRenderJob] = useState<MediaJob | null>(null);
  const activeBoardId = useRef<string | null>(null);
  const t = storyboardCopy[locale];

  useEffect(() => {
    try {
      const savedLocale = localStorage.getItem("ailoom.locale");
      const savedTheme = localStorage.getItem("ailoom.theme");
      if (savedLocale === "fa") setLocale("fa");
      if (savedTheme === "dark") setTheme("dark");
    } catch { /* Browser storage may be unavailable. */ }
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

  const loadAssets = useCallback(async (cursor?: string) => {
    const payload = await jsonRequest(`/api/assets?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    const parsed = storyboardAssetsFromPayload(payload);
    if (!parsed) throw new Error("Invalid media library response.");
    setAssets(current => cursor ? [...current, ...parsed.assets.filter(item => !current.some(old => old.id === item.id))] : parsed.assets);
    setAssetCursor(parsed.nextCursor);
  }, []);

  const loadBoards = useCallback(async (): Promise<StoryboardSummary[]> => {
    const parsed = storyboardsFromPayload(await jsonRequest("/api/storyboards?limit=200"));
    if (!parsed) throw new Error("Invalid storyboard response.");
    setBoards(parsed);
    return parsed;
  }, []);

  const loadBoard = useCallback(async (id: string): Promise<StoryboardDetail> => {
    const parsed = storyboardFromPayload(await jsonRequest(`/api/storyboards/${id}`));
    if (!parsed) throw new Error("Invalid storyboard details.");
    if (activeBoardId.current === id) {
      setBoard(parsed);
      setBoardTitle(parsed.title);
      setBoardDescription(parsed.description);
    }
    return parsed;
  }, []);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let live = true;
    Promise.allSettled([loadBoards(), jsonRequest("/api/media/models"), loadAssets()])
      .then(results => {
        if (!live) return;
        const listed = results[0];
        if (listed.status === "fulfilled") {
          const requested = new URL(window.location.href).searchParams.get("board");
          setBoardId(listed.value.find(item => item.id === requested)?.id || listed.value[0]?.id || null);
        }
        const modelResult = results[1];
        if (modelResult.status === "fulfilled") setModels(storyboardVideoModels(modelResult.value));
        const failure = results.find(result => result.status === "rejected");
        if (failure?.status === "rejected") setNotice({ tone: "error", text: failure.reason instanceof Error ? failure.reason.message : storyboardCopy.en.failed });
      }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [user, loadBoards, loadAssets]);

  useEffect(() => {
    activeBoardId.current = boardId;
    if (!boardId) { setBoard(null); setDraft(null); setRenderJob(null); setRenderJobId(null); return; }
    let live = true;
    setBoardLoading(true);
    setBoard(null);
    setDraft(null);
    setRenderJob(null);
    const saved = localStorage.getItem(renderKey(boardId));
    setRenderJobId(saved && uuid.test(saved) ? saved : null);
    loadBoard(boardId).catch(error => {
      if (live) setNotice({ tone: "error", text: error instanceof Error ? error.message : t.failed });
    }).finally(() => { if (live) setBoardLoading(false); });
    const url = new URL(window.location.href);
    url.searchParams.set("board", boardId);
    window.history.replaceState(null, "", url);
    return () => { live = false; };
  }, [boardId, loadBoard]);

  useEffect(() => {
    if (!renderJobId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function checkJob() {
      try {
        const parsed = mediaJobFromPayload(await jsonRequest(`/api/generations/${renderJobId}`));
        if (!parsed) throw new Error("Invalid render status response.");
        if (!live) return;
        setRenderJob(parsed);
        if (!DONE_STATES.has(parsed.state)) timer = setTimeout(checkJob, 3000);
        else if (boardId) {
          const request = localStorage.getItem(renderRequestKey(boardId));
          if (request) {
            try {
              const saved = JSON.parse(request) as { jobId?: unknown };
              if (saved.jobId === parsed.id) localStorage.removeItem(renderRequestKey(boardId));
            } catch { localStorage.removeItem(renderRequestKey(boardId)); }
          }
        }
      } catch (error) {
        if (live) setNotice({ tone: "error", text: error instanceof Error ? error.message : t.failed });
      }
    }
    void checkJob();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [renderJobId, boardId]);

  const currentModel = models.find(item => item.id === draft?.modelId);
  const modelOptions = useMemo(() => {
    if (!draft?.modelId || models.some(item => item.id === draft.modelId)) return models;
    return [{ id: draft.modelId, name: draft.modelId, provider: "", operations: ["text_to_video"], outputKind: "video" as const }, ...models];
  }, [models, draft?.modelId]);
  const assetsById = useMemo(() => new Map(assets.map(item => [item.id, item])), [assets]);
  const filteredAssets = useMemo(() => assets.filter(item =>
    `${item.originalName || ""} ${item.id}`.toLowerCase().includes(assetSearch.toLowerCase())), [assets, assetSearch]);
  const referenceChoices = useMemo(() => [
    ...(draft?.referenceAssetIds || []).filter(id => !assetsById.has(id)).map(id => ({ id, asset: undefined })),
    ...filteredAssets.map(asset => ({ id: asset.id, asset }))
  ], [draft?.referenceAssetIds, assetsById, filteredAssets]);
  const renderReadiness = storyboardRenderReadiness(board?.shots ?? []);
  const canRender = renderReadiness.ready;
  const clip = clipFromJob(renderJob);

  async function act(task: () => Promise<void>, success?: string) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try { await task(); if (success) setNotice({ tone: "success", text: success }); }
    catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : t.failed }); }
    finally { setBusy(false); }
  }

  function selectBoard(id: string) { if (!busy && id !== boardId) setBoardId(id); }

  function createBoard(event: FormEvent) {
    event.preventDefault();
    const title = newBoardTitle.trim();
    if (!title) { setNotice({ tone: "error", text: t.titleRequired }); return; }
    void act(async () => {
      const payload = await jsonRequest("/api/storyboards", jsonMutation("POST", { title, description: "" }));
      const created = storyboardsFromPayload({ storyboards: [(payload as { storyboard?: unknown })?.storyboard] })?.[0];
      if (!created) throw new Error(t.failed);
      setBoards(current => [created, ...current]);
      setNewBoardTitle("");
      setBoardId(created.id);
    });
  }

  function saveBoard(event: FormEvent) {
    event.preventDefault();
    if (!board) return;
    const title = boardTitle.trim();
    if (!title) { setNotice({ tone: "error", text: t.titleRequired }); return; }
    void act(async () => {
      await jsonRequest(`/api/storyboards/${board.id}`, jsonMutation("PATCH", { title, description: boardDescription.trim() }));
      await Promise.all([loadBoard(board.id), loadBoards()]);
    }, t.boardSaved);
  }

  function deleteBoard() {
    if (!board || !window.confirm(t.deleteBoardConfirm)) return;
    const id = board.id;
    void act(async () => {
      await jsonRequest(`/api/storyboards/${id}`, jsonMutation("DELETE"));
      localStorage.removeItem(renderKey(id));
      localStorage.removeItem(renderRequestKey(id));
      const remaining = await loadBoards();
      setBoardId(remaining[0]?.id || null);
    }, t.boardDeleted);
  }

  function beginShot(shot?: StoryboardShot) {
    if (shot) setDraft({ ...shot });
    else setDraft(emptyDraft(models.find(item => item.id === DEFAULT_MODEL)?.id || models[0]?.id || ""));
    requestAnimationFrame(() => document.getElementById("shot-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function setModel(id: string) {
    setDraft(current => {
      if (!current) return current;
      const controls = normalizeShotControls(id, current.durationSec, current.aspectRatio);
      return { ...current, modelId: id, ...controls };
    });
  }

  function saveShot(event: FormEvent) {
    event.preventDefault();
    if (!board || !draft) return;
    const title = draft.title.trim();
    const prompt = draft.prompt.trim();
    if (!title || !prompt || !draft.modelId) {
      setNotice({ tone: "error", text: !title ? t.titleRequired : !prompt ? t.promptRequired : t.modelRequired });
      return;
    }
    const { id, ...rest } = draft;
    void act(async () => {
      const path = id ? `/api/storyboards/${board.id}/shots/${id}` : `/api/storyboards/${board.id}/shots`;
      await jsonRequest(path, jsonMutation(id ? "PATCH" : "POST", { ...rest, title, prompt }));
      await loadBoard(board.id);
      await loadBoards();
      setDraft(null);
    }, t.shotSaved);
  }

  function deleteShot(shot: StoryboardShot) {
    if (!board || !window.confirm(t.deleteShotConfirm)) return;
    void act(async () => {
      await jsonRequest(`/api/storyboards/${board.id}/shots/${shot.id}`, jsonMutation("DELETE"));
      await loadBoard(board.id);
      if (draft?.id === shot.id) setDraft(null);
    }, t.shotDeleted);
  }

  function moveShot(index: number, step: -1 | 1) {
    if (!board || index + step < 0 || index + step >= board.shots.length) return;
    const shotIds = board.shots.map(item => item.id);
    [shotIds[index], shotIds[index + step]] = [shotIds[index + step], shotIds[index]];
    void act(async () => {
      await jsonRequest(`/api/storyboards/${board.id}/shots/reorder`, jsonMutation("PATCH", { shotIds }));
      await loadBoard(board.id);
    }, t.reordered);
  }

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size === 0 || file.size > 100_000_000) { setNotice({ tone: "error", text: t.fileTooLarge }); return; }
    setUploading(true);
    setNotice(null);
    try {
      const body = new FormData();
      body.set("file", file);
      await jsonRequest("/api/assets", { method: "POST", body });
      await loadAssets();
      setNotice({ tone: "success", text: t.uploaded });
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : t.failed }); }
    finally { setUploading(false); }
  }

  function toggleReference(id: string) {
    setDraft(current => {
      if (!current) return null;
      const selected = current.referenceAssetIds.includes(id);
      if (!selected && current.referenceAssetIds.length >= 50) return current;
      return { ...current, referenceAssetIds: selected
        ? current.referenceAssetIds.filter(item => item !== id)
        : [...current.referenceAssetIds, id] };
    });
  }

  function startRender() {
    if (!board || !canRender || renderJob && !DONE_STATES.has(renderJob.state)) return;
    void act(async () => {
      const snapshot = storyboardRenderSnapshot(board);
      const requestKey = renderRequestKey(board.id);
      const identity = chooseStoryboardRenderRequest(localStorage.getItem(requestKey), snapshot,
        () => crypto.randomUUID());
      localStorage.setItem(requestKey, JSON.stringify(identity));
      const payload = await jsonRequest(`/api/storyboards/${board.id}/render`, {
        method: "POST", headers: { "Idempotency-Key": identity.key } });
      const job = mediaJobFromPayload(payload);
      if (!job || !uuid.test(job.id)) throw new Error(t.failed);
      localStorage.setItem(requestKey, JSON.stringify({ ...identity, jobId: job.id }));
      localStorage.setItem(renderKey(board.id), job.id);
      if (activeBoardId.current === board.id) {
        setRenderJob(job);
        setRenderJobId(job.id);
      }
    }, t.renderQueued);
  }

  const languageButton = <button className={styles.iconButton} type="button" onClick={() => setLocale(locale === "en" ? "fa" : "en")}
    title={t.language} aria-label={t.language}>{locale === "en" ? "FA" : "EN"}</button>;
  const themeButton = <button className={styles.iconButton} type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}
    title={t.theme} aria-label={t.theme}>{theme === "light" ? <Moon size={18} /> : <Sun size={18} />}</button>;

  return <div className={styles.page}>
    <header className={styles.topbar}>
      <Link href="/" className={styles.brand}><span className={styles.mark}>A</span><span>Ailoom</span><span className={styles.brandDivider} /> <span className={styles.brandSection}>Storyboard</span></Link>
      <div className={styles.topActions}><Link href="/" className={styles.backLink}>{locale === "fa" ? <ArrowRight size={17} /> : <ArrowLeft size={17} />}{t.back}</Link>{languageButton}{themeButton}</div>
    </header>

    <div className={styles.hero}><div><div className={styles.eyebrow}><span className={styles.eyebrowDot} />{t.eyebrow}</div>
      <h1>{t.title}</h1><p>{t.description}</p></div><div className={styles.privateBadge}><Check size={15} />{t.private}</div></div>

    {!user ? <section className={styles.signedOut}><Layers3 size={35} /><h2>{t.signIn}</h2><p>{t.signInDescription}</p><Link className={styles.primaryButton} href="/">{t.signInAction}</Link></section> :
    <div className={styles.layout}>
      <aside className={styles.sidebar} aria-label={t.boardLabel}>
        <div className={styles.sideHead}><div><span className={styles.sectionKicker}>01 / {t.boardLabel}</span><h2>{t.boardLabel}</h2></div><span className={styles.countPill}>{boards.length}</span></div>
        <form className={styles.createForm} onSubmit={createBoard}>
          <label className={styles.srOnly} htmlFor="new-board-name">{t.boardName}</label>
          <input id="new-board-name" value={newBoardTitle} onChange={event => setNewBoardTitle(event.target.value)} placeholder={t.boardName} maxLength={120} disabled={busy} />
          <button type="submit" className={styles.createButton} disabled={busy || !newBoardTitle.trim()} title={t.createBoard} aria-label={t.createBoard}>{busy ? <LoaderCircle size={17} className={styles.spin} /> : <Plus size={19} />}</button>
        </form>
        <div className={styles.boardList}>
          {loading && <div className={styles.mutedBlock}>{t.loading}</div>}
          {!loading && boards.length === 0 && <div className={styles.mutedBlock}>{t.noBoardsDescription}</div>}
          {boards.map(item => <button key={item.id} className={`${styles.boardItem} ${boardId === item.id ? styles.boardItemActive : ""}`} type="button" onClick={() => selectBoard(item.id)} aria-current={boardId === item.id ? "page" : undefined}>
            <span className={styles.boardGlyph}><Clapperboard size={17} /></span><span className={styles.boardItemText}><strong>{item.title}</strong><small>{item.description || t.private}</small></span><ChevronDown size={15} className={styles.boardChevron} /></button>)}
        </div>
        <div className={styles.sideFoot}>{t.signedIn} <strong dir="ltr">{user.email}</strong></div>
      </aside>

      <main className={styles.main}>
        {notice && <div className={`${styles.notice} ${notice.tone === "error" ? styles.noticeError : ""}`} role="status"><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)} aria-label={t.closeEditor}><X size={16} /></button></div>}
        {!boardId && !loading && <div className={styles.emptyBoard}><div className={styles.emptyVisual}><Film size={48} /></div><span className={styles.sectionKicker}>02 / {t.selectBoard}</span><h2>{t.noBoards}</h2><p>{t.noBoardsDescription}</p></div>}
        {boardId && boardLoading && <div className={styles.loadingPanel}><LoaderCircle size={24} className={styles.spin} />{t.loading}</div>}
        {board && <>
          <section className={styles.panel} aria-label={t.boardDetails}>
            <div className={styles.panelHead}><span className={styles.sectionKicker}>02 / {t.boardDetails}</span><button className={styles.textDanger} type="button" onClick={deleteBoard} disabled={busy}><Trash2 size={15} />{t.deleteBoard}</button></div>
            <form onSubmit={saveBoard} className={styles.boardForm}><div className={styles.field}><label htmlFor="board-title">{t.boardName}</label><input id="board-title" value={boardTitle} onChange={event => setBoardTitle(event.target.value)} maxLength={120} required /></div>
              <div className={styles.field}><label htmlFor="board-description">{t.descriptionLabel}</label><textarea id="board-description" value={boardDescription} onChange={event => setBoardDescription(event.target.value)} maxLength={2000} rows={2} /></div>
              <button className={styles.subtleButton} type="submit" disabled={busy || (!boardTitle.trim()) || (boardTitle === board.title && boardDescription === board.description)}>{t.saveBoard}</button></form>
          </section>

          <section className={styles.panel} aria-label={t.shots}>
            <div className={styles.panelHead}><div><span className={styles.sectionKicker}>03 / {t.shots}</span><h2>{t.shots} <span className={styles.countPill}>{board.shots.length} {t.shotCount}</span></h2></div><button className={styles.primaryButton} type="button" onClick={() => beginShot()} disabled={busy || board.shots.length >= 64 || models.length === 0}><Plus size={17} />{t.addShot}</button></div>
            {models.length === 0 && <p className={styles.inlineHint}>{t.noModels}</p>}
            {board.shots.length === 0 ? <div className={styles.emptyShots}><span className={styles.emptyIcon}><Layers3 size={25} /></span><h3>{t.noShots}</h3><p>{t.noShotsDescription}</p></div> :
              <ol className={styles.shotList}>{board.shots.map((shot, index) => <li className={styles.shotCard} key={shot.id}>
                <div className={styles.shotNumber}>{String(index + 1).padStart(2, "0")}</div>
                <div className={styles.shotBody}><div className={styles.shotTitleRow}><h3>{shot.title}</h3>{shot.outputAssetId && <span className={styles.readyTag}><Check size={12} />{t.clipReady}</span>}</div><p dir="auto">{shot.prompt}</p><div className={styles.shotMeta}><span>{models.find(item => item.id === shot.modelId)?.name || shot.modelId}</span><span>{shot.durationSec}s</span><span>{shot.aspectRatio}</span>{shot.referenceAssetIds.length > 0 && <span>{shot.referenceAssetIds.length} {t.references}</span>}</div></div>
                <div className={styles.shotActions}><button type="button" className={styles.smallIcon} title={t.moveEarlier} aria-label={`${t.moveEarlier}: ${shot.title}`} onClick={() => moveShot(index, -1)} disabled={busy || index === 0}><ArrowUp size={16} /></button><button type="button" className={styles.smallIcon} title={t.moveLater} aria-label={`${t.moveLater}: ${shot.title}`} onClick={() => moveShot(index, 1)} disabled={busy || index === board.shots.length - 1}><ArrowDown size={16} /></button><button type="button" className={styles.smallText} onClick={() => beginShot(shot)} disabled={busy}>{t.edit}</button><button type="button" className={styles.smallIcon} title={t.deleteShot} aria-label={`${t.deleteShot}: ${shot.title}`} onClick={() => deleteShot(shot)} disabled={busy}><Trash2 size={16} /></button></div>
              </li>)}</ol>}
            <p className={styles.limitNote}>{t.maxShots}</p>
          </section>

          {draft && <section className={styles.panel} id="shot-editor" aria-label={t.shotEditor}>
            <div className={styles.panelHead}><div><span className={styles.sectionKicker}>04 / {t.shotEditor}</span><h2>{draft.id ? t.editShot : t.newShot}</h2></div><button className={styles.smallIcon} type="button" onClick={() => setDraft(null)} aria-label={t.closeEditor}><X size={19} /></button></div>
            <form className={styles.editor} onSubmit={saveShot}>
              <div className={styles.field}><label htmlFor="shot-title">{t.shotTitle}</label><input id="shot-title" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} maxLength={120} required /></div>
              <div className={styles.field}><label htmlFor="shot-prompt">{t.prompt}</label><textarea id="shot-prompt" value={draft.prompt} onChange={event => setDraft({ ...draft, prompt: event.target.value })} placeholder={t.promptHint} maxLength={4000} rows={5} dir="auto" required /></div>
              <div className={styles.threeFields}><div className={styles.field}><label htmlFor="shot-model">{t.model}</label><select id="shot-model" value={draft.modelId} onChange={event => setModel(event.target.value)} required><option value="" disabled>{t.modelRequired}</option>{modelOptions.map(item => <option key={item.id} value={item.id}>{item.name} · {item.provider}</option>)}</select></div>
                <div className={styles.field}><label htmlFor="shot-duration">{t.duration}</label><select id="shot-duration" value={draft.durationSec} onChange={event => setDraft({ ...draft, durationSec: Number(event.target.value) })}>{(draft.modelId.startsWith("fal-ai/veo3.1/") ? [4, 6, 8] : Array.from({ length: 27 }, (_, i) => i + 4)).map(seconds => <option key={seconds} value={seconds}>{seconds} {t.seconds}</option>)}</select></div>
                <div className={styles.field}><label htmlFor="shot-aspect">{t.aspect}</label><select id="shot-aspect" value={draft.aspectRatio} onChange={event => setDraft({ ...draft, aspectRatio: event.target.value as ShotAspect })}>{(draft.modelId.startsWith("fal-ai/veo3.1/") ? ASPECTS.slice(0, 2) : ASPECTS).map(aspect => <option key={aspect} value={aspect}>{aspect}</option>)}</select></div></div>
              {currentModel && <p className={styles.modelNote}>{currentModel.priceNote || currentModel.provider}</p>}
              <div className={styles.assetGrid}>
                <AssetSelect id="first-frame" label={t.firstFrame} value={draft.firstFrameAssetId} kind="image" assets={assets} copy={t} onChange={value => setDraft({ ...draft, firstFrameAssetId: value })} />
                <AssetSelect id="last-frame" label={t.lastFrame} value={draft.lastFrameAssetId} kind="image" assets={assets} copy={t} onChange={value => setDraft({ ...draft, lastFrameAssetId: value })} />
                <AssetSelect id="output-clip" label={t.output} value={draft.outputAssetId} kind="video" assets={assets} copy={t} onChange={value => setDraft({ ...draft, outputAssetId: value })} />
              </div>
              <details className={styles.referenceDetails}><summary>{t.references} <span>{draft.referenceAssetIds.length} {t.selected}</span><ChevronDown size={16} /></summary>
                <div className={styles.referenceList}>{referenceChoices.length === 0 && <p>{t.noMedia}</p>}{referenceChoices.map(item => <label key={item.id} className={styles.referenceItem}><input type="checkbox" checked={draft.referenceAssetIds.includes(item.id)} onChange={() => toggleReference(item.id)} disabled={!draft.referenceAssetIds.includes(item.id) && draft.referenceAssetIds.length >= 50} /><span>{assetLabel(item.asset, item.id, t)}</span></label>)}</div>
              </details>
              {draft.outputAssetId && <a className={styles.assetLink} href={`/api/assets/${draft.outputAssetId}`} target="_blank" rel="noreferrer">{t.openClip} <ArrowRight size={14} /></a>}
              <div className={styles.formActions}><button className={styles.primaryButton} type="submit" disabled={busy || !draft.modelId}>{busy ? t.saving : t.saveShot}</button><button className={styles.subtleButton} type="button" onClick={() => setDraft(null)}>{t.cancel}</button></div>
            </form>
          </section>}

          <section className={styles.panel} aria-label={t.renderTitle}>
            <div className={styles.panelHead}><div><span className={styles.sectionKicker}>04 / {t.renderTitle}</span><h2>{t.renderTitle}</h2></div><Film size={22} className={styles.panelIcon} /></div>
            <p className={styles.inlineHint}>{canRender ? t.renderReady : `${t.renderMissing} ${renderReadiness.completed}/${renderReadiness.total}`}</p>
            <div className={styles.renderActions}><button type="button" className={styles.primaryButton} onClick={startRender} disabled={!canRender || busy || (!!renderJob && !DONE_STATES.has(renderJob.state))}><WandSparkles size={17} />{t.renderButton}</button>
              {renderJob && <span className={styles.renderState}>{t.renderStatus}: {t[`job_${renderJob.state}` as keyof typeof t] || renderJob.state}</span>}
              {clip && <a className={styles.subtleButton} href={clip.url} download={`${board.title.trim().replace(/[^\w\-]+/g, "-") || "ailoom"}.mp4`}>{t.renderDownload}</a>}</div>
            {renderJob?.state === "failed" && <p className={styles.errorText}>{renderJob.errorCode || t.renderFailed}</p>}
          </section>

          <section className={styles.panel} aria-label={t.library}>
            <div className={styles.panelHead}><div><span className={styles.sectionKicker}>05 / {t.library}</span><h2>{t.library}</h2></div><button type="button" className={styles.smallIcon} onClick={() => void loadAssets().catch(error => setNotice({ tone: "error", text: error instanceof Error ? error.message : t.failed }))} title={t.refresh} aria-label={t.refresh}><RefreshCw size={17} /></button></div>
            <div className={styles.libraryTools}><input value={assetSearch} onChange={event => setAssetSearch(event.target.value)} placeholder={t.mediaSearch} aria-label={t.mediaSearch} /><label className={styles.uploadButton}><UploadCloud size={17} />{uploading ? t.uploading : t.upload}<input type="file" accept="image/*,video/*,audio/*" onChange={uploadFile} disabled={uploading} /></label></div>
            <div className={styles.assetList}>{filteredAssets.length === 0 && <p className={styles.inlineHint}>{t.noMedia}</p>}{filteredAssets.slice(0, 36).map(asset => <a key={asset.id} href={asset.url} target="_blank" rel="noreferrer" className={styles.assetItem}><span className={styles.assetIcon}>{asset.kind === "image" ? <ImageIcon size={18} /> : asset.kind === "video" ? <Film size={18} /> : <Layers3 size={18} />}</span><span className={styles.assetText}><strong>{asset.originalName || asset.id.slice(0, 8)}</strong><small>{t[asset.kind]} · {asset.source === "upload" ? t.sourceUpload : t.sourceGeneration}</small></span><ArrowRight size={15} /></a>)}</div>
            {assetCursor && <button className={styles.subtleButton} type="button" onClick={() => void loadAssets(assetCursor).catch(error => setNotice({ tone: "error", text: error instanceof Error ? error.message : t.failed }))}>{t.loadMore}</button>}
          </section>
          <p className={styles.disclaimer}>{t.planOnly}</p>
        </>}
      </main>
    </div>}
  </div>;
}

function AssetSelect({ id, label, value, kind, assets, copy, onChange }: {
  id: string; label: string; value: string | null; kind: "image" | "video";
  assets: StoryboardAsset[]; copy: typeof storyboardCopy.en; onChange: (value: string | null) => void;
}) {
  const matching = assets.filter(item => item.kind === kind);
  const missing = value && !matching.some(item => item.id === value);
  return <div className={styles.field}><label htmlFor={id}>{label}</label><select id={id} value={value || ""} onChange={event => onChange(event.target.value || null)}>
    <option value="">{copy.none}</option>{missing && <option value={value}>{value.slice(0, 8)}</option>}
    {matching.map(item => <option key={item.id} value={item.id}>{assetLabel(item, item.id, copy)}</option>)}
  </select></div>;
}
