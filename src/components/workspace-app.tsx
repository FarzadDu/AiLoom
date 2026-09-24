"use client";

import {
  ArrowRight,
  ArrowUp,
  AudioLines,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  Compass,
  Download,
  FileText,
  Image as ImageIcon,
  Layers3,
  MessageCircle,
  Moon,
  Paperclip,
  Play,
  Plus,
  RotateCw,
  Scissors,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Upload,
  UsersRound,
  Video,
  Volume2,
  X,
  type LucideIcon
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { conversationsFromPayload, messagesFromPayload, modelsFromPayload, readChatStream, responseError, sessionUserFromPayload, type ChatMessage, type ChatModel, type ConversationSummary, type SessionUser } from "./chat-api";
import { ExplorePage as ConnectedExplorePage, SpecialistsPage as ConnectedSpecialistsPage } from "./content-pages";
import { libraryPageFromPayload, mediaAssetsFromJob, mediaDownloadName, mediaJobFromPayload, mediaModelsFromPayload, type LibraryAsset, type MediaAsset, type MediaJob, type MediaModel } from "./media-api";
import { copy, mediaViews, modelOptions, views, type Locale, type MediaView, type Theme, type View } from "./workspace-data";

type Drafts = Record<View, string>;
type Models = Record<View, string>;
type LocalFile = { name: string; mime: string; url: string; file?: File; assetId?: string };
type OutputTab = "text" | "image" | "video" | "audio";
type StudioRequestOptions = { modeIndex: number; aspect: string; quality: string; duration: number | "auto"; audio: boolean; modelId: string; language: string; repairStart: number; repairEnd: number };

const navIcons: Record<View, LucideIcon> = {
  chat: MessageCircle,
  image: ImageIcon,
  video: Video,
  audio: AudioLines,
  explore: Compass,
  specialists: UsersRound
};

const emptyDrafts: Drafts = { chat: "", image: "", video: "", audio: "", explore: "", specialists: "" };
const defaultModels: Models = { chat: "openrouter/auto", image: "fal-ai/flux-2-pro", video: "fal-ai/veo3.1/fast", audio: "fal-ai/elevenlabs/tts/eleven-v3", explore: "auto", specialists: "auto" };

function isMediaView(view: View): view is MediaView {
  return mediaViews.includes(view as MediaView);
}

function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* Private browsing can disable storage. */ }
}

function viewFromHash(): View {
  const value = window.location.hash.replace(/^#\/?/, "");
  return views.includes(value as View) ? value as View : "chat";
}

function directionForText(value: string, locale: Locale): "ltr" | "rtl" {
  const match = value.trimStart().match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FFa-zA-Z]/);
  return match ? /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(match[0]) ? "rtl" : "ltr" : locale === "fa" ? "rtl" : "ltr";
}

function renderMessageText(value: string) {
  const parts: (string | React.ReactElement)[] = [];
  const links = /\[([^\]\n]{1,160})\]\((https:\/\/[^\s)]+)\)/g;
  let cursor = 0;
  for (const match of value.matchAll(links)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(value.slice(cursor, index));
    parts.push(<a key={`${index}-${match[2]}`} href={match[2]} target="_blank" rel="noopener noreferrer">{match[1]}</a>);
    cursor = index + match[0].length;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts;
}

function BrandMark() {
  return <span className="brand-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3.5 17.5 9 6l3 6.1L15 6l5.5 11.5M6 13.5h12" /></svg></span>;
}

function ModelPicker({ view, locale, value, onChange, options }: { view: View; locale: Locale; value: string; onChange: (value: string) => void; options?: ChatModel[] }) {
  const t = copy[locale];
  const entries = options ?? modelOptions[view];
  const normalized = entries.map(option => ({ id: option.id, name: "label" in option ? option.label : option.name }));
  const selected = normalized.find(option => option.id === value) ?? { id: value, name: value };
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const filtered = query.trim()
    ? normalized.filter(option => `${option.name} ${option.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 60)
    : [selected, ...normalized.filter(option => option.id !== selected.id)].slice(0, 12);
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); pickerRef.current?.querySelector("button")?.focus(); }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);
  useEffect(() => { setOpen(false); setQuery(""); }, [options]);
  return (
    <div className="model-picker" ref={pickerRef}>
      <button type="button" className="model-picker-trigger" aria-label={`${t.model}: ${selected.name}`} aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen(previous => !previous)}><Sparkles size={17} aria-hidden="true" /><span>{selected.id === "openrouter/auto" ? t.smartChoice : selected.name}</span><ChevronDown size={14} aria-hidden="true" /></button>
      {open && <div className="model-popover" id={listId} role="group" aria-label={t.model}>
        <input ref={searchRef} type="search" aria-label={t.searchModels} placeholder={t.searchModels} value={query} onChange={event => setQuery(event.target.value)} />
        <div className="model-results">{filtered.length ? filtered.map(option => <button type="button" key={option.id} className="model-result" aria-current={option.id === value ? "true" : undefined} onClick={() => { onChange(option.id); setOpen(false); setQuery(""); }}><span>{option.id === "openrouter/auto" ? t.smartChoice : option.name}</span><small dir="ltr">{option.id}</small>{option.id === value && <Check size={16} aria-hidden="true" />}</button>) : <p>{t.noModelsFound}</p>}</div>
      </div>}
    </div>
  );
}

function Header({ locale, theme, view, user, onLocale, onTheme, onNavigate, onLogin, onSignOut }: {
  locale: Locale; theme: Theme; view: View; onLocale: (locale: Locale) => void; onTheme: () => void;
  onNavigate: (view: View) => void; onLogin: () => void; onSignOut: () => void; user: SessionUser | null;
}) {
  const t = copy[locale];
  return (
    <header className="site-header">
      <div className="header-inner">
        <a className="brand" href="#/chat" aria-label={t.home} onClick={event => { event.preventDefault(); onNavigate("chat"); }}><BrandMark /><span className="brand-name">Ailoom</span></a>
        <nav className="top-nav" aria-label={t.menu}>
          {views.map(item => <button type="button" key={item} aria-current={view === item ? "page" : undefined} onClick={() => onNavigate(item)}>{t.nav[item]}</button>)}
        </nav>
        <div className="header-actions">
          {user?.role === "admin" && <a className="sign-in admin-link" href="/admin">{t.admin}</a>}
          <div className="language-picker" role="group" aria-label={t.chooseLanguage}>
            <button type="button" aria-pressed={locale === "en"} onClick={() => onLocale("en")}>EN</button>
            <button type="button" aria-pressed={locale === "fa"} onClick={() => onLocale("fa")}>فا</button>
          </div>
          <button type="button" className="icon-button" aria-label={t.changeTheme} onClick={onTheme}>{theme === "light" ? <Moon size={20} /> : <Sun size={20} />}</button>
          {user ? <button type="button" className="sign-in user-button" title={user.email} onClick={onSignOut}>{t.signOut}</button> : <button type="button" className="sign-in" onClick={onLogin}>{t.signIn}</button>}
        </div>
      </div>
    </header>
  );
}

function ChatComposer({ locale, prompt, onPrompt, model, onModel, modelList, mode, onMode, webSearch, onWebSearch, onSubmit, attachment, onAttach, onRemoveAttachment, inputRef, compact = false, disabled = false }: {
  locale: Locale; prompt: string; onPrompt: (value: string) => void; model: string; onModel: (value: string) => void;
  mode: "text" | "image"; onMode: (mode: "text" | "image") => void;
  webSearch: boolean; onWebSearch: (enabled: boolean) => void;
  onSubmit: () => void; attachment: LocalFile | null; onAttach: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveAttachment: () => void; inputRef: RefObject<HTMLTextAreaElement | null>; modelList?: ChatModel[];
  compact?: boolean; disabled?: boolean;
}) {
  const t = copy[locale];
  const fileRef = useRef<HTMLInputElement>(null);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); onSubmit(); };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit();
    }
  };
  return (
    <form className={`composer${compact ? " composer-compact" : ""}`} onSubmit={handleSubmit}>
      {!compact && <div className="panel-heading"><strong>{t.newConversation}</strong><span className="panel-caption">{t.ideaBegins}</span></div>}
      <div className="prompt-area">
        <label className="sr-only" htmlFor="chat-prompt">{t.newConversation}</label>
        <textarea id="chat-prompt" ref={inputRef} value={prompt} onChange={event => onPrompt(event.target.value)} onKeyDown={handleKeyDown} dir={directionForText(prompt, locale)} placeholder={mode === "image" ? t.chatImagePlaceholder : t.chatPlaceholder} rows={compact ? 2 : 4} disabled={disabled} />
        {attachment && <div className="attachment-pill"><Paperclip size={15} aria-hidden="true" /><span title={attachment.name}>{attachment.name}</span><button type="button" aria-label={t.removeFile} onClick={onRemoveAttachment}><X size={15} /></button></div>}
      </div>
      <div className="composer-toolbar">
        <div className="toolbar-left">
          <input ref={fileRef} className="sr-only" type="file" accept={mode === "text" ? "image/png,image/jpeg,image/webp,application/pdf" : "image/png,image/jpeg,image/webp"} onChange={event => { onAttach(event); event.currentTarget.value = ""; }} aria-label={t.attach} />
          <button type="button" className="attach-button" onClick={() => fileRef.current?.click()} aria-label={t.attach}><Plus size={20} /></button>
          <button type="button" className="chat-image-mode" aria-label={mode === "image" ? t.chatTextModeHint : t.chatImageModeHint} aria-pressed={mode === "image"} title={mode === "image" ? t.chatTextModeHint : t.chatImageModeHint} disabled={disabled} onClick={() => onMode(mode === "image" ? "text" : "image")}><ImageIcon size={18} aria-hidden="true" /><span>{t.chatImageMode}</span></button>
          {mode === "text" && <button type="button" className="chat-web-mode" aria-label={attachment ? t.webSearchNoImage : t.webSearchHint} aria-pressed={webSearch} title={attachment ? t.webSearchNoImage : t.webSearchHint} disabled={disabled || Boolean(attachment)} onClick={() => onWebSearch(!webSearch)}><Compass size={18} aria-hidden="true" /><span>{t.webSearch}</span></button>}
          <ModelPicker view="chat" locale={locale} value={model} onChange={onModel} options={modelList} />
        </div>
        <button className="send-button" type="submit" disabled={disabled}><span>{t.send}</span><ArrowUp size={19} aria-hidden="true" /></button>
      </div>
    </form>
  );
}

function ChatLanding({ locale, prompt, setPrompt, model, setModel, modelList, mode, onMode, webSearch, onWebSearch, onSubmit, onNavigate, onStarter, attachment, onAttach, onRemoveAttachment, inputRef }: {
  locale: Locale; prompt: string; setPrompt: (value: string) => void; model: string; setModel: (value: string) => void;
  mode: "text" | "image"; onMode: (mode: "text" | "image") => void;
  webSearch: boolean; onWebSearch: (enabled: boolean) => void;
  onSubmit: () => void; onNavigate: (view: View) => void; onStarter: (view: View, prompt: string) => void; attachment: LocalFile | null;
  onAttach: (event: ChangeEvent<HTMLInputElement>) => void; onRemoveAttachment: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>; modelList: ChatModel[];
}) {
  const t = copy[locale];
  const [outputTab, setOutputTab] = useState<OutputTab>("text");
  const outputTabs: OutputTab[] = ["text", "image", "video", "audio"];
  const OutputIcon = outputTab === "image" ? ImageIcon : outputTab === "video" ? Video : outputTab === "audio" ? AudioLines : FileText;
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">{t.welcome}</p>
          <h1 id="hero-title"><span>{t.chatHeadingFirst}</span><br /><em>{t.chatHeadingSecond}</em></h1>
          <p className="hero-description">{t.chatDescription}</p>
          <div className="hero-aside"><ShieldCheck size={18} aria-hidden="true" /><span>{t.privateWorkspace}</span></div>
        </div>
        <div className="work-surface">
          <ChatComposer locale={locale} prompt={prompt} onPrompt={setPrompt} model={model} onModel={setModel} modelList={modelList} mode={mode} onMode={onMode} webSearch={webSearch} onWebSearch={onWebSearch} onSubmit={onSubmit} attachment={attachment} onAttach={onAttach} onRemoveAttachment={onRemoveAttachment} inputRef={inputRef} />
          <p className="composer-note"><ShieldCheck size={16} aria-hidden="true" />{t.startTyping}</p>
          <div className="starter-line"><span className="starter-label">{t.starterLabel}</span>{t.starters.map(item => <button type="button" key={item.label} onClick={() => { onStarter(item.view, item.prompt); if (item.view === "chat") inputRef.current?.focus(); }}>{item.label}</button>)}</div>
        </div>
      </section>
      <section className="capabilities" aria-labelledby="capabilities-title">
        <div className="capabilities-inner">
          <div className="section-intro"><div><span className="section-eyebrow">{t.madeForProcess}</span><h2 id="capabilities-title">{t.fromThought}</h2></div><p>{t.wholeProcess}</p></div>
          <div className="capability-list">
            {views.map(item => { const Icon = navIcons[item]; return <button className="capability" type="button" key={item} onClick={() => onNavigate(item)}><span className="capability-icon"><Icon size={21} aria-hidden="true" /></span><span className="capability-copy"><strong>{t.nav[item]}</strong><span>{t.capabilityDescription[item]}</span></span><ArrowRight className="capability-arrow" size={19} aria-hidden="true" /></button>; })}
          </div>
        </div>
      </section>
      <section className="outputs-section" aria-labelledby="outputs-title">
        <div className="outputs-inner">
          <div className="output-heading"><span className="section-eyebrow">{t.outputEyebrow}</span><h2 id="outputs-title">{t.outputTitle}</h2><p>{t.outputDescription}</p></div>
          <div className="output-demo">
            <div className="output-demo-top"><span className="sample-tag"><Sparkles size={15} aria-hidden="true" />{t.sampleOnly}</span><span className="demo-dots" aria-hidden="true"><i /><i /><i /></span></div>
            <div className="sample-user"><span>{t.samplePrompt}</span></div>
            <div className="sample-assistant">
              <span className="assistant-mark"><BrandMark /></span>
              <div className="assistant-body">
                <div className="output-tabs" role="group" aria-label={t.outputTitle}>{outputTabs.map(tab => <button key={tab} type="button" aria-pressed={outputTab === tab} onClick={() => setOutputTab(tab)}>{t.outputTabs[tab]}</button>)}</div>
                <div className="output-panel">
                  {outputTab === "text" ? <><p>{t.sampleText}</p><div className="source-slots"><BookOpen size={16} aria-hidden="true" /><span>{t.sourceLabel}</span><span className="source-line" /><span className="source-line short" /></div></> : <><div className={`media-output media-output-${outputTab}`}><OutputIcon size={30} aria-hidden="true" /><strong>{outputTab === "image" ? t.imageOutput : outputTab === "video" ? t.videoOutput : t.audioOutput}</strong><span>{t.outputPlaceholder}</span>{outputTab === "audio" && <div className="fake-wave" aria-hidden="true">{Array.from({ length: 19 }, (_, index) => <i key={index} style={{ height: `${8 + ((index * 13) % 28)}px` }} />)}</div>}</div><p className="export-note">{t.exportReady}</p></>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function ChatWorkspace({ locale, user, conversations, historyLoading, selectedId, messages, messageLoading, pending, error, prompt, onPrompt, model, onModel, modelList, mode, onMode, webSearch, onWebSearch, onSend, onSelect, onNew, attachment, onAttach, onRemoveAttachment, inputRef }: {
  locale: Locale; user: SessionUser; conversations: ConversationSummary[]; historyLoading: boolean; selectedId: string | null;
  messages: ChatMessage[]; messageLoading: boolean; pending: boolean; error: string;
  prompt: string; onPrompt: (value: string) => void; model: string; onModel: (value: string) => void; modelList: ChatModel[];
  mode: "text" | "image"; onMode: (mode: "text" | "image") => void;
  webSearch: boolean; onWebSearch: (enabled: boolean) => void;
  onSend: () => void; onSelect: (id: string) => void; onNew: () => void;
  attachment: LocalFile | null; onAttach: (event: ChangeEvent<HTMLInputElement>) => void; onRemoveAttachment: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const t = copy[locale];
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);
  const activeTitle = conversations.find(item => item.id === selectedId)?.title ?? t.newChat;
  return (
    <section className="chat-workspace" aria-label={t.nav.chat}>
      <aside className="chat-history" aria-label={t.conversationHistory}>
        <div className="chat-history-header"><strong>{t.conversationHistory}</strong><button type="button" aria-label={t.newChat} onClick={onNew}><Plus size={19} /></button></div>
        <button type="button" className="new-chat-button" onClick={onNew}><Plus size={17} aria-hidden="true" />{t.newChat}</button>
        <div className="history-list">
          {historyLoading ? <p className="history-empty">{t.loadingConversations}</p> : conversations.length ? conversations.map(item => <button key={item.id} type="button" aria-current={selectedId === item.id ? "page" : undefined} onClick={() => onSelect(item.id)}><MessageCircle size={16} aria-hidden="true" /><span>{item.title}</span></button>) : <p className="history-empty">{t.noConversations}</p>}
        </div>
        <div className="history-user"><span className="user-avatar" aria-hidden="true">{(user.name?.trim()[0] || user.email[0] || "A").toUpperCase()}</span><span><strong>{user.name || user.email}</strong><small>{user.email}</small></span></div>
      </aside>
      <div className="chat-main">
        <div className="chat-main-header"><span><MessageCircle size={19} aria-hidden="true" /><strong>{activeTitle}</strong></span><span className="chat-model-badge">{modelList.find(item => item.id === model)?.name ?? t.smartChoice}</span></div>
        <div className="messages-area" role="log" aria-live="polite" aria-label={t.nav.chat}>
          {messageLoading ? <div className="chat-empty"><p>{t.loadingMessages}</p></div>
            : messages.length ? <div className="message-stack">{messages.map(message =>
              <div key={message.id} className={`chat-message chat-message-${message.role}`}>
                <span className="message-icon" aria-hidden="true">{message.role === "assistant" ? <BrandMark /> : (user.name?.trim()[0] || user.email[0] || "U").toUpperCase()}</span>
                <div className="message-body">
                  <span className="message-author">{message.role === "assistant" ? "Ailoom" : user.name || user.email}</span>
                  {(message.text || message.status === "streaming") && <div dir={directionForText(message.text, locale)}>{renderMessageText(message.text || "…")}</div>}
                  {message.blocks?.filter(block => block.type !== "text").map((block, index) => {
                    if (block.type === "sources") return <div className="message-sources" key={`sources-${index}`}><strong><BookOpen size={16} aria-hidden="true" />{t.sourceLinks}</strong><div>{block.sources?.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<ArrowRight size={14} aria-hidden="true" /></a>)}</div></div>;
                    const url = block.url ?? (block.assetId ? `/api/assets/${encodeURIComponent(block.assetId)}` : "");
                    return <div className="message-media" key={block.assetId ?? block.url ?? index}>{block.type === "image" ? <img src={url} alt={block.alt || t.imageOutput} /> : block.type === "video" ? <video src={url} controls /> : block.type === "audio" ? <audio src={url} controls /> : <a href={url} download><FileText size={19} aria-hidden="true" />{block.alt || t.outputTabs.text}</a>}</div>;
                  })}
                  {message.status === "streaming" && <span className="stream-cursor" aria-hidden="true" />}
                </div>
              </div>)}<div ref={endRef} /></div>
            : <div className="chat-empty"><BrandMark /><h1>{t.chatHeadingFirst}<br /><em>{t.chatHeadingSecond}</em></h1><p>{t.noMessages}</p></div>}
        </div>
        <div className="chat-compose-wrap">
          {error && <div className="chat-error" role="alert">{error}</div>}
          <ChatComposer locale={locale} prompt={prompt} onPrompt={onPrompt} model={model} onModel={onModel} modelList={modelList} mode={mode} onMode={onMode} webSearch={webSearch} onWebSearch={onWebSearch} onSubmit={onSend} attachment={attachment} onAttach={onAttach} onRemoveAttachment={onRemoveAttachment} inputRef={inputRef} compact disabled={pending} />
          <p className="chat-compose-note">{t.draftSaved}</p>
        </div>
      </div>
    </section>
  );
}

function GeneratedResult({ asset, locale, initialVisibility, onVisibilityChange }: {
  asset: MediaAsset; locale: Locale; initialVisibility?: "public" | "private";
  onVisibilityChange?: (visibility: "public" | "private") => void;
}) {
  const t = copy[locale];
  const [visibility, setVisibility] = useState<"public" | "private" | null>(initialVisibility ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    if (!asset.id) return;
    const controller = new AbortController();
    setVisibility(null);
    setError("");
    fetch(`/api/assets/${asset.id}/metadata`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(await responseError(response)); return response.json(); })
      .then(body => {
        if (body?.visibility !== "public" && body?.visibility !== "private") throw new Error(t.assetVisibilityError);
        setVisibility(body.visibility);
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t.assetVisibilityError); });
    return () => controller.abort();
  }, [asset.id, t.assetVisibilityError, refreshKey]);
  const changeVisibility = async () => {
    if (!asset.id || !visibility || saving) return;
    const next = visibility === "private" ? "public" : "private";
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/assets/${asset.id}`, {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next })
      });
      if (!response.ok) throw new Error(await responseError(response));
      const body = await response.json();
      if (body?.visibility !== next) throw new Error(t.assetVisibilityError);
      setVisibility(next);
      onVisibilityChange?.(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.assetVisibilityError); }
    finally { setSaving(false); }
  };
  return <div className="generated-result">
    {asset.kind === "image" ? <img src={asset.url} alt={t.imageOutput} /> : asset.kind === "video" ? <video src={asset.url} controls /> : asset.kind === "audio" ? <audio src={asset.url} controls /> : null}
    <div className="result-actions"><a href={asset.url} target="_blank" rel="noreferrer">{t.openResult}<ArrowRight size={15} aria-hidden="true" /></a>
      {asset.id && <a href={asset.url} download={mediaDownloadName(asset)}><Download size={15} aria-hidden="true" />{t.downloadResult}</a>}
      {asset.id && <div className="asset-visibility"><span role="status"><ShieldCheck size={15} aria-hidden="true" />{visibility === null ? error ? t.assetVisibilityUnavailable : t.assetVisibilityLoading : visibility === "public" ? t.assetPublic : t.assetPrivate}</span>{visibility !== null ? <button type="button" disabled={saving} onClick={() => void changeVisibility()}>{saving ? t.assetVisibilitySaving : visibility === "public" ? t.makePrivate : t.makePublic}</button> : error && <button type="button" onClick={() => setRefreshKey(previous => previous + 1)}>{t.retry}</button>}</div>}
    </div>
    {error && <p className="result-error" role="alert">{error}</p>}
  </div>;
}

function StudioPage({ view, locale, model, onModel, draft, onDraft, onSubmit, preview, onFile, onRemoveFile, availableModels, job, jobError, busy, initialMode, signedIn }: {
  view: MediaView; locale: Locale; model: string; onModel: (value: string) => void;
  draft: string; onDraft: (value: string) => void; onSubmit: (options: StudioRequestOptions) => void;
  preview: LocalFile | null; onFile: (event: ChangeEvent<HTMLInputElement>) => void; onRemoveFile: () => void;
  availableModels: MediaModel[]; job: MediaJob | null; jobError: string; busy: boolean; initialMode: number; signedIn: boolean;
}) {
  const t = copy[locale];
  const [activeMode, setActiveMode] = useState(initialMode);
  const [aspect, setAspect] = useState("16:9");
  const [quality, setQuality] = useState("standard");
  const [language, setLanguage] = useState("auto");
  const [duration, setDuration] = useState<number | "auto">(8);
  const [generateAudio, setGenerateAudio] = useState(true);
  const [clipDuration, setClipDuration] = useState(30);
  const [repairStart, setRepairStart] = useState(10);
  const [repairEnd, setRepairEnd] = useState(12);
  const [library, setLibrary] = useState<LibraryAsset[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [libraryCursor, setLibraryCursor] = useState<string | null>(null);
  const [libraryMoreLoading, setLibraryMoreLoading] = useState(false);
  const [libraryMoreError, setLibraryMoreError] = useState("");
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const libraryMoreController = useRef<AbortController | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const CurrentIcon = navIcons[view];
  const tabs = t.studioTab[view];
  const activeOperation = view === "image" ? activeMode === 0 ? "text_to_image" : activeMode === 1 ? "image_edit" : null
    : view === "video" ? activeMode === 0 ? "text_to_video" : activeMode === 1 ? "reference_to_video" : activeMode === 2 ? "temporal_inpaint" : null
    : activeMode === 0 ? "text_to_speech" : null;
  const relevantModels = activeOperation ? availableModels.filter(item => item.operations.includes(activeOperation) || activeOperation === "reference_to_video" && item.operations.includes("image_to_video")) : [];
  const fallbackModels = modelOptions[view].filter(item => activeOperation === "image_edit" ? item.id === "fal-ai/qwen-image-edit"
    : activeOperation === "temporal_inpaint" ? item.id === "fal-ai/ltx-2.3-quality/inpaint"
    : activeOperation === "reference_to_video" ? item.id === "bytedance/seedance-2.5/reference-to-video" || item.id === "fal-ai/veo3.1/fast/image-to-video"
    : activeOperation === "text_to_image" ? item.id !== "fal-ai/qwen-image-edit"
    : activeOperation === "text_to_video" ? item.id === "fal-ai/veo3.1/fast" || item.id === "bytedance/seedance-2.5/text-to-video" : true);
  const selectModels = relevantModels.length ? relevantModels : fallbackModels.map(item => ({ id: item.id, name: item.label }));
  const effectiveModel = selectModels.some(item => item.id === model) ? model : selectModels[0]?.id || model;
  const outputAssets = mediaAssetsFromJob(job);
  const selectedAsset = library.find(asset => asset.id === selectedAssetId);
  const shownAssets: MediaAsset[] = selectedAsset ? [{ id: selectedAsset.id, kind: selectedAsset.kind,
    url: selectedAsset.url, contentType: selectedAsset.mimeType }] : outputAssets;
  const completedJobId = job?.state === "succeeded" ? job.id : "";
  useEffect(() => { setSelectedAssetId(null); }, [job?.id]);
  useEffect(() => {
    libraryMoreController.current?.abort();
    libraryMoreController.current = null;
    setLibraryMoreLoading(false);
    setLibraryMoreError("");
    setLibraryCursor(null);
    if (!signedIn) { setLibrary([]); setLibraryLoading(false); setLibraryError(""); return; }
    const controller = new AbortController();
    setLibraryLoading(true);
    setLibraryError("");
    fetch(`/api/assets?kind=${view}&source=generation&limit=24`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(await responseError(response)); return response.json(); })
      .then(body => { if (!controller.signal.aborted) {
        const page = libraryPageFromPayload(body, view);
        setLibrary(page.assets);
        setLibraryCursor(page.nextCursor);
      } })
      .catch(error => { if (!controller.signal.aborted) setLibraryError(error instanceof Error ? error.message : t.mediaLibraryError); })
      .finally(() => { if (!controller.signal.aborted) setLibraryLoading(false); });
    return () => { controller.abort(); libraryMoreController.current?.abort(); };
  }, [signedIn, view, completedJobId, libraryRefresh, t.mediaLibraryError]);
  const loadMoreLibrary = async () => {
    if (!signedIn || !libraryCursor || libraryLoading || libraryMoreLoading || libraryMoreController.current) return;
    const controller = new AbortController();
    libraryMoreController.current = controller;
    setLibraryMoreLoading(true);
    setLibraryMoreError("");
    try {
      const response = await fetch(`/api/assets?kind=${view}&source=generation&limit=24&cursor=${encodeURIComponent(libraryCursor)}`,
        { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(await responseError(response));
      const page = libraryPageFromPayload(await response.json(), view);
      if (controller.signal.aborted) return;
      setLibrary(previous => {
        const seen = new Set(previous.map(item => item.id));
        return [...previous, ...page.assets.filter(item => !seen.has(item.id))];
      });
      setLibraryCursor(page.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted) setLibraryMoreError(error instanceof Error ? error.message : t.mediaLibraryError);
    } finally {
      if (libraryMoreController.current === controller) libraryMoreController.current = null;
      if (!controller.signal.aborted) setLibraryMoreLoading(false);
    }
  };
  const onVisibilityChange = (assetId: string, visibility: "private" | "public") => {
    setLibrary(previous => previous.map(asset => asset.id === assetId ? { ...asset, visibility } : asset));
  };
  const openLibraryAsset = (id: string) => {
    setSelectedAssetId(current => current === id ? null : id);
    window.requestAnimationFrame(() => canvasRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start"
    }));
  };
  const accept = view === "image" || view === "video" && activeMode === 1 ? "image/png,image/jpeg,image/webp" : view === "video" ? "video/mp4,video/webm" : "";
  const showRepair = view === "video" && activeMode === 2;
  const needsReference = view === "image" && activeMode === 1 || view === "video" && (activeMode === 1 || activeMode === 2);
  const seedance = effectiveModel.startsWith("bytedance/seedance-2.5/");
  const handleGenerate = () => {
    if (!draft.trim()) { promptRef.current?.focus(); return; }
    onSubmit({ modeIndex: activeMode, aspect, quality, duration, audio: generateAudio, modelId: effectiveModel, language, repairStart, repairEnd });
  };
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => { onFile(event); event.currentTarget.value = ""; };
  const handleMetadata = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const rounded = Math.max(1, Math.floor(value));
    setClipDuration(rounded);
    setRepairStart(Math.min(10, Math.max(0, rounded - 2)));
    setRepairEnd(Math.min(rounded, Math.max(2, Math.min(10, rounded - 2) + 2)));
  };
  return (
    <section className="studio-page" aria-labelledby="studio-title">
      <div className="workspace-heading"><div><span className="section-eyebrow">{t.studioEyebrow}</span><h1 id="studio-title">{t.studioTitle[view]}</h1><p>{t.studioDescription[view]}</p></div><span className="page-indicator"><CurrentIcon size={18} aria-hidden="true" />{t.nav[view]}</span></div>
      <div className="studio-tabs" role="group" aria-label={t.studioTitle[view]}>{tabs.map((name, index) => <button type="button" key={name} aria-pressed={activeMode === index} disabled={view === "image" && index === 2 || view === "audio" && index !== 0} onClick={() => { if (index !== activeMode) { setActiveMode(index); onRemoveFile(); } }}>{name}</button>)}</div>
      <div className="studio-layout">
        <div className="canvas-column" ref={canvasRef}>
          <div className="canvas-top"><strong>{t.canvas}</strong>{selectedAsset ? <button type="button" className="canvas-return" onClick={() => setSelectedAssetId(null)}>{t.mediaLibraryBack}</button> : <span>{preview ? t.localPreview : t.canvasReady}</span>}</div>
          <div className={`studio-canvas studio-canvas-${view}`}>
            {selectedAsset ? <div className="generated-results"><GeneratedResult key={selectedAsset.id} asset={shownAssets[0]} locale={locale} initialVisibility={selectedAsset.visibility} onVisibilityChange={visibility => onVisibilityChange(selectedAsset.id, visibility)} /></div>
              : preview ? ((view === "image" || view === "video" && activeMode === 1) && preview.mime.startsWith("image/") ? <img className="uploaded-media" src={preview.url} alt={preview.name} /> : view === "video" && preview.mime.startsWith("video/") ? <video className="uploaded-media" src={preview.url} controls onLoadedMetadata={event => handleMetadata(event.currentTarget.duration)} /> : null)
              : job?.state === "succeeded" && shownAssets.length ? <div className="generated-results">{shownAssets.map((asset, index) => <GeneratedResult asset={asset} locale={locale} onVisibilityChange={asset.id ? visibility => onVisibilityChange(asset.id!, visibility) : undefined} key={asset.id ?? asset.url + index} />)}</div>
              : job?.state === "succeeded" ? <div className="job-status"><Check size={27} aria-hidden="true" /><strong>{t.generationDone}</strong><p>{t.generationOutputMissing}</p></div>
              : job && ["queued", "submitting", "running"].includes(job.state) ? <div className="job-status"><span className="job-spinner" aria-hidden="true" /><strong>{job.state === "running" ? t.generationRunning : t.generationQueued}</strong><p>{t.generationHint}</p></div>
              : job?.state === "failed" ? <div className="job-status"><X size={27} aria-hidden="true" /><strong>{t.generationFailed}</strong><p>{job.errorCode || jobError}</p></div>
              : job?.state === "cancelled" ? <div className="job-status"><X size={27} aria-hidden="true" /><strong>{t.generationCancelled}</strong></div> : null}
            {!preview && !job && <div className="canvas-empty"><span className="canvas-empty-icon"><CurrentIcon size={30} aria-hidden="true" /></span><strong>{t.canvasReady}</strong><p>{view === "audio" ? t.audioCanvasHint : needsReference ? t.referenceHint : t.addReference}</p>{needsReference && <button type="button" onClick={() => fileRef.current?.click()}><Upload size={18} aria-hidden="true" />{t.dropFile}</button>}</div>}
          </div>
          {jobError && <div className="studio-error" role="alert">{jobError}</div>}
           {job && <div className="cost-note">{job.costEstimateMicrosUsd !== null && job.costEstimateMicrosUsd !== undefined ? `${t.priceEstimate}: $${(job.costEstimateMicrosUsd / 1_000_000).toFixed(3)} USD` : t.noPriceEstimate}</div>}
           {showRepair && <div className="timeline"><div className="timeline-header"><span><Clock3 size={15} aria-hidden="true" />00:00</span><span>{Math.floor(clipDuration / 60).toString().padStart(2, "0")}:{(clipDuration % 60).toString().padStart(2, "0")}</span></div><div className="timeline-track"><div className="timeline-selection" style={{ insetInlineStart: `${repairStart / clipDuration * 100}%`, width: `${Math.max(2, (repairEnd - repairStart) / clipDuration * 100)}%` }} /></div><span className="timeline-caption">{t.repairHint}</span></div>}
          {view === "audio" && <div className="canvas-footnote"><AudioLines size={17} aria-hidden="true" />{t.audioModeHint}</div>}
           {view === "image" && activeMode === 1 && <div className="canvas-footnote"><Layers3 size={17} aria-hidden="true" />{t.imageModeHint}</div>}
        </div>
        <aside className="inspector" aria-label={t.settings}>
           <div className="inspector-heading"><span><SlidersHorizontal size={19} aria-hidden="true" />{t.input}</span>{needsReference && <button type="button" className="inspector-icon" aria-label={t.attach} onClick={() => fileRef.current?.click()}><Paperclip size={18} /></button>}</div>
           {needsReference && <input ref={fileRef} className="sr-only" type="file" accept={accept} onChange={handleFile} aria-label={t.dropFile} />}
          {preview && <div className="file-chip"><span title={preview.name}>{preview.name}</span><button type="button" aria-label={t.removeFile} onClick={onRemoveFile}><X size={15} /></button></div>}
          <label className="field-label" htmlFor="studio-prompt">{t.prompt}</label>
          <textarea id="studio-prompt" ref={promptRef} className="studio-prompt" dir={directionForText(draft, locale)} value={draft} onChange={event => onDraft(event.target.value)} placeholder={t.promptByView[view]} rows={5} />
          <div className="inspector-divider" />
          <div className="inspector-heading subtle"><span>{t.settings}</span></div>
          <div className="form-field"><label htmlFor="studio-model">{t.model}</label><div className="select-shell"><select id="studio-model" value={effectiveModel} onChange={event => onModel(event.target.value)} disabled={!selectModels.length}>{selectModels.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select><ChevronDown size={16} aria-hidden="true" /></div></div>
           {view !== "audio" && effectiveModel !== "nano-banana-2" && <div className="form-field"><label htmlFor="aspect-ratio">{t.aspectRatio}</label><div className="select-shell"><select id="aspect-ratio" value={view === "video" && !seedance ? aspect === "9:16" ? "9:16" : "16:9" : aspect} onChange={event => setAspect(event.target.value)}>{seedance && <option value="auto">{t.automatic}</option>}{seedance && <option value="21:9">21:9</option>}<option value="16:9">16:9</option>{(view === "image" || seedance) && <option value="1:1">1:1</option>}{(view === "image" || seedance) && <option value="4:3">4:3</option>}{seedance && <option value="3:4">3:4</option>}<option value="9:16">9:16</option></select><ChevronDown size={16} aria-hidden="true" /></div></div>}
           {(view === "video" && !showRepair || view === "image" && effectiveModel !== "nano-banana-2") && <div className="form-field"><label htmlFor="media-quality">{t.quality}</label><div className="select-shell"><select id="media-quality" value={seedance ? quality : quality === "low" ? "standard" : quality} onChange={event => setQuality(event.target.value)}>{seedance && <option value="low">480p</option>}<option value="standard">{seedance ? "720p" : t.standard}</option><option value="high">{seedance ? "1080p" : t.high}</option></select><ChevronDown size={16} aria-hidden="true" /></div></div>}
           {view === "video" && !showRepair && <div className="form-field"><label htmlFor="video-duration">{t.duration}</label><div className="select-shell"><select id="video-duration" value={seedance ? duration : typeof duration === "number" && [4, 6, 8].includes(duration) ? duration : 8} onChange={event => setDuration(event.target.value === "auto" ? "auto" : Number(event.target.value))}>{seedance && <option value="auto">{t.automaticDuration}</option>}{(seedance ? [4, 6, 8, 10, 15, 20, 30] : [4, 6, 8]).map(value => <option key={value} value={value}>{value} {t.seconds}</option>)}</select><ChevronDown size={16} aria-hidden="true" /></div></div>}
           {view === "video" && !showRepair && <label className="toggle-field"><input type="checkbox" checked={generateAudio} onChange={event => setGenerateAudio(event.target.checked)} /><span>{t.videoAudio}</span></label>}
          {view === "audio" && <div className="form-field"><label htmlFor="audio-language">{t.language}</label><div className="select-shell"><select id="audio-language" value={language} onChange={event => setLanguage(event.target.value)}><option value="auto">{t.automatic}</option><option value="en">{t.english}</option><option value="fa">{t.persian}</option></select><ChevronDown size={16} aria-hidden="true" /></div></div>}
          {showRepair && <div className="repair-controls"><div className="repair-title"><Scissors size={17} aria-hidden="true" /><strong>{t.repairRange}</strong></div><p>{preview ? t.repairHint : t.noClip}</p><div className="repair-fields"><div className="form-field"><label htmlFor="repair-start">{t.startTime}</label><div className="input-suffix"><input id="repair-start" type="number" min={0} max={Math.max(0, repairEnd - 1)} step={0.1} value={repairStart} onChange={event => setRepairStart(Math.max(0, Math.min(repairEnd - .1, Number(event.target.value) || 0)))} /><span>s</span></div></div><div className="form-field"><label htmlFor="repair-end">{t.endTime}</label><div className="input-suffix"><input id="repair-end" type="number" min={repairStart + .1} max={clipDuration} step={0.1} value={repairEnd} onChange={event => setRepairEnd(Math.min(clipDuration, Math.max(repairStart + .1, Number(event.target.value) || repairStart + .1)))} /><span>s</span></div></div></div></div>}
          <div className="inspector-spacer" />
            <button className="primary-action" type="button" onClick={handleGenerate} disabled={busy || view === "image" && activeMode === 2 || view === "audio" && activeMode !== 0}>{busy ? t.generationQueued : showRepair ? t.repairRange : t.generate}<ArrowRight size={17} aria-hidden="true" /></button>
            {(view === "image" && activeMode === 2 || view === "audio" && activeMode !== 0) && <p className="inspector-note">{t.unsupportedOperation}</p>}
        </aside>
      </div>
      {signedIn && <section className="media-library" aria-labelledby="media-library-title">
        <div className="media-library-heading"><div><span className="section-eyebrow">{t.mediaLibraryEyebrow}</span><h2 id="media-library-title">{t.mediaLibraryTitle}</h2><p>{t.mediaLibraryDescription}</p></div><button type="button" className="media-library-refresh" onClick={() => setLibraryRefresh(value => value + 1)} disabled={libraryLoading || libraryMoreLoading}><RotateCw size={16} aria-hidden="true" />{t.mediaLibraryRefresh}</button></div>
        {libraryError && <div className="media-library-notice" role="alert"><span>{libraryError}</span><button type="button" onClick={() => setLibraryRefresh(value => value + 1)}>{t.retry}</button></div>}
        {libraryLoading && !library.length ? <p className="media-library-empty" role="status">{t.mediaLibraryLoading}</p>
          : !library.length && !libraryError ? <p className="media-library-empty">{t.mediaLibraryEmpty}</p>
          : <div className="media-library-grid">{library.map(asset => {
            const label = asset.kind === "image" ? t.imageOutput : asset.kind === "video" ? t.videoOutput : t.audioOutput;
            const created = Date.parse(asset.createdAt);
            const dateLabel = Number.isFinite(created) ? new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(created) : "";
            return <div className="media-library-card" key={asset.id}>
              <button type="button" className="media-library-open" aria-pressed={selectedAssetId === asset.id} aria-label={`${t.openResult}: ${label}${dateLabel ? `, ${dateLabel}` : ""}`} onClick={() => openLibraryAsset(asset.id)}>
                <span className="media-library-thumb">{asset.kind === "image" ? <img src={asset.url} alt="" loading="lazy" /> : asset.kind === "video" ? <Video size={30} aria-hidden="true" /> : <AudioLines size={30} aria-hidden="true" />}</span>
                <span className="media-library-details"><strong>{label}</strong><small>{dateLabel}</small><span className="media-library-visibility"><ShieldCheck size={13} aria-hidden="true" />{asset.visibility === "public" ? t.assetPublic : t.assetPrivate}</span></span>
              </button>
              <a className="media-library-download" href={asset.url} download={mediaDownloadName({ id: asset.id, kind: asset.kind, contentType: asset.mimeType })} aria-label={`${t.downloadResult}: ${label}`} title={t.downloadResult}><Download size={18} aria-hidden="true" /></a>
            </div>;
          })}</div>}
        {libraryMoreError && <div className="media-library-notice" role="alert"><span>{libraryMoreError}</span><button type="button" onClick={() => void loadMoreLibrary()}>{t.retry}</button></div>}
        {libraryCursor && <div className="media-library-more"><button type="button" className="outline-action" onClick={() => void loadMoreLibrary()} disabled={libraryLoading || libraryMoreLoading}>{libraryMoreLoading ? t.mediaLibraryLoadingMore : t.mediaLibraryLoadMore}</button></div>}
      </section>}
    </section>
  );
}

function LoginDialog({ locale, draft, inviteToken, busy, error, onClose, onAuthenticate, closeRef }: {
  locale: Locale; draft: string; inviteToken: string | null; busy: boolean; error: string;
  onClose: () => void; onAuthenticate: (input: { mode: "sign-in" | "sign-up"; email: string; password: string; name: string }) => void;
  closeRef: RefObject<HTMLButtonElement | null>;
}) {
  const t = copy[locale];
  const dialogRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"sign-in" | "sign-up">(inviteToken ? "sign-up" : "sign-in");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  useEffect(() => {
    if (!inviteToken) return;
    fetch(`/api/auth/invite?token=${encodeURIComponent(inviteToken)}`, { credentials: "same-origin" })
      .then(response => response.ok ? response.json() : null)
      .then(body => { if (typeof body?.email === "string") setEmail(body.email); })
      .catch(() => { /* The sign-up request will validate the invitation. */ });
  }, [inviteToken]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    if (event.key === "Tab") {
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])") ?? []);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="login-title" aria-describedby="login-description" ref={dialogRef} onKeyDown={onKeyDown}>
        <button type="button" ref={closeRef} className="icon-button modal-close" aria-label={t.close} onClick={onClose}><X size={20} /></button>
        <span className="modal-mark"><BrandMark /></span>
        <h2 id="login-title">{mode === "sign-up" ? t.createAccount : t.loginTitle}</h2>
        <p id="login-description">{t.loginDescription}</p>
        {draft.trim() && <div className="draft-preview"><strong>{t.savedDraft}</strong><span dir={directionForText(draft, locale)}>{draft}</span></div>}
        <form className="auth-form" onSubmit={event => { event.preventDefault(); onAuthenticate({ mode, email: email.trim(), password, name: name.trim() }); }}>
          {mode === "sign-up" && <label>{t.name}<input type="text" name="name" autoComplete="name" minLength={1} required value={name} onChange={event => setName(event.target.value)} /></label>}
          <label>{t.email}<input type="email" name="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label>{t.password}<input type="password" name="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={mode === "sign-up" ? 12 : undefined} required value={password} onChange={event => setPassword(event.target.value)} /></label>
          {mode === "sign-up" && <p className="auth-hint">{inviteToken ? t.invitationReady : t.invitationOnly}</p>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="modal-primary" disabled={busy || (mode === "sign-up" && !inviteToken)}>{busy ? t.authWorking : mode === "sign-up" ? t.createAccount : t.continueSignIn}</button>
        </form>
        {inviteToken && <button type="button" className="modal-secondary" onClick={() => setMode(current => current === "sign-in" ? "sign-up" : "sign-in")}>{mode === "sign-in" ? t.useInvitation : t.existingAccount}</button>}
        <button type="button" className="modal-secondary" onClick={onClose}>{t.keepEditing}</button>
      </div>
    </div>
  );
}

export default function WorkspaceApp() {
  const [locale, setLocale] = useState<Locale>("en");
  const [theme, setTheme] = useState<Theme>("light");
  const [view, setView] = useState<View>("chat");
  const [drafts, setDrafts] = useState<Drafts>(emptyDrafts);
  const [models, setModels] = useState<Models>(defaultModels);
  const [studioMode, setStudioMode] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [loginReturnView, setLoginReturnView] = useState<View>("chat");
  const [loginDraft, setLoginDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<LocalFile | null>(null);
  const [attachment, setAttachment] = useState<LocalFile | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [chatModels, setChatModels] = useState<ChatModel[]>([{ id: "openrouter/auto", name: "Smart choice" }]);
  const [chatMode, setChatMode] = useState<"text" | "image">("text");
  const [webSearch, setWebSearch] = useState(false);
  const [imageChatModel, setImageChatModel] = useState("google/gemini-3.1-flash-image");
  const [imageChatModels, setImageChatModels] = useState<ChatModel[]>([{ id: "google/gemini-3.1-flash-image", name: "Gemini 3.1 Flash Image" }]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [chatPending, setChatPending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [specialistId, setSpecialistId] = useState<"general" | "skin" | "mental" | "general-health" | "skin-and-hair" | "mental-wellbeing" | null>(null);
  const [mediaModels, setMediaModels] = useState<MediaModel[]>([]);
  const [mediaJobs, setMediaJobs] = useState<Partial<Record<MediaView, MediaJob>>>({});
  const [mediaErrors, setMediaErrors] = useState<Partial<Record<MediaView, string>>>({});
  const [mediaSubmitting, setMediaSubmitting] = useState<Partial<Record<MediaView, boolean>>>({});
  const mediaSubmittingRef = useRef<Partial<Record<MediaView, boolean>>>({});
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    const savedLocale = readStorage("ailoom.locale");
    const savedTheme = readStorage("ailoom.theme");
    const savedImageChatModel = readStorage("ailoom.imageChatModel");
    if (savedLocale === "en" || savedLocale === "fa") setLocale(savedLocale);
    if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
    if (savedImageChatModel) setImageChatModel(savedImageChatModel);
    try {
      const savedDrafts = JSON.parse(readStorage("ailoom.drafts") ?? "{}") as Partial<Drafts>;
      setDrafts({ ...emptyDrafts, ...Object.fromEntries(views.map(item => [item, typeof savedDrafts[item] === "string" ? savedDrafts[item] : ""])) });
    } catch { /* Ignore invalid local data. */ }
    try {
      const savedModels = JSON.parse(readStorage("ailoom.models") ?? "{}") as Partial<Models>;
      setModels({ ...defaultModels, ...Object.fromEntries(views.map(item => [item, item === "chat" && typeof savedModels[item] === "string" ? savedModels[item] : modelOptions[item].some(option => option.id === savedModels[item]) ? savedModels[item] : defaultModels[item]])) });
    } catch { /* Ignore invalid local data. */ }
    const url = new URL(window.location.href);
    const directToken = url.pathname.match(/^\/invite\/([^/]+)\/?$/)?.[1];
    setInviteToken(url.searchParams.get("invite") ?? url.searchParams.get("token") ?? directToken ?? null);
    setView(viewFromHash());
    setHydrated(true);
    const onHashChange = () => { setStudioMode(0); setView(viewFromHash()); };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "fa" ? "rtl" : "ltr";
    document.documentElement.dataset.theme = theme;
    if (!hydrated) return;
    writeStorage("ailoom.locale", locale);
    writeStorage("ailoom.theme", theme);
  }, [locale, theme, hydrated]);
  useEffect(() => { if (hydrated) writeStorage("ailoom.drafts", JSON.stringify(drafts)); }, [drafts, hydrated]);
  useEffect(() => { if (hydrated) writeStorage("ailoom.models", JSON.stringify(models)); }, [models, hydrated]);
  useEffect(() => { if (hydrated) writeStorage("ailoom.imageChatModel", imageChatModel); }, [imageChatModel, hydrated]);
  useEffect(() => {
    let active = true;
    fetch("/api/auth/get-session", { credentials: "same-origin", cache: "no-store" })
      .then(async response => response.ok ? response.json() : null)
      .then(body => { if (active) setUser(sessionUserFromPayload(body)); })
      .catch(() => { if (active) setUser(null); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/models?kind=chat", { credentials: "same-origin", cache: "no-store" })
      .then(async response => response.ok ? response.json() : null)
      .then(body => {
        if (!active || !body) return;
        const catalog = modelsFromPayload(body);
        if (catalog.models.length) {
          const unique = new Map<string, ChatModel>();
          unique.set(catalog.defaultModelId, { id: catalog.defaultModelId, name: "Smart choice" });
          for (const item of catalog.models) unique.set(item.id, item);
          setChatModels([...unique.values()]);
          setModels(previous => ({ ...previous, chat: unique.has(previous.chat) ? previous.chat : catalog.defaultModelId }));
        }
      })
      .catch(() => { /* Smart choice remains available. */ });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/models?kind=image", { credentials: "same-origin", cache: "no-store" })
      .then(async response => response.ok ? response.json() : null)
      .then(body => {
        if (!active || !body) return;
        const catalog = modelsFromPayload(body);
        if (!catalog.models.length) return;
        setImageChatModels(catalog.models);
        setImageChatModel(previous => catalog.models.some(item => item.id === previous)
          ? previous : catalog.models.find(item => item.id === catalog.defaultModelId)?.id ?? catalog.models[0].id);
      })
      .catch(() => { /* The verified default remains available. */ });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/media/models", { credentials: "same-origin", cache: "no-store" })
      .then(async response => response.ok ? response.json() : null)
      .then(body => {
        if (!active || !body) return;
        const catalog = mediaModelsFromPayload(body);
        setMediaModels(catalog);
        setModels(previous => {
          const next = { ...previous };
          const imageChoices = catalog.filter(item => item.operations.includes("text_to_image"));
          const videoChoices = catalog.filter(item => item.operations.includes("text_to_video"));
          const audioChoices = catalog.filter(item => item.operations.includes("text_to_speech"));
          if (imageChoices.length && !imageChoices.some(item => item.id === next.image)) next.image = imageChoices[0].id;
          if (videoChoices.length && !videoChoices.some(item => item.id === next.video)) next.video = videoChoices[0].id;
          if (audioChoices.length && !audioChoices.some(item => item.id === next.audio)) next.audio = audioChoices[0].id;
          return next;
        });
      })
      .catch(() => { /* Bundled verified choices remain visible. */ });
    return () => { active = false; };
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => () => { if (attachment) URL.revokeObjectURL(attachment.url); }, [attachment]);
  useEffect(() => { if (authOpen) { previousFocusRef.current = document.activeElement as HTMLElement; closeRef.current?.focus(); document.body.style.overflow = "hidden"; } else { document.body.style.overflow = ""; } return () => { document.body.style.overflow = ""; }; }, [authOpen]);
  useEffect(() => { if (!notice) return; const timeout = window.setTimeout(() => setNotice(""), 3900); return () => window.clearTimeout(timeout); }, [notice]);

  const navigate = useCallback((nextView: View) => {
    if (nextView !== view) setPreview(null);
    setStudioMode(0);
    setView(nextView);
    window.history.pushState(null, "", `#/${nextView}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [view]);
  const updateDraft = (target: View, value: string) => setDrafts(previous => ({ ...previous, [target]: value }));
  const updateModel = (target: View, value: string) => {
    setModels(previous => ({ ...previous, [target]: value }));
    if (target === "chat" && user) {
      void fetch("/api/chat/model", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelId: value }) })
        .then(async response => { if (!response.ok) throw new Error(await responseError(response)); })
        .catch(error => setNotice(error instanceof Error ? error.message : copy[locale].modelUnavailable));
    }
  };
  const openLogin = (draft = drafts[view], returnView = view) => { setAuthError(""); setLoginDraft(draft); setLoginReturnView(returnView); setAuthOpen(true); };
  const closeLogin = () => { setAuthOpen(false); window.requestAnimationFrame(() => previousFocusRef.current?.focus()); };
  const onUpload = (event: ChangeEvent<HTMLInputElement>, target: "chat" | MediaView) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const entry = { name: file.name, mime: file.type, url: URL.createObjectURL(file), file };
    if (target === "chat") { setAttachment(entry); setWebSearch(false); } else setPreview(entry);
  };
  const useWorkflow = (nextView: View, prompt: string, options?: { file?: File; modelId?: string }) => {
    updateDraft(nextView, prompt);
    navigate(nextView);
    const file = options?.file;
    if (nextView === "chat") {
      setChatMode("text");
      if (options?.modelId) updateModel("chat", options.modelId);
      if (file) setAttachment({ name: file.name, mime: file.type, file, url: URL.createObjectURL(file) });
    } else if (isMediaView(nextView)) {
      let chosenModel = options?.modelId;
      let mode = 0;
      if (file && nextView === "image") { mode = 1; chosenModel = "fal-ai/qwen-image-edit"; }
      if (file && nextView === "video" && file.type.startsWith("image/")) {
        mode = 1;
        chosenModel = options?.modelId?.startsWith("bytedance/seedance-2.5/")
          ? "bytedance/seedance-2.5/reference-to-video" : "fal-ai/veo3.1/fast/image-to-video";
      }
      if (file && nextView === "video" && file.type.startsWith("video/")) { mode = 2; chosenModel = "fal-ai/ltx-2.3-quality/inpaint"; }
      setStudioMode(mode);
      if (file) setPreview({ name: file.name, mime: file.type, file, url: URL.createObjectURL(file) });
      if (chosenModel && modelOptions[nextView].some(item => item.id === chosenModel)) updateModel(nextView, chosenModel);
    }
  };
  const askSpecialist = (id: string, prompt: string) => {
    if (id === "general" || id === "skin" || id === "mental" || id === "general-health" || id === "skin-and-hair" || id === "mental-wellbeing") setSpecialistId(id);
    setSelectedConversationId(null);
    setMessages([]);
    updateDraft("chat", prompt);
    navigate("chat");
    if (!user) openLogin(prompt, "chat");
  };
  const t = copy[locale];

  const refreshConversations = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch("/api/chat/conversations", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      setConversations(conversationsFromPayload(await response.json()));
    } catch {
      setConversations([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void refreshConversations();
    else { setConversations([]); setSelectedConversationId(null); setMessages([]); }
  }, [user, refreshConversations]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    fetch("/api/chat/model", { credentials: "same-origin", cache: "no-store" })
      .then(async response => response.ok ? response.json() : null)
      .then(body => { if (active && typeof body?.modelId === "string") setModels(previous => ({ ...previous, chat: body.modelId })); })
      .catch(() => { /* The locally saved choice remains available. */ });
    return () => { active = false; };
  }, [user]);
  useEffect(() => {
    if (!user) { setMediaJobs({}); return; }
    let active = true;
    fetch("/api/generations", { credentials: "same-origin", cache: "no-store" })
      .then(async response => response.ok ? response.json() : null)
      .then(body => {
        if (!active || !Array.isArray(body?.jobs)) return;
        const latest: Partial<Record<MediaView, MediaJob>> = {};
        for (const item of body.jobs) {
          const kind: unknown = item?.kind === "edit"
            ? item?.providerModel === "fal-ai/qwen-image-edit" ? "image" : item?.providerModel === "fal-ai/ltx-2.3-quality/inpaint" ? "video" : null
            : item?.kind;
          if ((kind !== "image" && kind !== "video" && kind !== "audio") || latest[kind]) continue;
          const job = mediaJobFromPayload({ job: item });
          if (job) latest[kind] = job;
        }
        setMediaJobs(latest);
      })
      .catch(() => { /* A new job can still be submitted. */ });
    return () => { active = false; };
  }, [user]);
  useEffect(() => {
    if (!user) return;
    const activeJobs = (Object.entries(mediaJobs) as [MediaView, MediaJob][])
      .filter(([, job]) => ["queued", "submitting", "running"].includes(job.state));
    if (!activeJobs.length) return;
    const timer = window.setInterval(() => {
      for (const [kind, current] of activeJobs) {
        void fetch(`/api/generations/${encodeURIComponent(current.id)}`, { credentials: "same-origin", cache: "no-store" })
          .then(async response => response.ok ? response.json() : null)
          .then(body => {
            const updated = mediaJobFromPayload(body);
            if (updated) setMediaJobs(previous => previous[kind]?.id === current.id ? { ...previous, [kind]: updated } : previous);
          })
          .catch(() => { /* The next poll can recover a transient failure. */ });
      }
    }, 3500);
    return () => window.clearInterval(timer);
  }, [user, mediaJobs]);

  const selectConversation = async (id: string) => {
    if (pendingRef.current) return;
    setSpecialistId(null);
    setSelectedConversationId(id);
    setMessagesLoading(true);
    setChatError("");
    try {
      const response = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      setMessages(messagesFromPayload(await response.json()));
    } catch (error) {
      setChatError(error instanceof Error ? error.message : t.sendError);
    } finally {
      setMessagesLoading(false);
    }
  };

  const newConversation = () => {
    if (pendingRef.current) return;
    setChatMode("text");
    setSpecialistId(null);
    setSelectedConversationId(null);
    setMessages([]);
    setChatError("");
    promptRef.current?.focus();
  };

  const sendChatImage = async () => {
    if (pendingRef.current) return;
    const prompt = drafts.chat.trim();
    if (!prompt) { promptRef.current?.focus(); return; }
    if (!user) { openLogin(prompt, "chat"); return; }
    if (attachment && (!attachment.file || !["image/png", "image/jpeg", "image/webp"].includes(attachment.mime) || attachment.file.size > 10_000_000)) {
      setChatError(t.chatImageOnly);
      return;
    }
    const modelId = imageChatModels.some(item => item.id === imageChatModel)
      ? imageChatModel : imageChatModels[0]?.id || "google/gemini-3.1-flash-image";
    const userId = `local-user-${crypto.randomUUID()}`;
    const assistantId = `local-assistant-${crypto.randomUUID()}`;
    const initialConversationId = selectedConversationId;
    pendingRef.current = true;
    setChatPending(true);
    setChatError("");
    setMessages(previous => [...previous,
      { id: userId, role: "user", text: prompt, blocks: attachment ? [{ type: "image", url: attachment.url, alt: attachment.name }] : [] },
      { id: assistantId, role: "assistant", text: t.generationRunning, status: "streaming" }
    ]);
    try {
      let assetId = attachment?.assetId;
      if (attachment && !assetId) {
        const data = new FormData();
        data.append("file", attachment.file as File);
        const upload = await fetch("/api/assets", { method: "POST", credentials: "same-origin", body: data });
        if (!upload.ok) throw new Error(await responseError(upload));
        const body = await upload.json();
        assetId = typeof body?.asset?.id === "string" ? body.asset.id : undefined;
        if (!assetId) throw new Error(t.attachmentUnavailable);
        const savedId = assetId;
        setAttachment(current => current?.url === attachment.url ? { ...current, assetId: savedId } : current);
      }
      const response = await fetch("/api/chat/images", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(initialConversationId ? { conversationId: initialConversationId } : {}),
          prompt, model: modelId, ...(assetId ? { referenceAssetIds: [assetId] } : {}) })
      });
      if (!response.ok) throw new Error(await responseError(response));
      const body = await response.json();
      const conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;
      if (!conversationId) throw new Error(t.generationOutputMissing);
      const persisted = messagesFromPayload({ messages: [body.message] })[0];
      const assets = Array.isArray(body.assets) ? body.assets : [];
      const assistant: ChatMessage = persisted ?? {
        id: assistantId, role: "assistant", text: "",
        blocks: assets.filter((item: unknown): item is { id: string; url: string } => {
          if (!item || typeof item !== "object") return false;
          const value = item as Record<string, unknown>;
          return typeof value.id === "string" && typeof value.url === "string";
        }).map((item: { id: string; url: string }) => ({ type: "image" as const, assetId: item.id, url: item.url }))
      };
      setSelectedConversationId(conversationId);
      setMessages(previous => previous.map(item => item.id === userId
        ? { ...item, blocks: assetId ? [{ type: "image" as const, assetId, alt: attachment?.name }] : [] }
        : item.id === assistantId ? assistant : item));
      updateDraft("chat", "");
      setAttachment(null);
      void refreshConversations();
    } catch (error) {
      setMessages(previous => previous.filter(item => item.id !== userId && item.id !== assistantId));
      setChatError(error instanceof Error ? error.message : t.generationFailed);
    } finally {
      pendingRef.current = false;
      setChatPending(false);
    }
  };

  const sendChat = async () => {
    if (chatMode === "image") { await sendChatImage(); return; }
    if (pendingRef.current) return;
    const message = drafts.chat.trim();
    if (!message && !attachment) { promptRef.current?.focus(); return; }
    if (!user) { openLogin(message || attachment?.name || ""); return; }
    if (attachment && (!["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(attachment.mime) || !attachment.file || attachment.file.size > 10_000_000)) {
      setChatError(t.chatAttachmentUnsupported);
      return;
    }
    if (webSearch && attachment) { setChatError(t.webSearchNoImage); return; }
    if (!message && !attachment) { promptRef.current?.focus(); return; }
    const userId = `local-user-${crypto.randomUUID()}`;
    const assistantId = `local-assistant-${crypto.randomUUID()}`;
    const initialConversationId = selectedConversationId;
    pendingRef.current = true;
    setChatPending(true);
    setChatError("");
    setMessages(previous => [...previous, { id: userId, role: "user", text: message, blocks: attachment ? [{ type: attachment.mime === "application/pdf" ? "file" : "image", url: attachment.url, alt: attachment.name }] : [] }, { id: assistantId, role: "assistant", text: "", status: "streaming" }]);
    try {
      let assetId = attachment?.assetId;
      if (attachment && !assetId) {
        const body = new FormData();
        body.append("file", attachment.file as File);
        const uploadResponse = await fetch("/api/assets", { method: "POST", credentials: "same-origin", body });
        if (!uploadResponse.ok) throw new Error(await responseError(uploadResponse));
        const uploaded = await uploadResponse.json();
        assetId = typeof uploaded?.asset?.id === "string" ? uploaded.asset.id : undefined;
        if (!assetId) throw new Error(t.attachmentUnavailable);
        const completedAssetId = assetId;
        setAttachment(current => current?.url === attachment.url ? { ...current, assetId: completedAssetId } : current);
      }
      const response = await fetch("/api/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(initialConversationId ? { conversationId: initialConversationId } : {}),
          text: message,
          model: chatModels.some(item => item.id === models.chat) ? models.chat : "openrouter/auto",
          webSearch,
          ...(assetId ? { attachmentIds: [assetId] } : {}),
          ...(!initialConversationId && specialistId ? { specialistId } : {})
        })
      });
      await readChatStream(response, event => {
        if (event.type === "start" && event.conversationId) setSelectedConversationId(event.conversationId);
        if (event.type === "delta") setMessages(previous => previous.map(item => item.id === assistantId ? { ...item, text: item.text + event.text } : item));
        if (event.type === "sources") setMessages(previous => previous.map(item => item.id === assistantId ? { ...item, blocks: [...(item.blocks?.filter(block => block.type !== "sources") ?? []), { type: "sources", sources: event.sources }] } : item));
        if (event.type === "done") setMessages(previous => previous.map(item => item.id === assistantId ? { ...item, id: event.messageId || assistantId, status: undefined } : item));
      });
      updateDraft("chat", "");
      if (assetId) setMessages(previous => previous.map(item => item.id === userId ? { ...item, blocks: [{ type: attachment?.mime === "application/pdf" ? "file" : "image", assetId, alt: attachment?.name }] } : item));
      setAttachment(null);
      setSpecialistId(null);
      void refreshConversations();
    } catch (error) {
      setMessages(previous => previous.filter(item => item.id !== userId && item.id !== assistantId));
      setChatError(error instanceof Error ? error.message : t.sendError);
    } finally {
      pendingRef.current = false;
      setChatPending(false);
    }
  };

  const changeChatMode = (mode: "text" | "image") => {
    setChatMode(mode);
    if (mode === "image" && attachment?.mime === "application/pdf") setAttachment(null);
  };

  const authenticate = async (input: { mode: "sign-in" | "sign-up"; email: string; password: string; name: string }) => {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      const endpoint = input.mode === "sign-up" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email";
      const body = input.mode === "sign-up"
        ? { email: input.email, password: input.password, name: input.name, inviteToken }
        : { email: input.email, password: input.password };
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await responseError(response));
      let sessionResponse = await fetch("/api/auth/get-session", { credentials: "same-origin", cache: "no-store" });
      let nextUser = sessionResponse.ok ? sessionUserFromPayload(await sessionResponse.json()) : null;
      if (!nextUser && input.mode === "sign-up") {
        const signInResponse = await fetch("/api/auth/sign-in/email", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: input.email, password: input.password }) });
        if (!signInResponse.ok) throw new Error(await responseError(signInResponse));
        sessionResponse = await fetch("/api/auth/get-session", { credentials: "same-origin", cache: "no-store" });
        nextUser = sessionResponse.ok ? sessionUserFromPayload(await sessionResponse.json()) : null;
      }
      if (!nextUser) throw new Error(t.sessionError);
      setUser(nextUser);
      closeLogin();
      if (loginReturnView !== view) navigate(loginReturnView);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : t.authError);
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error(await responseError(response));
      try { if (user) window.localStorage.removeItem(`ailoom.explore.run.v1.${user.id}`); }
      catch { /* Private browsing can disable storage. */ }
      setUser(null);
      setSelectedConversationId(null);
      setMessages([]);
      navigate("chat");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.sessionError);
    }
  };

  const startGeneration = async (target: MediaView, options: StudioRequestOptions) => {
    const imageEdit = target === "image" && options.modeIndex === 1;
    const referenceVideo = target === "video" && options.modeIndex === 1;
    const videoRepair = target === "video" && options.modeIndex === 2;
    const textGeneration = options.modeIndex === 0;
    if ((!imageEdit && !referenceVideo && !videoRepair && !textGeneration) || (textGeneration && preview) || ((imageEdit || referenceVideo || videoRepair) && !preview)) {
      setMediaErrors(previous => ({ ...previous, [target]: t.unsupportedOperation }));
      return;
    }
    if (!user) { openLogin(drafts[target], target); return; }
    const prompt = drafts[target].trim();
    if (!prompt) return;
    const operation = imageEdit ? "image_edit" : referenceVideo ? options.modelId === "fal-ai/veo3.1/fast/image-to-video" ? "image_to_video" : "reference_to_video" : videoRepair ? "temporal_inpaint" : target === "image" ? "text_to_image" : target === "video" ? "text_to_video" : "text_to_speech";
    const supported = mediaModels.length ? mediaModels.some(item => item.id === options.modelId && item.operations.includes(operation))
      : modelOptions[target].some(item => item.id === options.modelId);
    if (!supported && !videoRepair) {
      setMediaErrors(previous => ({ ...previous, [target]: t.generationNotReady }));
      return;
    }
    let payload: Record<string, unknown>;
    if (imageEdit || referenceVideo || videoRepair) {
      payload = {};
    } else if (target === "image") {
      payload = { modelId: options.modelId, operation: "text_to_image", prompt };
      if (options.modelId === "fal-ai/flux-2-pro") {
        const imageSizes: Record<string, string> = {
          "16:9": "landscape_16_9", "9:16": "portrait_16_9",
          "4:3": "landscape_4_3", "1:1": options.quality === "high" ? "square_hd" : "square"
        };
        payload.imageSize = imageSizes[options.aspect] ?? "landscape_16_9";
      } else if (options.modelId === "wavespeed-ai/z-image/turbo") {
        const high = options.quality === "high";
        const dimensions: Record<string, [number, number]> = high
          ? { "16:9": [1536, 864], "9:16": [864, 1536], "4:3": [1536, 1152], "1:1": [1536, 1536] }
          : { "16:9": [1024, 576], "9:16": [576, 1024], "4:3": [1024, 768], "1:1": [1024, 1024] };
        const [width, height] = dimensions[options.aspect] ?? dimensions["16:9"];
        payload.width = width;
        payload.height = height;
      }
    } else if (target === "video") {
      if (options.modelId === "bytedance/seedance-2.5/text-to-video") {
        payload = { modelId: options.modelId, operation: "text_to_video", prompt,
          durationSec: options.duration === "auto" ? "auto" : Math.max(4, Math.min(30, options.duration)),
          aspectRatio: ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(options.aspect) ? options.aspect : "16:9",
          resolution: options.quality === "low" ? "480p" : options.quality === "high" ? "1080p" : "720p",
          audio: options.audio };
      } else {
        payload = { modelId: options.modelId, operation: "text_to_video", prompt,
          durationSec: typeof options.duration === "number" && [4, 6, 8].includes(options.duration) ? options.duration : 8,
          aspectRatio: options.aspect === "9:16" ? "9:16" : "16:9",
          resolution: options.quality === "high" ? "1080p" : "720p", audio: options.audio };
      }
    } else {
      payload = { modelId: options.modelId, operation: "text_to_speech", text: prompt };
      if (options.language === "en" || options.language === "fa") payload.languageCode = options.language;
    }
    if (mediaSubmittingRef.current[target]) return;
    mediaSubmittingRef.current[target] = true;
    setMediaSubmitting(previous => ({ ...previous, [target]: true }));
    setMediaErrors(previous => ({ ...previous, [target]: "" }));
    try {
      let endpoint = "/api/generations";
      if (imageEdit || referenceVideo || videoRepair) {
        const source = preview?.file;
        if (!source) throw new Error(t.unsupportedOperation);
        if ((imageEdit || referenceVideo) && !["image/png", "image/jpeg", "image/webp"].includes(source.type)) throw new Error(t.unsupportedOperation);
        if (videoRepair && !["video/mp4", "video/webm"].includes(source.type)) throw new Error(t.unsupportedOperation);
        let sourceAssetId = preview?.assetId;
        if (!sourceAssetId) {
          const data = new FormData();
          data.append("file", source);
          const upload = await fetch("/api/assets", { method: "POST", credentials: "same-origin", body: data });
          if (!upload.ok) throw new Error(await responseError(upload));
          const body = await upload.json();
          sourceAssetId = typeof body?.asset?.id === "string" ? body.asset.id : undefined;
          if (!sourceAssetId) throw new Error(t.attachmentUnavailable);
          const savedId = sourceAssetId;
          setPreview(current => current?.url === preview?.url ? { ...current, assetId: savedId } : current);
        }
        if (imageEdit || referenceVideo) {
          const access = await fetch(`/api/assets/${encodeURIComponent(sourceAssetId)}`, { method: "POST", credentials: "same-origin" });
          if (!access.ok) throw new Error(await responseError(access));
          const signed = await access.json();
          if (typeof signed?.url !== "string" || !signed.url.startsWith("https://")) throw new Error(t.unsupportedOperation);
          if (imageEdit) {
            const sizes: Record<string, string> = { "16:9": "landscape_16_9", "9:16": "portrait_16_9", "4:3": "landscape_4_3", "1:1": options.quality === "high" ? "square_hd" : "square" };
            payload = { modelId: "fal-ai/qwen-image-edit", operation: "image_edit", prompt,
              imageUrl: signed.url, imageSize: sizes[options.aspect] ?? "landscape_16_9" };
          } else if (options.modelId === "fal-ai/veo3.1/fast/image-to-video") {
            payload = { modelId: options.modelId, operation: "image_to_video", prompt, imageUrl: signed.url,
              durationSec: typeof options.duration === "number" && [4, 6, 8].includes(options.duration) ? options.duration : 8,
              aspectRatio: options.aspect === "9:16" ? "9:16" : "16:9",
              resolution: options.quality === "high" ? "1080p" : "720p", audio: options.audio };
          } else {
            payload = { modelId: "bytedance/seedance-2.5/reference-to-video", operation: "reference_to_video", prompt,
              imageUrls: [signed.url], durationSec: options.duration === "auto" ? "auto" : Math.max(4, Math.min(30, options.duration)),
              aspectRatio: ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(options.aspect) ? options.aspect : "16:9",
              resolution: options.quality === "low" ? "480p" : options.quality === "high" ? "1080p" : "720p",
              audio: options.audio };
          }
        } else {
          endpoint = "/api/video/repair";
          payload = { sourceAssetId, startSec: options.repairStart, endSec: options.repairEnd, prompt };
        }
      }
      const response = await fetch(endpoint, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await responseError(response));
      const job = mediaJobFromPayload(await response.json());
      if (!job) throw new Error(t.generationNotReady);
      setMediaJobs(previous => ({ ...previous, [target]: job }));
      if (imageEdit || referenceVideo || videoRepair) setPreview(null);
    } catch (error) {
      setMediaErrors(previous => ({ ...previous, [target]: error instanceof Error ? error.message : t.generationFailed }));
    } finally {
      mediaSubmittingRef.current[target] = false;
      setMediaSubmitting(previous => ({ ...previous, [target]: false }));
    }
  };

  return (
    <>
      <Header locale={locale} theme={theme} view={view} user={user} onLocale={setLocale} onTheme={() => setTheme(current => current === "light" ? "dark" : "light")} onNavigate={navigate} onLogin={() => openLogin()} onSignOut={() => void signOut()} />
      <main id="main-content">
        {view === "chat" && (user
          ? <ChatWorkspace locale={locale} user={user} conversations={conversations} historyLoading={historyLoading} selectedId={selectedConversationId} messages={messages} messageLoading={messagesLoading} pending={chatPending} error={chatError} prompt={drafts.chat} onPrompt={value => updateDraft("chat", value)} model={chatMode === "image" ? imageChatModel : models.chat} onModel={value => chatMode === "image" ? setImageChatModel(value) : updateModel("chat", value)} modelList={chatMode === "image" ? imageChatModels : chatModels} mode={chatMode} onMode={changeChatMode} webSearch={webSearch} onWebSearch={setWebSearch} onSend={() => void sendChat()} onSelect={id => void selectConversation(id)} onNew={newConversation} attachment={attachment} onAttach={event => onUpload(event, "chat")} onRemoveAttachment={() => setAttachment(null)} inputRef={promptRef} />
          : <ChatLanding locale={locale} prompt={drafts.chat} setPrompt={value => updateDraft("chat", value)} model={chatMode === "image" ? imageChatModel : models.chat} setModel={value => chatMode === "image" ? setImageChatModel(value) : updateModel("chat", value)} modelList={chatMode === "image" ? imageChatModels : chatModels} mode={chatMode} onMode={changeChatMode} webSearch={webSearch} onWebSearch={setWebSearch} onSubmit={() => void sendChat()} onNavigate={navigate} onStarter={useWorkflow} attachment={attachment} onAttach={event => onUpload(event, "chat")} onRemoveAttachment={() => setAttachment(null)} inputRef={promptRef} />)}
        {isMediaView(view) && <StudioPage key={`${view}-${studioMode}`} initialMode={studioMode} view={view} locale={locale} model={models[view]} onModel={value => updateModel(view, value)} draft={drafts[view]} onDraft={value => updateDraft(view, value)} onSubmit={options => void startGeneration(view, options)} preview={preview} onFile={event => onUpload(event, view)} onRemoveFile={() => setPreview(null)} availableModels={mediaModels.filter(item => item.outputKind === view && (view !== "video" || ["fal-ai/veo3.1/fast", "fal-ai/veo3.1/fast/image-to-video", "bytedance/seedance-2.5/text-to-video", "bytedance/seedance-2.5/reference-to-video", "fal-ai/ltx-2.3-quality/inpaint"].includes(item.id)))} job={mediaJobs[view] ?? null} jobError={mediaErrors[view] ?? ""} busy={Boolean(mediaSubmitting[view])} signedIn={Boolean(user)} />}
        {view === "explore" && <ConnectedExplorePage locale={locale} user={user} onUse={useWorkflow} onLogin={() => openLogin()} />}
        {view === "specialists" && <ConnectedSpecialistsPage locale={locale} onAsk={askSpecialist} />}
      </main>
      <footer className="site-footer"><strong>Ailoom</strong><span>{t.privateWorkspace}</span></footer>
      {authOpen && <LoginDialog locale={locale} draft={loginDraft} inviteToken={inviteToken} busy={authBusy} error={authError} onClose={closeLogin} onAuthenticate={input => void authenticate(input)} closeRef={closeRef} />}
      {notice && <div className="toast" role="status" aria-live="polite">{notice}</div>}
    </>
  );
}
