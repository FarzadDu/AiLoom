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
  Copy,
  Download,
  FileText,
  FolderClosed,
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
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { conversationsFromPayload, messagesFromPayload, modelsFromPayload, projectsFromPayload, readChatStream, responseError, sessionUserFromPayload, type ChatMessage, type ChatModel, type ChatProject, type ConversationSummary, type SessionUser } from "./chat-api";
import { prepareChatModelCatalog } from "./chat-model-catalog";
import { ChatProjects, projectLabel } from "./chat-projects";
import { ExplorePage as ConnectedExplorePage, SpecialistsPage as ConnectedSpecialistsPage } from "./content-pages";
import { libraryPageFromPayload, mediaAssetsFromJob, mediaDownloadName, mediaJobFromPayload, mediaModelsFromPayload, mediaViewForJob, type LibraryAsset, type MediaAsset, type MediaJob, type MediaModel } from "./media-api";
import { copy, mediaViews, modelOptions, views, type Locale, type MediaView, type Theme, type View } from "./workspace-data";
import { clearStoredDrafts, emptyDrafts, readUserDrafts, writeUserDrafts, type Drafts } from "./workspace-privacy";
import { speakerTurns, transcriptDownloadName, transcriptFromPayload, type TranscriptResult } from "./transcription-ui";
import { upscalePresets, upscaleRequest, upscaleRequestIdentity, type UpscalePreset, type UpscaleSettings } from "./upscale-request";
import { firstLastRequestIdentity, type FirstLastControls } from "./first-last-request";
import { repairRequestIdentity } from "./repair-request";
import { InpaintCanvas } from "./inpaint-canvas";
import { ChatVoiceInput } from "./chat-voice-input";
import { ChatMarkdown } from "./chat-markdown";
import { audioPriceNote } from "./audio-price-note";
import { generationRequestIdentity, parsePendingGeneration, uncertainGenerationMatches } from "./generation-idempotency";
import { parsePendingChatTurn, reconcileCompletedChatTurn, samePendingTurn, type ChatTurnInput, type PendingChatTurn } from "./chat-turn-idempotency";
import { specialistChatTransition, type SpecialistChatId } from "./specialist-chat";
import { captureChatContext } from "./chat-context-lease";
import { appendOptimisticChatTurn, chatScrollAfterPrepend, chatScrollIsNearBottom, createSerialAsyncQueue, type FailedOptimisticTurn } from "./chat-ui-state";
import { ThemedSelect } from "./themed-select";
import { retainImageReferenceOnModeChange, usableReference } from "./media-reference";

type Models = Record<View, string>;
type LocalFile = { name: string; mime: string; url: string; file?: File; assetId?: string };
type OutputTab = "text" | "image" | "video" | "audio";
type StudioRequestOptions = { modeIndex: number; aspect: string; quality: string; duration: number | "auto"; audio: boolean; loop: boolean; promptOptimizer: boolean; modelId: string; language: string; repairStart: number; repairEnd: number; upscale: UpscaleSettings; lastFrame?: File; maskFile?: File; musicDurationSec: number; forceInstrumental: boolean };

type VideoControls = {
  aspects: readonly string[];
  durations: readonly (number | "auto")[];
  qualities: readonly ("low" | "standard" | "high" | "ultra")[];
  audioToggle: boolean;
};

function videoControls(modelId: string, operation: string): VideoControls {
  if (modelId.startsWith("bytedance/seedance-2.5/")) return {
    aspects: ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    durations: ["auto", 4, 6, 8, 10, 15, 20, 30], qualities: ["low", "standard", "high"], audioToggle: true
  };
  if (modelId === "kling-3.0/video") return {
    aspects: operation === "text_to_video" ? ["16:9", "9:16", "1:1"] : [],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    qualities: ["standard", "high", "ultra"], audioToggle: true
  };
  if (modelId === "bytedance/seedance-2-5") return {
    aspects: [], durations: [], qualities: [], audioToggle: false
  };
  if (modelId.startsWith("fal-ai/kling-video/v3/standard/")) return {
    aspects: operation === "text_to_video" ? ["16:9", "9:16", "1:1"] : [],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], qualities: [], audioToggle: true
  };
  if (modelId === "fal-ai/kling-video/v3/turbo/standard/text-to-video") return {
    aspects: ["16:9", "9:16", "1:1"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], qualities: [], audioToggle: false
  };
  if (modelId.startsWith("fal-ai/minimax/hailuo-2.3/standard/")) return {
    aspects: [], durations: [6, 10], qualities: [], audioToggle: false
  };
  if (modelId === "fal-ai/luma-dream-machine/ray-2-flash") return {
    aspects: ["16:9", "9:16", "4:3", "3:4", "21:9", "9:21"],
    durations: [5, 9], qualities: ["low", "standard", "high"], audioToggle: false
  };
  if (modelId === "fal-ai/veo3.1") return {
    aspects: ["16:9", "9:16"], durations: [4, 6, 8],
    qualities: ["standard", "high", "ultra"], audioToggle: true
  };
  if (modelId.startsWith("fal-ai/wan/v2.7/")) return {
    aspects: operation === "image_to_video" ? [] : ["16:9", "9:16", "1:1", "4:3", "3:4"],
    durations: operation === "reference_to_video" ? [2, 3, 4, 5, 6, 7, 8, 9, 10]
      : [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    qualities: ["standard", "high"], audioToggle: false
  };
  if (modelId === "wavespeed-ai/open-video/image-to-video") return {
    aspects: [], durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    qualities: ["low", "standard", "high"], audioToggle: false
  };
  return { aspects: ["16:9", "9:16"], durations: [4, 6, 8], qualities: ["standard", "high"], audioToggle: true };
}

const navIcons: Record<View, LucideIcon> = {
  chat: MessageCircle,
  image: ImageIcon,
  video: Video,
  audio: AudioLines,
  explore: Compass,
  specialists: UsersRound
};

const defaultModels: Models = { chat: "openrouter/auto", image: "fal-ai/flux-2-pro", video: "fal-ai/veo3.1/fast", audio: "fal-ai/elevenlabs/tts/eleven-v3", explore: "auto", specialists: "auto" };

function isMediaView(view: View): view is MediaView {
  return mediaViews.includes(view as MediaView);
}

function uncertainGenerationMessage(locale: Locale): string {
  return locale === "fa"
    ? "وضعیت ارسال به سرویس‌دهنده نامشخص است. تکرار همین درخواست ممکن است هزینهٔ دوباره داشته باشد؛ Ailoom آن را خودکار دوباره نمی‌فرستد."
    : "The provider outcome is unknown. Repeating this request may incur another charge, so Ailoom will not resend it automatically.";
}

function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* Private browsing can disable storage. */ }
}

function loadUserDrafts(userId: string): Drafts {
  try { return readUserDrafts(window.localStorage, userId); }
  catch { return emptyDrafts(); }
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
  const label = (option: { id: string; name: string }) => option.id === "openrouter/auto"
    ? locale === "fa" ? "خودکار · OpenRouter" : "Auto · OpenRouter"
    : option.name;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const filtered = query.trim()
    ? normalized.filter(option => `${option.name} ${option.id}${view === "chat" && option.id.startsWith("openai/") ? " ChatGPT" : ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 60)
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
      <button type="button" className="model-picker-trigger" aria-label={`${t.model}: ${label(selected)}`} aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen(previous => !previous)}><Sparkles size={17} aria-hidden="true" /><span>{label(selected)}</span><ChevronDown size={14} aria-hidden="true" /></button>
      {open && <div className="model-popover" id={listId} role="group" aria-label={t.model}>
        <input ref={searchRef} type="search" aria-label={t.searchModels} placeholder={t.searchModels} value={query} onChange={event => setQuery(event.target.value)} />
        {options && <p className="model-catalog-count">{locale === "fa" ? `جست‌وجو در ${normalized.length} مدل` : `Search ${normalized.length} models`}</p>}
        <div className="model-results">{filtered.length ? filtered.map(option => <button type="button" key={option.id} className="model-result" aria-current={option.id === value ? "true" : undefined} onClick={() => { onChange(option.id); setOpen(false); setQuery(""); }}><span>{label(option)}</span><small dir="ltr">{option.id}</small>{option.id === value && <Check size={16} aria-hidden="true" />}</button>) : <p>{t.noModelsFound}</p>}</div>
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
          {user && <a className="icon-button" href="/api/account/export" aria-label={t.exportAccount} title={t.exportAccount}><Download size={19} /></a>}
          {user ? <button type="button" className="sign-in user-button" title={user.email} onClick={onSignOut}>{t.signOut}</button> : <button type="button" className="sign-in" onClick={onLogin}>{t.signIn}</button>}
        </div>
      </div>
    </header>
  );
}

function ChatComposer({ locale, prompt, onPrompt, model, onModel, modelList, mode, onMode, webSearch, onWebSearch, onSubmit, attachment, onAttach, onRemoveAttachment, inputRef, compact = false, disabled = false, voiceEnabled = false }: {
  locale: Locale; prompt: string; onPrompt: (value: string) => void; model: string; onModel: (value: string) => void;
  mode: "text" | "image"; onMode: (mode: "text" | "image") => void;
  webSearch: boolean; onWebSearch: (enabled: boolean) => void;
  onSubmit: () => void; attachment: LocalFile | null; onAttach: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveAttachment: () => void; inputRef: RefObject<HTMLTextAreaElement | null>; modelList?: ChatModel[];
  compact?: boolean; disabled?: boolean; voiceEnabled?: boolean;
}) {
  const t = copy[locale];
  const fileRef = useRef<HTMLInputElement>(null);
  const promptValueRef = useRef(prompt);
  promptValueRef.current = prompt;
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
    if (compact) inputRef.current?.focus();
  };
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
        <textarea id="chat-prompt" ref={inputRef} value={prompt} onChange={event => onPrompt(event.target.value)} onKeyDown={handleKeyDown} dir={directionForText(prompt, locale)} placeholder={mode === "image" ? t.chatImagePlaceholder : t.chatPlaceholder} rows={compact ? 2 : 4} />
        {attachment && <div className="attachment-pill"><Paperclip size={15} aria-hidden="true" /><span title={attachment.name}>{attachment.name}</span><button type="button" aria-label={t.removeFile} onClick={onRemoveAttachment} disabled={disabled}><X size={15} /></button></div>}
      </div>
      <div className="composer-toolbar">
        <div className="toolbar-left">
          <input ref={fileRef} className="sr-only" type="file" accept={mode === "text" ? "image/png,image/jpeg,image/webp,application/pdf" : "image/png,image/jpeg,image/webp"} onChange={event => { onAttach(event); event.currentTarget.value = ""; }} aria-label={t.attach} disabled={disabled} />
          <button type="button" className="attach-button" onClick={() => fileRef.current?.click()} aria-label={t.attach} disabled={disabled}><Plus size={20} /></button>
          <button type="button" className="chat-image-mode" aria-label={mode === "image" ? t.chatTextModeHint : t.chatImageModeHint} aria-pressed={mode === "image"} title={mode === "image" ? t.chatTextModeHint : t.chatImageModeHint} disabled={disabled} onClick={() => onMode(mode === "image" ? "text" : "image")}><ImageIcon size={18} aria-hidden="true" /><span>{t.chatImageMode}</span></button>
          {mode === "text" && <button type="button" className="chat-web-mode" aria-label={attachment ? t.webSearchNoImage : t.webSearchHint} aria-pressed={webSearch} title={attachment ? t.webSearchNoImage : t.webSearchHint} disabled={disabled || Boolean(attachment)} onClick={() => onWebSearch(!webSearch)}><Compass size={18} aria-hidden="true" /><span>{t.webSearch}</span></button>}
          {voiceEnabled && mode === "text" && <ChatVoiceInput locale={locale} disabled={disabled} onTranscript={text => onPrompt([promptValueRef.current.trim(), text].filter(Boolean).join(" "))} />}
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

function ChatWorkspace({ locale, user, conversations, historyLoading, historyLoadingMore, hasMoreConversations, onLoadMoreConversations, selectedId, projects, selectedProjectId, projectBusy, projectError, onSelectProject, onCreateProject, onUpdateProject, onDeleteProject, onMoveConversation, messages, messageLoading, olderMessagesLoading, hasOlderMessages, onLoadOlderMessages, pending, error, showSeparateRequest, previousRequestId, onSeparateRequest, prompt, onPrompt, model, onModel, modelList, mode, onMode, webSearch, onWebSearch, onSend, onSelect, onNew, attachment, onAttach, onRemoveAttachment, inputRef }: {
  locale: Locale; user: SessionUser; conversations: ConversationSummary[]; historyLoading: boolean;
  historyLoadingMore: boolean; hasMoreConversations: boolean; onLoadMoreConversations: () => void; selectedId: string | null;
  projects: ChatProject[]; selectedProjectId: string | null; projectBusy: boolean; projectError: string;
  onSelectProject: (id: string | null) => void;
  onCreateProject: (name: string, description: string | null) => Promise<boolean>;
  onUpdateProject: (id: string, name: string, description: string | null) => Promise<boolean>;
  onDeleteProject: (id: string) => Promise<boolean>;
  onMoveConversation: (id: string, projectId: string | null) => void;
  messages: ChatMessage[]; messageLoading: boolean; olderMessagesLoading: boolean;
  hasOlderMessages: boolean; onLoadOlderMessages: () => void; pending: boolean; error: string;
  showSeparateRequest: boolean; previousRequestId: string | null; onSeparateRequest: () => void;
  prompt: string; onPrompt: (value: string) => void; model: string; onModel: (value: string) => void; modelList: ChatModel[];
  mode: "text" | "image"; onMode: (mode: "text" | "image") => void;
  webSearch: boolean; onWebSearch: (enabled: boolean) => void;
  onSend: () => void; onSelect: (id: string) => void; onNew: () => void;
  attachment: LocalFile | null; onAttach: (event: ChangeEvent<HTMLInputElement>) => void; onRemoveAttachment: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const t = copy[locale];
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const followingReplyRef = useRef(true);
  const lastRenderedThread = useRef<{ id: string | null; firstId: string | null }>({ id: null, firstId: null });
  const prependSnapshotRef = useRef<{ id: string | null; firstId: string | null; top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const snapshot = prependSnapshotRef.current;
    if (!snapshot) return;
    if (messageLoading || selectedId !== snapshot.id) { prependSnapshotRef.current = null; return; }
    if (messages[0]?.id !== snapshot.firstId) {
      const area = messagesAreaRef.current;
      if (area) area.scrollTop = chatScrollAfterPrepend(snapshot.top, snapshot.height, area.scrollHeight);
      prependSnapshotRef.current = null;
    } else if (!olderMessagesLoading) prependSnapshotRef.current = null;
  }, [messages, selectedId, messageLoading, olderMessagesLoading]);
  useEffect(() => {
    if (messageLoading) {
      lastRenderedThread.current = { id: null, firstId: null };
      return;
    }
    const firstId = messages[0]?.id ?? null;
    const previous = lastRenderedThread.current;
    if (previous.id !== selectedId || (!previous.firstId && firstId)) followingReplyRef.current = true;
    if (followingReplyRef.current && (previous.id !== selectedId || previous.firstId === firstId || !previous.firstId)) {
      const area = messagesAreaRef.current;
      if (area) area.scrollTop = area.scrollHeight;
    }
    lastRenderedThread.current = { id: selectedId, firstId };
  }, [messages, selectedId, messageLoading]);
  const activeTitle = conversations.find(item => item.id === selectedId)?.title ?? t.newChat;
  const visibleConversations = selectedProjectId
    ? conversations.filter(item => item.projectId === selectedProjectId) : conversations;
  const activeProject = projects.find(item => item.id === selectedProjectId) ?? null;
  return (
    <section className="chat-workspace" aria-label={t.nav.chat}>
      <aside className="chat-history" aria-label={t.conversationHistory}>
        <div className="chat-history-header"><strong>{t.conversationHistory}</strong><button type="button" aria-label={t.newChat} onClick={onNew}><Plus size={19} /></button></div>
        <button type="button" className="new-chat-button" onClick={onNew}><Plus size={17} aria-hidden="true" />{t.newChat}</button>
        <ChatProjects locale={locale} projects={projects} selectedId={selectedProjectId} busy={projectBusy || pending} error={projectError}
          onSelect={onSelectProject} onCreate={onCreateProject} onUpdate={onUpdateProject} onDelete={onDeleteProject} />
        <div className="history-list">
          {historyLoading ? <p className="history-empty">{t.loadingConversations}</p> : <>{visibleConversations.length ? visibleConversations.map(item => <button key={item.id} type="button" aria-current={selectedId === item.id ? "page" : undefined} onClick={() => onSelect(item.id)}><MessageCircle size={16} aria-hidden="true" /><span>{item.title}</span></button>) : <p className="history-empty">{t.noConversations}</p>}{hasMoreConversations && <button type="button" className="history-more-button" onClick={onLoadMoreConversations} disabled={historyLoadingMore}>{historyLoadingMore ? locale === "fa" ? "در حال بارگذاری…" : "Loading…" : locale === "fa" ? "گفتگوهای قدیمی‌تر" : "Older conversations"}</button>}</>}
        </div>
        <div className="history-user"><span className="user-avatar" aria-hidden="true">{(user.name?.trim()[0] || user.email[0] || "A").toUpperCase()}</span><span><strong>{user.name || user.email}</strong><small>{user.email}</small></span></div>
      </aside>
      <div className="chat-main">
        <div className="chat-main-header"><span><MessageCircle size={19} aria-hidden="true" /><strong>{activeTitle}</strong></span><div className="chat-main-meta"><div className="chat-project-picker"><FolderClosed size={15} aria-hidden="true" /><ThemedSelect ariaLabel={locale === "fa" ? "پروژهٔ گفتگو" : "Conversation project"} value={selectedProjectId ?? ""} disabled={projectBusy || pending} onValueChange={value => {
          const projectId = value || null;
          if (selectedId) onMoveConversation(selectedId, projectId);
          else onSelectProject(projectId);
        }}><option value="">{projectLabel(locale, null)}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</ThemedSelect></div><span className="chat-model-badge">{modelList.find(item => item.id === model)?.name ?? t.smartChoice}</span></div></div>
        {activeProject?.description && <div className="chat-project-note" title={locale === "fa" ? "در چت متنی برای OpenRouter ارسال می‌شود" : "Sent to OpenRouter in text chats"}><FolderClosed size={14} aria-hidden="true" /><span>{activeProject.description}</span></div>}
        <div className="messages-area" ref={messagesAreaRef} onScroll={event => {
          const area = event.currentTarget;
          followingReplyRef.current = chatScrollIsNearBottom(area.scrollTop, area.clientHeight, area.scrollHeight);
        }} role="log" aria-live="polite" aria-label={t.nav.chat}>
          {messageLoading ? <div className="chat-empty"><p>{t.loadingMessages}</p></div>
            : messages.length ? <div className="message-stack">{hasOlderMessages && <button type="button" className="messages-more-button" onClick={() => {
              const area = messagesAreaRef.current;
              if (area) prependSnapshotRef.current = { id: selectedId, firstId: messages[0]?.id ?? null,
                top: area.scrollTop, height: area.scrollHeight };
              onLoadOlderMessages();
            }} disabled={olderMessagesLoading}>{olderMessagesLoading ? locale === "fa" ? "در حال بارگذاری…" : "Loading…" : locale === "fa" ? "پیام‌های قدیمی‌تر" : "Older messages"}</button>}{messages.map(message =>
              <div key={message.id} className={`chat-message chat-message-${message.role}${message.status === "error" ? " chat-message-error" : ""}`}>
                <span className="message-icon" aria-hidden="true">{message.role === "assistant" ? <BrandMark /> : (user.name?.trim()[0] || user.email[0] || "U").toUpperCase()}</span>
                <div className="message-body">
                  <span className="message-author">{message.role === "assistant" ? "Ailoom" : user.name || user.email}</span>
                  {(message.text || message.status === "streaming") && <div dir={directionForText(message.text, locale)}>{message.role === "assistant"
                    ? <ChatMarkdown text={message.text || "…"} /> : renderMessageText(message.text || "…")}</div>}
                  {message.status === "error" && <span className="message-delivery-note">{locale === "fa" ? "ارسال این پیام تأیید نشد؛ متن برای تلاش دوباره اینجاست." : "Delivery could not be confirmed. Your message is kept here for retry."}</span>}
                  {message.blocks?.filter(block => block.type !== "text").map((block, index) => {
                    if (block.type === "sources") return <div className="message-sources" key={`sources-${index}`}><strong><BookOpen size={16} aria-hidden="true" />{t.sourceLinks}</strong><div>{block.sources?.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<ArrowRight size={14} aria-hidden="true" /></a>)}</div></div>;
                    const url = block.url ?? (block.assetId ? `/api/assets/${encodeURIComponent(block.assetId)}` : "");
                    return <div className="message-media" key={block.assetId ?? block.url ?? index}>{block.type === "image" ? <img src={url} alt={block.alt || t.imageOutput} /> : block.type === "video" ? <video src={url} controls /> : block.type === "audio" ? <audio src={url} controls /> : <a href={url} download><FileText size={19} aria-hidden="true" />{block.alt || t.outputTabs.text}</a>}</div>;
                  })}
                  {message.status === "streaming" && <span className="stream-cursor" aria-hidden="true" />}
                </div>
              </div>)}</div>
            : <div className="chat-empty"><BrandMark /><h1>{t.chatHeadingFirst}<br /><em>{t.chatHeadingSecond}</em></h1><p>{t.noMessages}</p></div>}
        </div>
        <div className="chat-compose-wrap">
          {error && <div className="chat-error" role="alert">{error}{showSeparateRequest && <button type="button" onClick={onSeparateRequest}>{locale === "fa" ? "شروع درخواست جداگانه" : "Start a separate request"}</button>}</div>}
          {previousRequestId && <a className="chat-previous-request" href={`/api/chat?requestId=${encodeURIComponent(previousRequestId)}`} target="_blank" rel="noopener noreferrer">{locale === "fa" ? "بررسی وضعیت درخواست قبلی" : "Check previous request status"}</a>}
          <ChatComposer locale={locale} prompt={prompt} onPrompt={onPrompt} model={model} onModel={onModel} modelList={modelList} mode={mode} onMode={onMode} webSearch={webSearch} onWebSearch={onWebSearch} onSubmit={onSend} attachment={attachment} onAttach={onAttach} onRemoveAttachment={onRemoveAttachment} inputRef={inputRef} compact disabled={pending || messageLoading} voiceEnabled />
          <p className="chat-compose-note">{t.draftSaved}</p>
        </div>
      </div>
    </section>
  );
}

function GeneratedResult({ asset, locale, initialVisibility, onVisibilityChange, onUseReference }: {
  asset: MediaAsset; locale: Locale; initialVisibility?: "public" | "private";
  onVisibilityChange?: (visibility: "public" | "private") => void;
  onUseReference?: (asset: MediaAsset) => void;
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
      {asset.id && (asset.kind === "image" || asset.kind === "video") && onUseReference && <button className="result-reference" type="button" onClick={() => onUseReference(asset)}>{asset.kind === "image" ? <ImageIcon size={15} aria-hidden="true" /> : <Scissors size={15} aria-hidden="true" />}{asset.kind === "image" ? locale === "fa" ? "استفاده به‌عنوان مرجع" : "Use as reference" : locale === "fa" ? "استفاده برای ترمیم" : "Use for repair"}</button>}
      {asset.id && <div className="asset-visibility"><span role="status"><ShieldCheck size={15} aria-hidden="true" />{visibility === null ? error ? t.assetVisibilityUnavailable : t.assetVisibilityLoading : visibility === "public" ? t.assetPublic : t.assetPrivate}</span>{visibility !== null ? <button type="button" disabled={saving} onClick={() => void changeVisibility()}>{saving ? t.assetVisibilitySaving : visibility === "public" ? t.makePrivate : t.makePublic}</button> : error && <button type="button" onClick={() => setRefreshKey(previous => previous + 1)}>{t.retry}</button>}</div>}
    </div>
    {error && <p className="result-error" role="alert">{error}</p>}
  </div>;
}

function TranscriptionPanel({ locale, signedIn, onLogin }: { locale: Locale; signedIn: boolean; onLogin: () => void }) {
  const t = copy[locale];
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [language, setLanguage] = useState("auto");
  const [diarize, setDiarize] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TranscriptResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [newRequestAvailable, setNewRequestAvailable] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const submittingRef = useRef(false);
  const submissionRef = useRef<{ file: File; language: string; diarize: boolean; key: string } | null>(null);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => () => requestRef.current?.abort(), []);

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!selected) return;
    submissionRef.current = null;
    setResult(null);
    setCopied(false);
    setNewRequestAvailable(false);
    if (!selected.size || selected.size > 50_000_000) {
      setFile(null);
      setError(t.transcriptionTooLarge);
      return;
    }
    setFile(selected);
    setError("");
  };

  const transcribe = async () => {
    if (submittingRef.current) return;
    if (!file) { setError(t.transcriptionNoFile); fileRef.current?.focus(); return; }
    if (!signedIn) { onLogin(); return; }
    submittingRef.current = true;
    setPending(true);
    setError("");
    setResult(null);
    setCopied(false);
    setNewRequestAvailable(false);
    const controller = new AbortController();
    requestRef.current = controller;
    const previous = submissionRef.current;
    const key = previous?.file === file && previous.language === language && previous.diarize === diarize
      ? previous.key : crypto.randomUUID();
    submissionRef.current = { file, language, diarize, key };
    try {
      const form = new FormData();
      form.set("file", file);
      if (language !== "auto") form.set("languageCode", language);
      form.set("diarize", diarize ? "true" : "false");
      const response = await fetch("/api/audio/transcribe", {
        method: "POST", credentials: "same-origin", headers: { "Idempotency-Key": key },
        body: form, signal: controller.signal
      });
      if (!response.ok) {
        const body = await response.clone().json().catch(() => null);
        const status = body && typeof body === "object" && "status" in body ? body.status : null;
        if (status === "failed" || response.status >= 400 && response.status < 500 &&
          response.status !== 401 && response.status !== 403 && response.status !== 409)
          submissionRef.current = null;
        if (response.status === 409 && status === null) submissionRef.current = null;
        if (status === "completed" || status === "uncertain") setNewRequestAvailable(true);
        throw new Error(await responseError(response));
      }
      const transcript = transcriptFromPayload(await response.json());
      if (!transcript) throw new Error(t.transcriptionInvalidResponse);
      if (!controller.signal.aborted) {
        submissionRef.current = null;
        setResult(transcript);
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t.transcriptionInvalidResponse);
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      submittingRef.current = false;
      if (!controller.signal.aborted) setPending(false);
    }
  };

  const copyText = async () => {
    if (!result) return;
    try { await navigator.clipboard.writeText(result.text); setCopied(true); }
    catch { setError(t.transcriptionCopyError); }
  };
  const downloadText = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = transcriptDownloadName(file?.name ?? "transcript");
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const turns = result && diarize ? speakerTurns(result.words) : [];
  const speakerIds = [...new Set(turns.map(turn => turn.speakerId))];
  const detectedLanguage = result?.languageCode === "en" ? t.english
    : result?.languageCode === "fa" ? t.persian : result?.languageCode?.toUpperCase();

  return <>
    <div className="studio-layout transcription-layout">
      <div className="canvas-column">
        <div className="canvas-top"><strong>{t.transcriptionTitle}</strong><span>{file ? t.localPreview : t.canvasReady}</span></div>
        <div className="studio-canvas studio-canvas-audio transcription-canvas">
          {file && previewUrl ? <div className="uploaded-audio">
            <AudioLines size={31} aria-hidden="true" /><strong title={file.name}>{file.name}</strong>
            {file.type.startsWith("video/") ? <video src={previewUrl} controls preload="metadata" />
              : <audio src={previewUrl} controls preload="metadata" />}
          </div> : <div className="canvas-empty"><span className="canvas-empty-icon"><FileText size={30} aria-hidden="true" /></span><strong>{t.transcriptionTitle}</strong><p>{t.transcriptionDescription}</p><button type="button" onClick={() => fileRef.current?.click()}><Upload size={18} aria-hidden="true" />{t.transcriptionChooseFile}</button></div>}
        </div>
        <p className="canvas-footnote"><ShieldCheck size={17} aria-hidden="true" />{t.transcriptionProviderNote}</p>
      </div>
      <aside className="inspector" aria-label={t.settings}>
        <div className="inspector-heading"><span><SlidersHorizontal size={19} aria-hidden="true" />{t.input}</span></div>
        <input ref={fileRef} className="sr-only" type="file" accept=".mp3,.wav,.ogg,.m4a,.mp4,.webm,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm,video/mp4,video/webm" onChange={chooseFile} aria-label={t.transcriptionChooseFile} />
        <button className="outline-action transcription-file-button" type="button" onClick={() => fileRef.current?.click()} disabled={pending}><Upload size={17} aria-hidden="true" />{t.transcriptionChooseFile}</button>
        {file && <div className="file-chip"><span title={file.name}>{file.name}</span><button type="button" aria-label={t.removeFile} disabled={pending} onClick={() => { submissionRef.current = null; setFile(null); setResult(null); setError(""); setNewRequestAvailable(false); }}><X size={15} /></button></div>}
        <p className="transcription-file-hint">{t.transcriptionDescription}</p>
        <div className="inspector-divider" />
        <div className="inspector-heading subtle"><span>{t.settings}</span></div>
        <div className="form-field"><label htmlFor="transcription-language">{t.language}</label><div className="select-shell"><ThemedSelect id="transcription-language" value={language} onValueChange={value => { submissionRef.current = null; setNewRequestAvailable(false); setLanguage(value); }} disabled={pending}><option value="auto">{t.automatic}</option><option value="en">{t.english}</option><option value="fa">{t.persian}</option></ThemedSelect></div></div>
        <label className="toggle-field"><input type="checkbox" checked={diarize} onChange={event => { submissionRef.current = null; setNewRequestAvailable(false); setDiarize(event.target.checked); }} disabled={pending} /><span>{t.transcriptionDiarize}</span></label>
        <div className="inspector-spacer" />
        <button className="primary-action" type="button" onClick={() => void transcribe()} disabled={pending}>{pending ? t.transcriptionWorking : t.transcriptionAction}<ArrowRight size={17} aria-hidden="true" /></button>
        {error && <p className="transcription-error" role="alert">{error}</p>}
        {newRequestAvailable && <button className="outline-action" type="button" disabled={pending} onClick={() => {
          submissionRef.current = null; setNewRequestAvailable(false); setError("");
        }}>{locale === "fa" ? "درخواست تازه با هزینهٔ جداگانه" : "Start a new paid request"}</button>}
      </aside>
    </div>
    {result && <section className="transcription-result" aria-labelledby="transcription-result-title">
      <div className="transcription-result-heading"><div><span className="section-eyebrow">{t.transcriptionAction}</span><h2 id="transcription-result-title">{t.transcriptionResult}</h2>{detectedLanguage && <p>{t.transcriptionDetectedLanguage}: {detectedLanguage}</p>}</div><div className="transcription-result-actions"><button type="button" onClick={() => void copyText()}><Copy size={16} aria-hidden="true" />{copied ? t.transcriptionCopied : t.transcriptionCopy}</button><button type="button" onClick={downloadText}><Download size={16} aria-hidden="true" />{t.transcriptionDownload}</button></div></div>
      <div className="transcription-text" dir="auto">{result.text || t.transcriptionEmpty}</div>
      {turns.length > 0 && <div className="transcription-turns">{turns.map((turn, index) => <div className="transcription-turn" key={`${index}-${turn.start}`}><span>{t.transcriptionSpeaker} {speakerIds.indexOf(turn.speakerId) + 1} · {Math.floor(turn.start / 60).toString().padStart(2, "0")}:{Math.floor(turn.start % 60).toString().padStart(2, "0")}</span><p dir="auto">{turn.text}</p></div>)}</div>}
    </section>}
  </>;
}

function StudioPage({ view, locale, model, onModel, draft, onDraft, onSubmit, preview, onFile, onRemoveFile, onUseReference, onLastFrameChange, availableModels, catalogState, onCatalogRetry, job, jobError, uncertainRequestBlocked, onNewUncertainRequest, busy, initialMode, signedIn, onLogin, projects, projectId, onProjectChange }: {
  view: MediaView; locale: Locale; model: string; onModel: (value: string) => void;
  draft: string; onDraft: (value: string) => void; onSubmit: (options: StudioRequestOptions) => void;
  preview: LocalFile | null; onFile: (event: ChangeEvent<HTMLInputElement>) => void; onRemoveFile: () => void;
  onUseReference: (reference: LocalFile) => void;
  onLastFrameChange: () => void;
  availableModels: MediaModel[]; catalogState: "loading" | "ready" | "error"; onCatalogRetry: () => void;
  job: MediaJob | null; jobError: string; uncertainRequestBlocked: boolean; onNewUncertainRequest: () => void;
  busy: boolean; initialMode: number; signedIn: boolean; onLogin: () => void;
  projects: ChatProject[]; projectId: string | null; onProjectChange: (id: string | null) => void;
}) {
  const t = copy[locale];
  const [activeMode, setActiveMode] = useState(initialMode);
  const [aspect, setAspect] = useState("16:9");
  const [quality, setQuality] = useState("standard");
  const [language, setLanguage] = useState("auto");
  const [duration, setDuration] = useState<number | "auto">(8);
  const [generateAudio, setGenerateAudio] = useState(true);
  const [loopVideo, setLoopVideo] = useState(false);
  const [promptOptimizer, setPromptOptimizer] = useState(true);
  const [musicDurationSec, setMusicDurationSec] = useState(30);
  const [forceInstrumental, setForceInstrumental] = useState(false);
  const [clipDuration, setClipDuration] = useState(30);
  const [repairStart, setRepairStart] = useState(10);
  const [repairEnd, setRepairEnd] = useState(12);
  const [upscaleFactor, setUpscaleFactor] = useState<2 | 4>(2);
  const [upscalePreset, setUpscalePreset] = useState<UpscalePreset>("Standard V2");
  const [upscaleFormat, setUpscaleFormat] = useState<"jpeg" | "png">("jpeg");
  const [inpaintMask, setInpaintMask] = useState<File | null>(null);
  const [showCharacterOutput, setShowCharacterOutput] = useState(false);
  const [lastFrame, setLastFrame] = useState<LocalFile | null>(null);
  const [lastFrameError, setLastFrameError] = useState("");
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
  const tabsRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastFrameRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const CurrentIcon = navIcons[view];
  const tabs = t.studioTab[view];
  const activeOperation = view === "image" ? activeMode === 0 ? "text_to_image" : activeMode === 1 ? "image_edit" : activeMode === 2 ? "image_upscale" : activeMode === 3 ? "image_inpaint" : "character_to_image"
    : view === "video" ? activeMode === 0 ? "text_to_video" : activeMode === 1 ? "reference_to_video" : activeMode === 2 ? "temporal_inpaint" : "first_last_frame_to_video"
    : activeMode === 0 ? "text_to_speech" : activeMode === 1 ? "text_to_music" : null;
  const relevantModels = activeOperation ? availableModels.filter(item => item.operations.includes(activeOperation) || activeOperation === "reference_to_video" && item.operations.includes("image_to_video")) : [];
  const selectModels: Array<{ id: string; name: string; provider?: string }> = relevantModels;
  const effectiveModel = selectModels.some(item => item.id === model) ? model : selectModels[0]?.id || "";
  const selectedModel = availableModels.find(item => item.id === effectiveModel);
  const videoOperation = activeMode === 1 && selectedModel?.operations.includes("image_to_video")
    ? "image_to_video" : activeOperation || "text_to_video";
  const videoProfile = videoControls(effectiveModel, videoOperation);
  const imageAspectOptions = effectiveModel.startsWith("google/imagen4")
    ? ["16:9", "1:1", "9:16"] : ["16:9", "1:1", "4:3", "9:16"];
  const selectedAspect = view === "image" && !imageAspectOptions.includes(aspect)
    ? imageAspectOptions[0]
    : view === "video" && videoProfile.aspects.length
      ? videoProfile.aspects.includes(aspect) ? aspect : videoProfile.aspects[0] : aspect;
  const selectedDuration = view === "video" && videoProfile.durations.length > 0 && !videoProfile.durations.includes(duration)
    ? videoProfile.durations.includes(5) ? 5 : videoProfile.durations.includes(8) ? 8 : videoProfile.durations[0] : duration;
  const selectedQuality = view === "video" && videoProfile.qualities.length &&
    !videoProfile.qualities.includes(quality as "low" | "standard" | "high" | "ultra") ? "standard" : quality;
  const imageHasAspect = view === "image" && Boolean(effectiveModel) && !["nano-banana-2", "nano-banana-pro"].includes(effectiveModel);
  const imageHasQuality = imageHasAspect && (activeOperation === "character_to_image" ||
    selectedModel?.provider === "wavespeed" || effectiveModel.startsWith("openai/gpt-image-2.5/") ||
    selectedAspect === "1:1" && selectedModel?.provider === "fal");
  const musicMaxDuration = effectiveModel === "elevenlabs/music/v2.5" || effectiveModel === "elevenlabs/music/v2" ? 600
    : effectiveModel === "fal-ai/stable-audio-3/medium/text-to-audio" ? 380 : 120;
  const musicDurationOptions = [15, 30, 60, 120, 180, 300, 380, 600].filter(value => value <= musicMaxDuration);
  const effectiveMusicDuration = musicDurationOptions.includes(musicDurationSec) ? musicDurationSec : musicDurationOptions[0];
  const jobModel = availableModels.find(item => item.id === job?.providerModel);
  const speechJob = jobModel?.operations.includes("text_to_speech") || job?.providerModel === "fal-ai/elevenlabs/tts/eleven-v3";
  const musicJob = jobModel?.operations.includes("text_to_music") ||
    ["elevenlabs/music/v2", "fal-ai/stable-audio-3/small/music/text-to-audio"].includes(job?.providerModel ?? "");
  const displayJob = view === "image" && activeMode === 4 && job?.providerModel !== "fal-ai/ideogram/character" ? null
    : view !== "audio" || !job || activeMode === 0 && speechJob || activeMode === 1 && musicJob ? job : null;
  const outputAssets = mediaAssetsFromJob(displayJob);
  const selectedAsset = library.find(asset => asset.id === selectedAssetId);
  const shownAssets: MediaAsset[] = selectedAsset ? [{ id: selectedAsset.id, kind: selectedAsset.kind,
    url: selectedAsset.url, contentType: selectedAsset.mimeType }] : outputAssets;
  const completedJobId = job?.state === "succeeded" ? job.id : "";
  useEffect(() => {
    const strip = tabsRef.current;
    const selected = strip?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!strip || !selected) return;
    const stripBox = strip.getBoundingClientRect();
    const buttonBox = selected.getBoundingClientRect();
    const distance = buttonBox.left + buttonBox.width / 2 - stripBox.left - stripBox.width / 2;
    strip.scrollBy({ left: distance,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [activeMode, locale, view]);
  useEffect(() => () => { if (lastFrame?.url) URL.revokeObjectURL(lastFrame.url); }, [lastFrame?.url]);
  useEffect(() => { if (job?.id) setLastFrame(null); }, [job?.id]);
  useEffect(() => { if (job?.providerModel === "fal-ai/ideogram/character") setShowCharacterOutput(true); }, [job?.id, job?.providerModel]);
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
  const useOutputAsReference = async (asset: MediaAsset) => {
    if (!asset.id || asset.kind !== view || (view !== "image" && view !== "video")) return;
    setLastFrameError("");
    try {
      const matching = library.find(item => item.id === asset.id);
      let mime = asset.contentType || matching?.mimeType || "";
      const url = `/api/assets/${encodeURIComponent(asset.id)}`;
      if (!mime) {
        const response = await fetch(url, { credentials: "same-origin", cache: "no-store", headers: { Range: "bytes=0-0" } });
        if (!response.ok) throw new Error(await responseError(response));
        mime = response.headers.get("content-type")?.split(";")[0]?.trim() || "";
        await response.body?.cancel();
      }
      const allowed = view === "image" ? ["image/png", "image/jpeg", "image/webp"] : ["video/mp4", "video/webm"];
      if (!allowed.includes(mime)) throw new Error(t.unsupportedOperation);
      onUseReference({ name: mediaDownloadName({ ...asset, contentType: mime }), mime, url, assetId: asset.id });
      setSelectedAssetId(null);
      setActiveMode(view === "image" ? 1 : 2);
      setInpaintMask(null);
      setShowCharacterOutput(false);
      setLastFrame(null);
      onLastFrameChange();
      window.requestAnimationFrame(() => canvasRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (error) { setLastFrameError(error instanceof Error ? error.message : t.unsupportedOperation); }
  };
  const accept = view === "image" && activeMode === 3 ? "image/png,image/jpeg"
    : view === "image" || view === "video" && (activeMode === 1 || activeMode === 3) ? "image/png,image/jpeg,image/webp" : view === "video" ? "video/mp4,video/webm" : "";
  const showRepair = view === "video" && activeMode === 2;
  const showFirstLast = view === "video" && activeMode === 3;
  const showUpscale = view === "image" && activeMode === 2;
  const showInpaint = view === "image" && activeMode === 3;
  const showCharacter = view === "image" && activeMode === 4;
  const upscaleWorking = showUpscale && Boolean(job && ["queued", "submitting", "running"].includes(job.state));
  const inpaintWorking = showInpaint && Boolean(job && ["queued", "submitting", "running"].includes(job.state));
  const characterWorking = showCharacter && Boolean(job && job.providerModel === "fal-ai/ideogram/character" && ["queued", "submitting", "running"].includes(job.state));
  const audioWorking = view === "audio" && Boolean(job && ["queued", "submitting", "running"].includes(job.state));
  const needsReference = view === "image" && (activeMode === 1 || activeMode === 2 || activeMode === 3 || activeMode === 4) || view === "video" && (activeMode === 1 || activeMode === 2 || activeMode === 3);
  const handleGenerate = () => {
    if (showUpscale && !preview) { fileRef.current?.click(); return; }
    if (showInpaint && !preview) { fileRef.current?.click(); return; }
    if (showCharacter && !preview) { fileRef.current?.click(); return; }
    if (!showUpscale && !draft.trim()) { promptRef.current?.focus(); return; }
    if (showInpaint && !usableReference(preview, ["image/png", "image/jpeg"], 8_000_000)) {
      setLastFrameError(t.inpaintInvalid);
      return;
    }
    if (showInpaint && !inpaintMask) { setLastFrameError(t.inpaintMissing); return; }
    if (showCharacter && !usableReference(preview, ["image/png", "image/jpeg", "image/webp"], 10_000_000)) {
      setLastFrameError(t.characterInvalid);
      return;
    }
    if (showFirstLast && (!preview || !lastFrame?.file)) {
      setLastFrameError(t.firstLastMissing);
      (preview ? lastFrameRef : fileRef).current?.click();
      return;
    }
    if (showFirstLast && (!usableReference(preview, ["image/png", "image/jpeg", "image/webp"], 8_000_000) || !lastFrame?.file ||
      lastFrame.file.size === 0 || lastFrame.file.size > 8_000_000 ||
      !["image/png", "image/jpeg", "image/webp"].includes(lastFrame.file.type))) {
      setLastFrameError(t.firstLastTooLarge);
      return;
    }
    setLastFrameError("");
    onSubmit({ modeIndex: activeMode, aspect: selectedAspect, quality: selectedQuality, duration: selectedDuration,
      audio: generateAudio, loop: loopVideo, promptOptimizer, modelId: effectiveModel, language, repairStart, repairEnd,
      musicDurationSec: effectiveMusicDuration, forceInstrumental,
      upscale: { factor: upscaleFactor, preset: upscalePreset, outputFormat: upscaleFormat },
      ...(showInpaint && inpaintMask ? { maskFile: inpaintMask } : {}),
      ...(showFirstLast && lastFrame?.file ? { lastFrame: lastFrame.file } : {}) });
  };
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => { onFile(event); setInpaintMask(null); setShowCharacterOutput(false); setLastFrameError(""); event.currentTarget.value = ""; };
  const handleLastFrame = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size === 0 || file.size > 8_000_000) {
      setLastFrameError(t.firstLastTooLarge);
      return;
    }
    setLastFrameError("");
    onLastFrameChange();
    setLastFrame({ name: file.name, mime: file.type, file, url: URL.createObjectURL(file) });
  };
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
      <div className="studio-tabs" ref={tabsRef} role="group" aria-label={t.studioTitle[view]}>{tabs.map((name, index) => <button type="button" key={name} aria-pressed={activeMode === index} onClick={() => { if (index !== activeMode) { setActiveMode(index); setInpaintMask(null); setLastFrame(null); setShowCharacterOutput(false); onLastFrameChange(); setLastFrameError(""); if (!retainImageReferenceOnModeChange(view, index, preview)) onRemoveFile(); } }}>{name}</button>)}</div>
      {view === "image" && <div className="studio-tool-links"><a href="/image/editor">{t.layersTool}<ArrowRight size={15} aria-hidden="true" /></a><a href="/lora">{t.loraTool}<ArrowRight size={15} aria-hidden="true" /></a></div>}
      {view === "video" && <div className="studio-tool-links"><a href="/storyboards">{t.storyboardTool}<ArrowRight size={15} aria-hidden="true" /></a><a href="/video/captions">{t.captionsTool}<ArrowRight size={15} aria-hidden="true" /></a></div>}
      {view === "audio" && <div className="studio-tool-links"><a href="/audio/voices">{t.voicesTool}<ArrowRight size={15} aria-hidden="true" /></a><a href="/audio/dubbing">{t.dubbingTool}<ArrowRight size={15} aria-hidden="true" /></a><a href="/audio/effects">{t.effectsTool}<ArrowRight size={15} aria-hidden="true" /></a></div>}
      {view === "audio" && activeMode === 2 ? <TranscriptionPanel locale={locale} signedIn={signedIn} onLogin={onLogin} /> : <>
      <div className="studio-layout">
        <div className="canvas-column" ref={canvasRef}>
          <div className="canvas-top"><strong>{t.canvas}</strong>{selectedAsset ? <button type="button" className="canvas-return" onClick={() => setSelectedAssetId(null)}>{t.mediaLibraryBack}</button> : <span>{preview ? t.localPreview : t.canvasReady}</span>}</div>
          <div className={`studio-canvas studio-canvas-${view}`}>
            {selectedAsset ? <div className="generated-results"><GeneratedResult key={selectedAsset.id} asset={shownAssets[0]} locale={locale} initialVisibility={selectedAsset.visibility} onVisibilityChange={visibility => onVisibilityChange(selectedAsset.id, visibility)} onUseReference={view === "image" || view === "video" ? asset => void useOutputAsReference(asset) : undefined} /></div>
              : showFirstLast && (preview || lastFrame) ? <div className="frame-pair"><div className="frame-card"><strong>{t.firstFrame}</strong>{preview?.mime.startsWith("image/") ? <img src={preview.url} alt={preview.name} /> : <button type="button" onClick={() => fileRef.current?.click()}>{t.chooseFirstFrame}</button>}</div><div className="frame-card"><strong>{t.lastFrame}</strong>{lastFrame ? <img src={lastFrame.url} alt={lastFrame.name} /> : <button type="button" onClick={() => lastFrameRef.current?.click()}>{t.chooseLastFrame}</button>}</div></div>
              : preview && !(showCharacter && showCharacterOutput && displayJob) ? (showInpaint && ["image/png", "image/jpeg"].includes(preview.mime) ? <InpaintCanvas key={preview.url} src={preview.url} alt={preview.name}
                  labels={{ brush: t.inpaintBrush, clear: t.inpaintClear, hint: t.inpaintHint, invalid: t.inpaintInvalid,
                    uploadMask: locale === "fa" ? "بارگذاری ماسک PNG" : "Upload PNG mask",
                    invalidMask: locale === "fa" ? "ماسک باید فایل PNG زیر ۸ مگابایت و هم‌اندازهٔ تصویر اصلی باشد." : "Use a PNG mask under 8 MB with the same dimensions as the source image.",
                    maskReady: locale === "fa" ? "ماسک آماده است" : "Mask ready" }}
                  onMaskChange={setInpaintMask} />
                : (view === "image" || view === "video" && activeMode === 1) && preview.mime.startsWith("image/") ? <img className="uploaded-media" src={preview.url} alt={preview.name} /> : view === "video" && preview.mime.startsWith("video/") ? <video className="uploaded-media" src={preview.url} controls onLoadedMetadata={event => handleMetadata(event.currentTarget.duration)} /> : null)
              : displayJob?.state === "succeeded" && shownAssets.length ? <div className="generated-results">{shownAssets.map((asset, index) => <GeneratedResult asset={asset} locale={locale} onVisibilityChange={asset.id ? visibility => onVisibilityChange(asset.id!, visibility) : undefined} onUseReference={view === "image" || view === "video" ? item => void useOutputAsReference(item) : undefined} key={asset.id ?? asset.url + index} />)}</div>
              : displayJob?.state === "succeeded" ? <div className="job-status"><Check size={27} aria-hidden="true" /><strong>{t.generationDone}</strong><p>{t.generationOutputMissing}</p></div>
              : displayJob && ["queued", "submitting", "running"].includes(displayJob.state) ? <div className="job-status"><span className="job-spinner" aria-hidden="true" /><strong>{displayJob.state === "running" ? t.generationRunning : t.generationQueued}</strong><p>{t.generationHint}</p></div>
              : displayJob?.state === "failed" ? <div className="job-status"><X size={27} aria-hidden="true" /><strong>{t.generationFailed}</strong><p>{displayJob.errorCode === "submission_uncertain" ? uncertainGenerationMessage(locale) : displayJob.errorCode || jobError}</p></div>
              : displayJob?.state === "cancelled" ? <div className="job-status"><X size={27} aria-hidden="true" /><strong>{t.generationCancelled}</strong></div> : null}
            {!preview && !lastFrame && !displayJob && <div className="canvas-empty"><span className="canvas-empty-icon"><CurrentIcon size={30} aria-hidden="true" /></span><strong>{t.canvasReady}</strong><p>{view === "audio" ? activeMode === 1 ? t.musicCanvasHint : t.audioCanvasHint : showUpscale ? t.upscaleDescription : showFirstLast ? t.firstLastHint : needsReference ? t.referenceHint : t.addReference}</p>{needsReference && <button type="button" onClick={() => fileRef.current?.click()}><Upload size={18} aria-hidden="true" />{showFirstLast ? t.chooseFirstFrame : t.dropFile}</button>}</div>}
          </div>
          {(jobError || lastFrameError) && <div className="studio-error" role="alert">{lastFrameError || jobError}</div>}
          {uncertainRequestBlocked && !selectedAsset && <button type="button" className="outline-action" onClick={onNewUncertainRequest}>
            {locale === "fa" ? "شروع درخواست تازه با احتمال هزینهٔ دوباره" : "Start a new request with possible extra cost"}
          </button>}
           {displayJob && <div className="cost-note">{displayJob.costEstimateMicrosUsd !== null && displayJob.costEstimateMicrosUsd !== undefined ? `${t.priceEstimate}: $${(displayJob.costEstimateMicrosUsd / 1_000_000).toFixed(3)} USD` : t.noPriceEstimate}</div>}
           {showRepair && <div className="timeline"><div className="timeline-header"><span><Clock3 size={15} aria-hidden="true" />00:00</span><span>{Math.floor(clipDuration / 60).toString().padStart(2, "0")}:{(clipDuration % 60).toString().padStart(2, "0")}</span></div><div className="timeline-track"><div className="timeline-selection" style={{ insetInlineStart: `${repairStart / clipDuration * 100}%`, width: `${Math.max(2, (repairEnd - repairStart) / clipDuration * 100)}%` }} /></div><span className="timeline-caption">{t.repairHint}</span></div>}
          {view === "audio" && <div className="canvas-footnote"><AudioLines size={17} aria-hidden="true" />{activeMode === 1 ? t.musicModeHint : t.audioModeHint}</div>}
           {view === "image" && activeMode === 1 && <div className="canvas-footnote"><Layers3 size={17} aria-hidden="true" />{t.imageModeHint}</div>}
           {showInpaint && <div className="canvas-footnote"><Layers3 size={17} aria-hidden="true" />{t.inpaintHint}</div>}
           {showCharacter && <div className="canvas-footnote"><Layers3 size={17} aria-hidden="true" />{t.characterHint}</div>}
           {showUpscale && <div className="canvas-footnote"><Layers3 size={17} aria-hidden="true" />{t.upscaleModeHint}</div>}
           {showFirstLast && <div className="canvas-footnote"><Layers3 size={17} aria-hidden="true" />{t.firstLastHint}</div>}
        </div>
        <aside className="inspector" aria-label={t.settings}>
           <div className="inspector-heading"><span><SlidersHorizontal size={19} aria-hidden="true" />{t.input}</span>{needsReference && <button type="button" className="inspector-icon" aria-label={t.attach} onClick={() => fileRef.current?.click()}><Paperclip size={18} /></button>}</div>
           {needsReference && <input ref={fileRef} className="sr-only" type="file" accept={accept} onChange={handleFile} aria-label={t.dropFile} />}
           {showFirstLast && <input ref={lastFrameRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLastFrame} aria-label={t.chooseLastFrame} />}
          {preview && <div className="file-chip"><span title={preview.name}>{showFirstLast ? `${t.firstFrame}: ` : ""}{preview.name}</span><button type="button" aria-label={t.removeFile} onClick={() => { setInpaintMask(null); setShowCharacterOutput(false); onRemoveFile(); }}><X size={15} /></button></div>}
          {showCharacter && showCharacterOutput && preview?.mime.startsWith("image/") &&
            <img className="character-reference-thumb" src={preview.url} alt={preview.name} />}
          {showFirstLast && lastFrame && <div className="file-chip"><span title={lastFrame.name}>{t.lastFrame}: {lastFrame.name}</span><button type="button" aria-label={t.removeFile} onClick={() => { setLastFrame(null); onLastFrameChange(); }}><X size={15} /></button></div>}
          {showFirstLast && !lastFrame && <button className="media-library-refresh" type="button" onClick={() => lastFrameRef.current?.click()}><Upload size={16} aria-hidden="true" />{t.chooseLastFrame}</button>}
          {!showUpscale && <><label className="field-label" htmlFor="studio-prompt">{t.prompt}</label>
          <textarea id="studio-prompt" ref={promptRef} className="studio-prompt" dir={directionForText(draft, locale)} value={draft} onChange={event => onDraft(event.target.value)} placeholder={view === "audio" && activeMode === 1 ? t.musicPrompt : t.promptByView[view]} rows={5} /></>}
          <div className="inspector-divider" />
          <div className="inspector-heading subtle"><span>{t.settings}</span></div>
          <div className="form-field"><label htmlFor="studio-project">{locale === "fa" ? "پروژه" : "Project"}</label><div className="select-shell"><ThemedSelect id="studio-project" value={projectId ?? ""} onValueChange={value => onProjectChange(value || null)} disabled={busy}><option value="">{locale === "fa" ? "بدون پروژه" : "No project"}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</ThemedSelect></div></div>
          <div className="form-field"><label htmlFor="studio-model">{t.model}{catalogState === "ready" ? ` · ${selectModels.length}` : ""}</label><div className="select-shell"><ThemedSelect id="studio-model" value={effectiveModel} onValueChange={onModel} disabled={!selectModels.length}>{selectModels.length ? selectModels.map(option => <option key={option.id} value={option.id}>{option.name}{option.provider ? ` · ${option.provider === "kie" ? "Kie" : option.provider === "fal" ? "fal" : "WaveSpeed"}` : ""}</option>) : <option value="">{catalogState === "loading" ? locale === "fa" ? "در حال بارگذاری مدل‌ها…" : "Loading models…" : locale === "fa" ? "مدل‌ها در دسترس نیستند" : "Models unavailable"}</option>}</ThemedSelect></div>{catalogState === "error" && <button type="button" className="media-library-refresh" onClick={onCatalogRetry}>{t.retry}</button>}</div>
           {!showUpscale && !showInpaint && (imageHasAspect || view === "video" && Boolean(effectiveModel) && !showRepair && videoProfile.aspects.length > 0) && <div className="form-field"><label htmlFor="aspect-ratio">{t.aspectRatio}</label><div className="select-shell"><ThemedSelect id="aspect-ratio" value={selectedAspect} onValueChange={setAspect}>{(view === "image" ? imageAspectOptions : videoProfile.aspects).map(value => <option key={value} value={value}>{value === "auto" ? t.automatic : value}</option>)}</ThemedSelect></div></div>}
           {!showUpscale && !showInpaint && Boolean(effectiveModel) && (view === "video" && !showRepair && videoProfile.qualities.length > 0 || view === "image" && imageHasQuality) && <div className="form-field"><label htmlFor="media-quality">{t.quality}</label><div className="select-shell"><ThemedSelect id="media-quality" value={selectedQuality} onValueChange={setQuality}>{(view === "image" ? ["standard", "high"] : videoProfile.qualities).map(value => <option key={value} value={value}>{view === "video" ? effectiveModel === "kling-3.0/video" ? value === "standard" ? "Standard" : value === "high" ? "Pro" : "4K" : value === "low" ? effectiveModel === "fal-ai/luma-dream-machine/ray-2-flash" ? "540p" : "480p" : value === "standard" ? "720p" : value === "ultra" ? "4K" : "1080p" : value === "standard" ? t.standard : t.high}</option>)}</ThemedSelect></div></div>}
          {showUpscale && <>
            <div className="form-field"><label htmlFor="upscale-factor">{t.upscaleFactor}</label><div className="select-shell"><ThemedSelect id="upscale-factor" value={upscaleFactor} onValueChange={value => setUpscaleFactor(Number(value) as 2 | 4)}><option value={2}>2×</option><option value={4}>4×</option></ThemedSelect></div></div>
            <div className="form-field"><label htmlFor="upscale-preset">{t.upscalePreset}</label><div className="select-shell"><ThemedSelect id="upscale-preset" value={upscalePreset} onValueChange={value => setUpscalePreset(value as UpscalePreset)}>{upscalePresets.map(preset => <option value={preset} key={preset}>{preset}</option>)}</ThemedSelect></div></div>
            <div className="form-field"><label htmlFor="upscale-format">{t.upscaleFormat}</label><div className="select-shell"><ThemedSelect id="upscale-format" value={upscaleFormat} onValueChange={value => setUpscaleFormat(value as "jpeg" | "png")}><option value="jpeg">JPEG</option><option value="png">PNG</option></ThemedSelect></div></div>
          </>}
           {view === "video" && Boolean(effectiveModel) && !showRepair && videoProfile.durations.length > 0 && <div className="form-field"><label htmlFor="video-duration">{t.duration}</label><div className="select-shell"><ThemedSelect id="video-duration" value={selectedDuration} onValueChange={value => setDuration(value === "auto" ? "auto" : Number(value))}>{videoProfile.durations.map(value => <option key={value} value={value}>{value === "auto" ? t.automaticDuration : `${value} ${t.seconds}`}</option>)}</ThemedSelect></div></div>}
           {view === "video" && Boolean(effectiveModel) && !showRepair && videoProfile.audioToggle && <label className="toggle-field"><input type="checkbox" checked={generateAudio} onChange={event => setGenerateAudio(event.target.checked)} /><span>{t.videoAudio}</span></label>}
           {view === "video" && !showRepair && effectiveModel === "fal-ai/luma-dream-machine/ray-2-flash" && <label className="toggle-field"><input type="checkbox" checked={loopVideo} onChange={event => setLoopVideo(event.target.checked)} /><span>{locale === "fa" ? "ویدیوی تکرارشونده" : "Seamless loop"}</span></label>}
           {view === "video" && !showRepair && effectiveModel.startsWith("fal-ai/minimax/hailuo-2.3/standard/") && <label className="toggle-field"><input type="checkbox" checked={promptOptimizer} onChange={event => setPromptOptimizer(event.target.checked)} /><span>{locale === "fa" ? "بهینه‌سازی توصیف" : "Optimize prompt"}</span></label>}
          {view === "audio" && activeMode === 0 && <div className="form-field"><label htmlFor="audio-language">{t.language}</label><div className="select-shell"><ThemedSelect id="audio-language" value={language} onValueChange={setLanguage}><option value="auto">{t.automatic}</option><option value="en">{t.english}</option><option value="fa">{t.persian}</option></ThemedSelect></div></div>}
          {view === "audio" && activeMode === 1 && <div className="form-field"><label htmlFor="music-duration">{t.duration}</label><div className="select-shell"><ThemedSelect id="music-duration" value={effectiveMusicDuration} onValueChange={value => setMusicDurationSec(Number(value))}>{musicDurationOptions.map(value => <option key={value} value={value}>{value} {t.seconds}</option>)}</ThemedSelect></div></div>}
          {view === "audio" && activeMode === 1 && (effectiveModel === "elevenlabs/music/v2" || effectiveModel === "elevenlabs/music/v2.5") && <label className="toggle-field"><input type="checkbox" checked={forceInstrumental} onChange={event => setForceInstrumental(event.target.checked)} /><span>{t.musicInstrumental}</span></label>}
          {showRepair && <div className="repair-controls"><div className="repair-title"><Scissors size={17} aria-hidden="true" /><strong>{t.repairRange}</strong></div><p>{preview ? t.repairHint : t.noClip}</p><div className="repair-fields"><div className="form-field"><label htmlFor="repair-start">{t.startTime}</label><div className="input-suffix"><input id="repair-start" type="number" min={0} max={Math.max(0, repairEnd - 1)} step={0.1} value={repairStart} onChange={event => setRepairStart(Math.max(0, Math.min(repairEnd - .1, Number(event.target.value) || 0)))} /><span>s</span></div></div><div className="form-field"><label htmlFor="repair-end">{t.endTime}</label><div className="input-suffix"><input id="repair-end" type="number" min={repairStart + .1} max={clipDuration} step={0.1} value={repairEnd} onChange={event => setRepairEnd(Math.min(clipDuration, Math.max(repairStart + .1, Number(event.target.value) || repairStart + .1)))} /><span>s</span></div></div></div></div>}
          <div className="inspector-spacer" />
            <button className="primary-action" type="button" onClick={handleGenerate} disabled={!selectModels.length || busy || upscaleWorking || inpaintWorking || characterWorking || audioWorking}>{busy || upscaleWorking || inpaintWorking || characterWorking || audioWorking ? t.generationQueued : showUpscale ? t.upscaleAction : showRepair ? t.repairRange : t.generate}<ArrowRight size={17} aria-hidden="true" /></button>
            {view === "audio" && activeMode === 1 && <p className="inspector-note">{audioPriceNote(locale, effectiveModel, selectedModel?.priceNote)}</p>}
            {showInpaint && <p className="inspector-note">{t.inpaintCost}</p>}
            {showCharacter && <p className="inspector-note">{t.characterCost}</p>}
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
      </>}
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
  const [draftsUserId, setDraftsUserId] = useState<string | null>(null);
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
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [mediaProjectId, setMediaProjectId] = useState<string | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectError, setProjectError] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [olderMessagesLoading, setOlderMessagesLoading] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [chatPending, setChatPending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatNeedsDecision, setChatNeedsDecision] = useState(false);
  const [chatPreviousRequestId, setChatPreviousRequestId] = useState<string | null>(null);
  const [specialistId, setSpecialistId] = useState<SpecialistChatId | null>(null);
  const [mediaModels, setMediaModels] = useState<MediaModel[]>([]);
  const [mediaCatalogState, setMediaCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [mediaCatalogRevision, setMediaCatalogRevision] = useState(0);
  const [mediaJobs, setMediaJobs] = useState<Partial<Record<MediaView, MediaJob>>>({});
  const [mediaErrors, setMediaErrors] = useState<Partial<Record<MediaView, string>>>({});
  const [mediaSubmitting, setMediaSubmitting] = useState<Partial<Record<MediaView, boolean>>>({});
  const mediaSubmittingRef = useRef<Partial<Record<MediaView, boolean>>>({});
  const upscaleSubmissionRef = useRef<{ identity: string; key: string } | null>(null);
  const inpaintSubmissionRef = useRef<{ identity: string; key: string } | null>(null);
  const characterSubmissionRef = useRef<{ identity: string; key: string } | null>(null);
  const inpaintMaskUploadRef = useRef<{ file: File; assetId: string } | null>(null);
  const musicSubmissionRef = useRef<{ identity: string; key: string } | null>(null);
  const firstLastSubmissionRef = useRef<{ identity: string; key: string } | null>(null);
  const lastFrameUploadRef = useRef<{ file: File; assetId: string } | null>(null);
  const repairSubmissionRef = useRef<{ identity: string; key: string } | null>(null);
  const genericSubmissionRef = useRef<Partial<Record<MediaView, { identity: string; key: string }>>>({});
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(false);
  const imageRequestRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const textRequestRef = useRef<PendingChatTurn | null>(null);
  const failedOptimisticTurnRef = useRef<FailedOptimisticTurn | null>(null);
  const modelSelectionVersionRef = useRef(0);
  const modelSaveQueueRef = useRef(createSerialAsyncQueue());
  const authEpochRef = useRef(0);
  const historyRequestEpochRef = useRef(0);
  const conversationLoadEpochRef = useRef(0);
  const conversationLoadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const savedLocale = readStorage("ailoom.locale");
    const savedTheme = readStorage("ailoom.theme");
    const savedImageChatModel = readStorage("ailoom.imageChatModel");
    if (savedLocale === "en" || savedLocale === "fa") setLocale(savedLocale);
    if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
    if (savedImageChatModel) setImageChatModel(savedImageChatModel);
    // Earlier builds used a shared key. It could expose one account's prompt to
    // another account or a signed-out visitor, so it must never be restored.
    try { window.localStorage.removeItem("ailoom.drafts"); }
    catch { /* Private browsing can disable storage. */ }
    try {
      const savedModels = JSON.parse(readStorage("ailoom.models") ?? "{}") as Partial<Models>;
      setModels({ ...defaultModels, ...Object.fromEntries(views.map(item => {
        const saved = savedModels[item];
        return [item, typeof saved === "string" && saved.length > 0 && saved.length <= 200 ? saved : defaultModels[item]];
      })) });
    } catch { /* Ignore invalid local data. */ }
    const url = new URL(window.location.href);
    const directToken = url.pathname.match(/^\/invite\/([^/]+)\/?$/)?.[1];
    const queryToken = url.searchParams.get("invite") ?? url.searchParams.get("token");
    setInviteToken(previous => queryToken ?? directToken ?? previous);
    if (queryToken) {
      url.searchParams.delete("invite");
      url.searchParams.delete("token");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      setAuthOpen(true);
    }
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
  useEffect(() => {
    if (!hydrated || !user || draftsUserId !== user.id) return;
    try { writeUserDrafts(window.localStorage, user.id, drafts); }
    catch { /* Private browsing can disable storage. */ }
  }, [drafts, hydrated, user, draftsUserId]);
  useEffect(() => { if (hydrated) writeStorage("ailoom.models", JSON.stringify(models)); }, [models, hydrated]);
  useEffect(() => { if (hydrated) writeStorage("ailoom.imageChatModel", imageChatModel); }, [imageChatModel, hydrated]);
  useEffect(() => {
    let active = true;
    const epoch = authEpochRef.current;
    fetch("/api/auth/get-session", { credentials: "same-origin", cache: "no-store" })
      .then(async response => response.ok ? response.json() : null)
      .then(body => {
        if (!active || epoch !== authEpochRef.current) return;
        const sessionUser = sessionUserFromPayload(body);
        if (sessionUser) {
          const saved = loadUserDrafts(sessionUser.id);
          setDrafts(current => ({ ...saved, ...Object.fromEntries(views.map(view =>
            [view, current[view] || saved[view]])) }));
          setDraftsUserId(sessionUser.id);
        }
        setUser(sessionUser);
      })
      .catch(() => { if (active && epoch === authEpochRef.current) setUser(null); });
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
          for (const item of catalog.models) if (!unique.has(item.id)) unique.set(item.id, item);
          const ordered = prepareChatModelCatalog([...unique.values()]);
          const available = new Set(ordered.map(item => item.id));
          setChatModels(ordered);
          setModels(previous => ({ ...previous, chat: available.has(previous.chat) ? previous.chat : catalog.defaultModelId }));
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
    setMediaCatalogState("loading");
    fetch("/api/media/models", { credentials: "same-origin", cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("model_catalog_unavailable");
        return response.json();
      })
      .then(body => {
        if (!active) return;
        const catalog = mediaModelsFromPayload(body);
        if (!catalog.length) throw new Error("model_catalog_empty");
        setMediaModels(catalog);
        setMediaCatalogState("ready");
        setModels(previous => {
          const next = { ...previous };
          const imageChoices = catalog.filter(item => item.outputKind === "image");
          const videoChoices = catalog.filter(item => item.outputKind === "video");
          const audioChoices = catalog.filter(item => item.outputKind === "audio");
          if (imageChoices.length && !imageChoices.some(item => item.id === next.image)) next.image = imageChoices[0].id;
          if (videoChoices.length && !videoChoices.some(item => item.id === next.video)) next.video = videoChoices[0].id;
          if (audioChoices.length && !audioChoices.some(item => item.id === next.audio)) next.audio = audioChoices[0].id;
          return next;
        });
      })
      .catch(() => { if (active) setMediaCatalogState("error"); });
    return () => { active = false; };
  }, [mediaCatalogRevision]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => () => { if (attachment) URL.revokeObjectURL(attachment.url); }, [attachment?.url]);
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
    if (target === "chat") {
      const selectionVersion = ++modelSelectionVersionRef.current;
      if (user) {
        const authEpoch = authEpochRef.current;
        void modelSaveQueueRef.current(async () => {
          if (authEpoch !== authEpochRef.current) return;
          const response = await fetch("/api/chat/model", { method: "PUT", credentials: "same-origin",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelId: value }) });
          if (!response.ok) throw new Error(await responseError(response));
        }).catch(error => {
          if (authEpoch === authEpochRef.current && selectionVersion === modelSelectionVersionRef.current)
            setNotice(error instanceof Error ? error.message : copy[locale].modelUnavailable);
        });
      }
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
      if (pendingRef.current) {
        conversationLoadEpochRef.current++;
        setSelectedConversationId(null);
        setMessages([]);
        setHasOlderMessages(false);
        setSpecialistId(null);
      }
      setChatMode("text");
      if (options?.modelId) updateModel("chat", options.modelId);
      if (file) setAttachment({ name: file.name, mime: file.type, file, url: URL.createObjectURL(file) });
    } else if (isMediaView(nextView)) {
      let chosenModel = options?.modelId;
      let mode = 0;
      if (nextView === "audio" && mediaModels.some(item => item.id === chosenModel && item.operations.includes("text_to_music"))) mode = 1;
      if (file && nextView === "image") {
        mode = 1;
        if (!mediaModels.some(item => item.id === chosenModel && item.operations.includes("image_edit"))) chosenModel = "fal-ai/qwen-image-edit";
      }
      if (file && nextView === "video" && file.type.startsWith("image/")) {
        mode = 1;
        if (!mediaModels.some(item => item.id === chosenModel && (item.operations.includes("image_to_video") || item.operations.includes("reference_to_video")))) {
          chosenModel = options?.modelId?.startsWith("bytedance/seedance-2.5/")
            ? "bytedance/seedance-2.5/reference-to-video" : "fal-ai/veo3.1/fast/image-to-video";
        }
      }
      if (file && nextView === "video" && file.type.startsWith("video/")) { mode = 2; chosenModel = "fal-ai/ltx-2.3-quality/inpaint"; }
      setStudioMode(mode);
      if (file) setPreview({ name: file.name, mime: file.type, file, url: URL.createObjectURL(file) });
      if (chosenModel && (mediaModels.some(item => item.id === chosenModel && item.outputKind === nextView) ||
        modelOptions[nextView].some(item => item.id === chosenModel))) updateModel(nextView, chosenModel);
    }
  };
  const askSpecialist = (id: string, prompt: string) => {
    const transition = specialistChatTransition(id);
    conversationLoadEpochRef.current++;
    conversationLoadAbortRef.current?.abort();
    conversationLoadAbortRef.current = null;
    setMessagesLoading(false);
    setChatMode(transition.mode);
    setSpecialistId(transition.specialistId);
    setSelectedConversationId(transition.conversationId);
    setMessages([]);
    failedOptimisticTurnRef.current = null;
    setHasOlderMessages(false);
    updateDraft("chat", prompt);
    navigate("chat");
    if (!user) openLogin(prompt, "chat");
  };
  const t = copy[locale];

  const refreshConversations = useCallback(async () => {
    const epoch = ++historyRequestEpochRef.current;
    setHistoryLoading(true);
    setHistoryLoadingMore(false);
    try {
      const params = new URLSearchParams();
      if (selectedProjectId) params.set("projectId", selectedProjectId);
      const response = await fetch(`/api/chat/conversations${params.size ? `?${params}` : ""}`,
        { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      const page = conversationsFromPayload(await response.json());
      if (epoch !== historyRequestEpochRef.current) return;
      setConversations(page);
      setHasMoreConversations(page.length === 50);
    } catch {
      if (epoch === historyRequestEpochRef.current) {
        setConversations([]);
        setHasMoreConversations(false);
      }
    } finally {
      if (epoch === historyRequestEpochRef.current) setHistoryLoading(false);
    }
  }, [selectedProjectId]);

  const loadMoreConversations = async () => {
    const cursor = conversations.at(-1)?.id;
    if (!cursor || !hasMoreConversations || historyLoading || historyLoadingMore) return;
    const epoch = historyRequestEpochRef.current;
    setHistoryLoadingMore(true);
    try {
      const params = new URLSearchParams({ cursor });
      if (selectedProjectId) params.set("projectId", selectedProjectId);
      const response = await fetch(`/api/chat/conversations?${params}`, {
        credentials: "same-origin", cache: "no-store"
      });
      if (!response.ok) throw new Error(await responseError(response));
      const page = conversationsFromPayload(await response.json());
      if (epoch !== historyRequestEpochRef.current) return;
      setConversations(previous => {
        const seen = new Set(previous.map(item => item.id));
        return [...previous, ...page.filter(item => !seen.has(item.id))];
      });
      setHasMoreConversations(page.length === 50);
    } catch { /* The older page can be retried without discarding loaded conversations. */ }
    finally { if (epoch === historyRequestEpochRef.current) setHistoryLoadingMore(false); }
  };

  const refreshProjects = useCallback(async () => {
    try {
      const response = await fetch("/api/projects", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      setProjects(projectsFromPayload(await response.json()));
      setProjectError("");
    } catch (error) {
      setProjects([]);
      setProjectError(error instanceof Error ? error.message : "Projects could not be loaded.");
    }
  }, []);

  useEffect(() => {
    if (user) void refreshConversations();
    else {
      historyRequestEpochRef.current++;
      setConversations([]); setHasMoreConversations(false); setHistoryLoading(false); setHistoryLoadingMore(false);
      setSelectedConversationId(null); setMessages([]); setHasOlderMessages(false);
    }
  }, [user, refreshConversations]);
  useEffect(() => {
    if (user) void refreshProjects();
    else { setProjects([]); setSelectedProjectId(null); setMediaProjectId(null); setProjectError(""); }
  }, [user, refreshProjects]);
  useEffect(() => {
    if (mediaProjectId && !projects.some(project => project.id === mediaProjectId)) setMediaProjectId(null);
  }, [projects, mediaProjectId]);
  useEffect(() => {
    if (!user) { setChatPreviousRequestId(null); return; }
    try { setChatPreviousRequestId(window.sessionStorage.getItem(`ailoom.chatTextPrevious.${user.id}`)); }
    catch { setChatPreviousRequestId(null); }
  }, [user]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const selectionVersion = modelSelectionVersionRef.current;
    fetch("/api/chat/model", { credentials: "same-origin", cache: "no-store" })
      .then(async response => response.ok ? response.json() : null)
      .then(body => { if (active && selectionVersion === modelSelectionVersionRef.current && typeof body?.modelId === "string")
        setModels(previous => ({ ...previous, chat: body.modelId })); })
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
          const kind = mediaViewForJob(item?.kind, item?.providerModel, mediaModels);
          if (!kind || latest[kind]) continue;
          const job = mediaJobFromPayload({ job: item });
          if (job) latest[kind] = job;
        }
        setMediaJobs(latest);
      })
      .catch(() => { /* A new job can still be submitted. */ });
    return () => { active = false; };
  }, [user, mediaModels]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    for (const target of mediaViews) {
      const storageKey = `ailoom.mediaPending.${user.id}.${target}`;
      let stored: { identity: string; key: string } | null = null;
      try {
        const raw = window.sessionStorage.getItem(storageKey);
        const parsed = raw ? JSON.parse(raw) as { identity?: unknown } : null;
        if (typeof parsed?.identity === "string") stored = parsePendingGeneration(raw, parsed.identity);
      } catch { /* Browser storage can be unavailable. */ }
      if (!stored) continue;
      genericSubmissionRef.current[target] = stored;
      void fetch(`/api/generations/${encodeURIComponent(stored.key)}`, { credentials: "same-origin", cache: "no-store" })
        .then(async response => response.ok ? response.json() : null)
        .then(body => {
          if (!active) return;
          const job = mediaJobFromPayload(body);
          if (!job) return;
          setMediaJobs(previous => ({ ...previous, [target]: job }));
        }).catch(() => { /* A later retry can inspect the same request key. */ });
    }
    return () => { active = false; };
  }, [user]);
  useEffect(() => {
    if (!user) return;
    for (const target of mediaViews) {
      const job = mediaJobs[target];
      const pending = genericSubmissionRef.current[target];
      if (!job || !pending || job.id !== pending.key || !["succeeded", "failed", "cancelled"].includes(job.state) ||
        uncertainGenerationMatches(job, pending)) continue;
      delete genericSubmissionRef.current[target];
      try { window.sessionStorage.removeItem(`ailoom.mediaPending.${user.id}.${target}`); }
      catch { /* In-memory state is already cleared. */ }
    }
  }, [user, mediaJobs]);
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
    conversationLoadAbortRef.current?.abort();
    const controller = new AbortController();
    conversationLoadAbortRef.current = controller;
    const epoch = ++conversationLoadEpochRef.current;
    setSpecialistId(null);
    setSelectedConversationId(id);
    setMessages([]);
    failedOptimisticTurnRef.current = null;
    setMessagesLoading(true);
    setOlderMessagesLoading(false);
    setHasOlderMessages(false);
    setChatError("");
    try {
      const response = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(await responseError(response));
      const body = await response.json();
      if (epoch !== conversationLoadEpochRef.current || controller.signal.aborted) return;
      setSelectedProjectId(typeof body?.conversation?.projectId === "string" ? body.conversation.projectId : null);
      const page = messagesFromPayload(body);
      setMessages(page);
      setHasOlderMessages(page.length === 100);
    } catch (error) {
      if (epoch === conversationLoadEpochRef.current && !controller.signal.aborted) {
        setChatError(error instanceof Error ? error.message : t.sendError);
      }
    } finally {
      if (epoch === conversationLoadEpochRef.current) {
        setMessagesLoading(false);
        conversationLoadAbortRef.current = null;
      }
    }
  };

  const loadOlderMessages = async () => {
    const before = messages[0]?.id;
    const id = selectedConversationId;
    if (!before || !id || !hasOlderMessages || messagesLoading || olderMessagesLoading || pendingRef.current) return;
    const epoch = conversationLoadEpochRef.current;
    setOlderMessagesLoading(true);
    try {
      const response = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}?before=${encodeURIComponent(before)}`, {
        credentials: "same-origin", cache: "no-store"
      });
      if (!response.ok) throw new Error(await responseError(response));
      const page = messagesFromPayload(await response.json());
      if (epoch !== conversationLoadEpochRef.current) return;
      setMessages(previous => {
        const seen = new Set(previous.map(item => item.id));
        return [...page.filter(item => !seen.has(item.id)), ...previous];
      });
      setHasOlderMessages(page.length === 100);
    } catch { /* The older page can be retried without losing the current messages. */ }
    finally { if (epoch === conversationLoadEpochRef.current) setOlderMessagesLoading(false); }
  };

  const newConversation = () => {
    if (pendingRef.current) return;
    conversationLoadEpochRef.current++;
    conversationLoadAbortRef.current?.abort();
    conversationLoadAbortRef.current = null;
    setMessagesLoading(false);
    setChatMode("text");
    setSpecialistId(null);
    setSelectedConversationId(null);
    setMessages([]);
    failedOptimisticTurnRef.current = null;
    setHasOlderMessages(false);
    setChatError("");
    promptRef.current?.focus();
  };

  const selectProject = (projectId: string | null) => {
    if (pendingRef.current) return;
    conversationLoadEpochRef.current++;
    conversationLoadAbortRef.current?.abort();
    conversationLoadAbortRef.current = null;
    setMessagesLoading(false);
    setSelectedProjectId(projectId);
    setSelectedConversationId(null);
    setMessages([]);
    failedOptimisticTurnRef.current = null;
    setHasOlderMessages(false);
    setChatError("");
  };

  const createChatProject = async (name: string, description: string | null): Promise<boolean> => {
    if (projectBusy) return false;
    setProjectBusy(true);
    setProjectError("");
    try {
      const response = await fetch("/api/projects", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description }) });
      if (!response.ok) throw new Error(await responseError(response));
      const project = projectsFromPayload({ projects: [(await response.json()).project] })[0];
      if (!project) throw new Error("Project could not be saved.");
      setProjects(previous => [project, ...previous]);
      selectProject(project.id);
      return true;
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Project could not be saved.");
      return false;
    } finally { setProjectBusy(false); }
  };

  const updateChatProject = async (id: string, name: string, description: string | null): Promise<boolean> => {
    if (projectBusy) return false;
    setProjectBusy(true);
    setProjectError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "PATCH", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description }) });
      if (!response.ok) throw new Error(await responseError(response));
      const project = projectsFromPayload({ projects: [(await response.json()).project] })[0];
      if (!project) throw new Error("Project could not be saved.");
      setProjects(previous => previous.map(item => item.id === id ? project : item));
      return true;
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Project could not be saved.");
      return false;
    } finally { setProjectBusy(false); }
  };

  const deleteChatProject = async (id: string): Promise<boolean> => {
    if (projectBusy) return false;
    setProjectBusy(true);
    setProjectError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseError(response));
      setProjects(previous => previous.filter(item => item.id !== id));
      setConversations(previous => previous.map(item => item.projectId === id ? { ...item, projectId: null } : item));
      if (selectedProjectId === id) setSelectedProjectId(null);
      return true;
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Project could not be deleted.");
      return false;
    } finally { setProjectBusy(false); }
  };

  const moveConversation = async (id: string, projectId: string | null) => {
    if (projectBusy || pendingRef.current) return;
    setProjectBusy(true);
    setProjectError("");
    try {
      const response = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId })
      });
      if (!response.ok) throw new Error(await responseError(response));
      setConversations(previous => previous.map(item => item.id === id ? { ...item, projectId } : item));
      setSelectedProjectId(projectId);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Conversation could not be moved.");
    } finally { setProjectBusy(false); }
  };

  const sendChatImage = async () => {
    if (pendingRef.current || messagesLoading || conversationLoadAbortRef.current) return;
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
    const initialProjectId = selectedProjectId;
    const retryIdentity = JSON.stringify(["image", prompt, modelId, attachment?.url ?? null]);
    const failedTurn = failedOptimisticTurnRef.current;
    const context = captureChatContext(() => conversationLoadEpochRef.current);
    pendingRef.current = true;
    setChatPending(true);
    setChatError("");
    setMessages(previous => appendOptimisticChatTurn(previous, failedTurn, retryIdentity,
      { id: userId, role: "user", text: prompt, blocks: attachment ? [{ type: "image", url: attachment.url, alt: attachment.name }] : [] },
      { id: assistantId, role: "assistant", text: t.generationRunning, status: "streaming" }));
    if (failedTurn?.identity === retryIdentity) failedOptimisticTurnRef.current = null;
    updateDraft("chat", "");
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
      const imageInput = { ...(initialConversationId ? { conversationId: initialConversationId } : { projectId: initialProjectId }),
        prompt, model: modelId, ...(assetId ? { referenceAssetIds: [assetId] } : {}) };
      const fingerprint = JSON.stringify(imageInput);
      const pendingKey = `ailoom.chatImagePending.${user.id}`;
      let previous = imageRequestRef.current;
      if (!previous) {
        try {
          const stored = JSON.parse(window.sessionStorage.getItem(pendingKey) ?? "null");
          if (stored && typeof stored.fingerprint === "string" && typeof stored.requestId === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored.requestId)) previous = stored;
        } catch { /* Invalid browser storage starts a fresh request. */ }
      }
      const requestId = previous?.fingerprint === fingerprint ? previous.requestId : crypto.randomUUID();
      imageRequestRef.current = { fingerprint, requestId };
      try { window.sessionStorage.setItem(pendingKey, JSON.stringify({ fingerprint, requestId })); }
      catch { /* In-page retries still reuse the request ID. */ }
      const statusUrl = `/api/chat/images?requestId=${encodeURIComponent(requestId)}`;
      let response: Response;
      try {
        response = await fetch("/api/chat/images", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...imageInput, requestId })
        });
      } catch {
        // A network interruption may happen after the paid provider accepted the request.
        // Inspect the same reservation before allowing a retry with this request ID.
        response = await fetch(statusUrl, { credentials: "same-origin", cache: "no-store" });
      }
      for (let poll = 0; response.status === 202 && poll < 40; poll++) {
        await new Promise(resolve => window.setTimeout(resolve, 3000));
        response = await fetch(statusUrl, { credentials: "same-origin", cache: "no-store" });
      }
      if (response.status === 202) throw new Error(locale === "fa"
        ? "درخواست هنوز در حال پردازش است. دوباره تلاش کن تا نتیجهٔ همان درخواست بررسی شود."
        : "The request is still processing. Retry to check this same request.");
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
      context.run(() => {
        setSelectedConversationId(conversationId);
        setMessages(previous => previous.map(item => item.id === userId
          ? { ...item, blocks: assetId ? [{ type: "image" as const, assetId, alt: attachment?.name }] : [] }
          : item.id === assistantId ? assistant : item));
        setAttachment(null);
      });
      imageRequestRef.current = null;
      try { window.sessionStorage.removeItem(pendingKey); } catch { /* Storage can be unavailable. */ }
      void refreshConversations();
    } catch (error) {
      context.run(() => {
        setMessages(previous => previous.filter(item => item.id !== assistantId).map(item => item.id === userId ? { ...item, status: "error" } : item));
        failedOptimisticTurnRef.current = { id: userId, identity: retryIdentity };
        setChatError(error instanceof Error ? error.message : t.generationFailed);
        setDrafts(previous => previous.chat ? previous : { ...previous, chat: prompt });
      });
    } finally {
      pendingRef.current = false;
      setChatPending(false);
    }
  };

  const sendChat = async () => {
    if (chatMode === "image") { await sendChatImage(); return; }
    if (pendingRef.current || messagesLoading || conversationLoadAbortRef.current) return;
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
    const initialProjectId = selectedProjectId;
    const retryIdentity = JSON.stringify(["text", message, models.chat, webSearch, specialistId, attachment?.url ?? null]);
    const failedTurn = failedOptimisticTurnRef.current;
    const context = captureChatContext(() => conversationLoadEpochRef.current);
    pendingRef.current = true;
    setChatPending(true);
    setChatError("");
    setMessages(previous => appendOptimisticChatTurn(previous, failedTurn, retryIdentity,
      { id: userId, role: "user", text: message, blocks: attachment ? [{ type: attachment.mime === "application/pdf" ? "file" : "image", url: attachment.url, alt: attachment.name }] : [] },
      { id: assistantId, role: "assistant", text: "", status: "streaming" }));
    if (failedTurn?.identity === retryIdentity) failedOptimisticTurnRef.current = null;
    updateDraft("chat", "");
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
      const candidate: ChatTurnInput = {
        ...(initialConversationId ? { conversationId: initialConversationId } : { projectId: initialProjectId }),
        text: message, model: chatModels.some(item => item.id === models.chat) ? models.chat : "openrouter/auto",
        webSearch, ...(assetId ? { attachmentIds: [assetId] } : {}),
        ...(!initialConversationId && specialistId ? { specialistId } : {})
      };
      const pendingKey = `ailoom.chatTextPending.${user.id}`;
      const savePending = (record: PendingChatTurn) => {
        textRequestRef.current = record;
        try { window.sessionStorage.setItem(pendingKey, JSON.stringify(record)); }
        catch { /* In-page retries still reuse the request ID. */ }
      };
      const clearPending = () => {
        textRequestRef.current = null;
        try { window.sessionStorage.removeItem(pendingKey); }
        catch { /* In-memory state is already cleared. */ }
      };
      const restoreConversation = async (conversationId: string, clearDraft: boolean) => {
        const saved = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
          credentials: "same-origin", cache: "no-store"
        });
        if (!saved.ok) throw new Error(await responseError(saved));
        const body = await saved.json();
        context.run(() => {
          setSelectedConversationId(conversationId);
          setSelectedProjectId(typeof body?.conversation?.projectId === "string" ? body.conversation.projectId : null);
          const page = messagesFromPayload(body);
          setMessages(page);
          setHasOlderMessages(page.length === 100);
          if (clearDraft) setAttachment(null);
          setSpecialistId(null);
        });
        clearPending();
        void refreshConversations();
      };
      const refreshCurrentConversation = async (conversationId: string) => {
        const saved = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
          credentials: "same-origin", cache: "no-store"
        });
        if (!saved.ok) throw new Error(await responseError(saved));
        const persisted = messagesFromPayload(await saved.json());
        context.run(() => setMessages(current => [...persisted,
          ...current.filter(item => item.id === userId || item.id === assistantId)]));
      };
      const inspectPending = async (record: PendingChatTurn, sameTurn: boolean): Promise<"missing" | "replayed" | "continue"> => {
        for (let poll = 0; poll <= 8; poll++) {
          const check = await fetch(`/api/chat?requestId=${encodeURIComponent(record.requestId)}`, {
            credentials: "same-origin", cache: "no-store"
          });
          if (check.status === 404) return "missing";
          if (!check.ok) throw new Error(await responseError(check));
          const state = await check.json();
          if (state?.status === "completed" && typeof state.conversationId === "string") {
            return reconcileCompletedChatTurn(state.conversationId, sameTurn, initialConversationId, {
              restoreOriginal: id => restoreConversation(id, true),
              refreshCurrent: refreshCurrentConversation,
              clearPending,
              refreshHistory: () => { void refreshConversations(); }
            });
          }
          if (state?.status === "uncertain" || state?.status === "failed") {
            setChatNeedsDecision(true);
            throw new Error(locale === "fa"
              ? "وضعیت درخواست قبلی نامشخص یا ناموفق است؛ Ailoom آن را دوباره با هزینهٔ تازه اجرا نمی‌کند."
              : "The previous request is uncertain or failed. Ailoom will not repeat the paid call automatically.");
          }
          if (state?.status !== "processing") throw new Error(t.sendError);
          if (poll === 8) break;
          await new Promise(resolve => window.setTimeout(resolve, 2000));
        }
        throw new Error(locale === "fa"
          ? "پاسخ هنوز در حال پردازش است. دوباره تلاش کن تا همین درخواست بررسی شود."
          : "The response is still processing. Retry to check this same request.");
      };
      let pending = textRequestRef.current;
      if (!pending) {
        try { pending = parsePendingChatTurn(window.sessionStorage.getItem(pendingKey)); }
        catch { /* Browser storage can be unavailable. */ }
      }
      if (pending) {
        const sameTurn = samePendingTurn(pending, candidate, initialConversationId, initialProjectId);
        const result = await inspectPending(pending, sameTurn);
        if (result === "replayed") return;
        if (result === "continue") pending = null;
        else if (!sameTurn) { clearPending(); pending = null; }
      }
      if (!pending || !samePendingTurn(pending, candidate, initialConversationId, initialProjectId)) {
        pending = { input: candidate, requestId: crypto.randomUUID() };
      }
      savePending(pending);
      let response: Response;
      try {
        response = await fetch("/api/chat", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...pending.input, requestId: pending.requestId })
        });
      } catch (error) {
        const result = await inspectPending(pending, true);
        if (result === "replayed") return;
        throw error;
      }
      if (!response.headers.get("Content-Type")?.includes("text/event-stream")) {
        const result = await inspectPending(pending, true);
        if (result === "replayed") return;
        throw new Error(response.ok ? t.sendError : await responseError(response));
      }
      try {
        await readChatStream(response, event => {
          if (event.type === "start" && event.conversationId) {
            savePending({ ...pending, resultConversationId: event.conversationId });
            context.run(() => setSelectedConversationId(event.conversationId));
          }
          if (event.type === "delta") context.run(() => setMessages(previous => previous.map(item => item.id === assistantId ? { ...item, text: item.text + event.text } : item)));
          if (event.type === "sources") context.run(() => setMessages(previous => previous.map(item => item.id === assistantId ? { ...item, blocks: [...(item.blocks?.filter(block => block.type !== "sources") ?? []), { type: "sources", sources: event.sources }] } : item)));
          if (event.type === "done") context.run(() => setMessages(previous => previous.map(item => item.id === assistantId ? { ...item, id: event.messageId || assistantId, status: undefined } : item)));
        });
      } catch (error) {
        const result = await inspectPending(textRequestRef.current ?? pending, true);
        if (result === "replayed") return;
        throw error;
      }
      clearPending();
      setChatNeedsDecision(false);
      context.run(() => {
        if (assetId) setMessages(previous => previous.map(item => item.id === userId ? { ...item, blocks: [{ type: attachment?.mime === "application/pdf" ? "file" : "image", assetId, alt: attachment?.name }] } : item));
        setAttachment(null);
        setSpecialistId(null);
      });
      void refreshConversations();
    } catch (error) {
      context.run(() => {
        setMessages(previous => previous.filter(item => item.id !== assistantId).map(item => item.id === userId ? { ...item, status: "error" } : item));
        failedOptimisticTurnRef.current = { id: userId, identity: retryIdentity };
        setChatError(error instanceof Error ? error.message : t.sendError);
        setDrafts(previous => previous.chat ? previous : { ...previous, chat: message });
      });
    } finally {
      pendingRef.current = false;
      setChatPending(false);
    }
  };

  const startSeparateTextRequest = () => {
    if (!user || pendingRef.current) return;
    let pending = textRequestRef.current;
    if (!pending) {
      try { pending = parsePendingChatTurn(window.sessionStorage.getItem(`ailoom.chatTextPending.${user.id}`)); }
      catch { /* Browser storage can be unavailable. */ }
    }
    if (pending) {
      setChatPreviousRequestId(pending.requestId);
      try {
        window.sessionStorage.setItem(`ailoom.chatTextPrevious.${user.id}`, pending.requestId);
        window.sessionStorage.removeItem(`ailoom.chatTextPending.${user.id}`);
      } catch { /* The server still retains the owner-scoped request status. */ }
    }
    textRequestRef.current = null;
    setChatNeedsDecision(false);
    setChatError("");
    promptRef.current?.focus();
  };

  const changeChatMode = (mode: "text" | "image") => {
    setChatMode(mode);
    if (mode === "image" && attachment?.mime === "application/pdf") setAttachment(null);
  };

  const clearPrivateWorkspace = () => {
    historyRequestEpochRef.current++;
    conversationLoadEpochRef.current++;
    conversationLoadAbortRef.current?.abort();
    conversationLoadAbortRef.current = null;
    if (user) {
      try { window.sessionStorage.removeItem(`ailoom.chatImagePending.${user.id}`); }
      catch { /* Private browsing can disable storage. */ }
      try { window.sessionStorage.removeItem(`ailoom.chatTextPending.${user.id}`); }
      catch { /* Private browsing can disable storage. */ }
      try { window.sessionStorage.removeItem(`ailoom.chatTextPrevious.${user.id}`); }
      catch { /* Private browsing can disable storage. */ }
      for (const target of mediaViews) {
        try { window.sessionStorage.removeItem(`ailoom.mediaPending.${user.id}.${target}`); }
        catch { /* Private browsing can disable storage. */ }
      }
    }
    setDrafts(emptyDrafts());
    setDraftsUserId(null);
    setAttachment(null);
    setPreview(null);
    setMediaJobs({});
    setMediaErrors({});
    setMediaSubmitting({});
    mediaSubmittingRef.current = {};
    upscaleSubmissionRef.current = null;
    inpaintSubmissionRef.current = null;
    characterSubmissionRef.current = null;
    inpaintMaskUploadRef.current = null;
    musicSubmissionRef.current = null;
    firstLastSubmissionRef.current = null;
    lastFrameUploadRef.current = null;
    repairSubmissionRef.current = null;
    genericSubmissionRef.current = {};
    setConversations([]);
    setHasMoreConversations(false);
    setHistoryLoadingMore(false);
    setProjects([]);
    setSelectedProjectId(null);
    setProjectBusy(false);
    setProjectError("");
    imageRequestRef.current = null;
    textRequestRef.current = null;
    failedOptimisticTurnRef.current = null;
    setHistoryLoading(false);
    setSelectedConversationId(null);
    setMessages([]);
    setHasOlderMessages(false);
    setOlderMessagesLoading(false);
    setMessagesLoading(false);
    setChatPending(false);
    setChatError("");
    setChatNeedsDecision(false);
    setChatPreviousRequestId(null);
    setSpecialistId(null);
    setChatMode("text");
    setWebSearch(false);
    setLoginDraft("");
    pendingRef.current = false;
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
      authEpochRef.current += 1;
      const switchingAccount = Boolean(user && user.id !== nextUser.id);
      const saved = loadUserDrafts(nextUser.id);
      if (switchingAccount) {
        try { clearStoredDrafts(window.localStorage); }
        catch { /* Private browsing can disable storage. */ }
        clearPrivateWorkspace();
      }
      setDrafts(switchingAccount ? saved : { ...saved, ...Object.fromEntries(views.map(view =>
        [view, drafts[view] || saved[view]])) });
      setDraftsUserId(nextUser.id);
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
      authEpochRef.current += 1;
      try {
        clearStoredDrafts(window.localStorage);
        if (user) window.localStorage.removeItem(`ailoom.explore.run.v1.${user.id}`);
        window.localStorage.removeItem("ailoom.models");
        window.localStorage.removeItem("ailoom.imageChatModel");
      }
      catch { /* Private browsing can disable storage. */ }
      clearPrivateWorkspace();
      setModels(defaultModels);
      setImageChatModel("google/gemini-3.1-flash-image");
      setUser(null);
      // Reload drops any in-flight chat or media callbacks that could repopulate
      // the previous account's state after its session cookie is removed.
      window.location.replace("/");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.sessionError);
    }
  };

  const startNewUncertainGeneration = (target: MediaView) => {
    const current = genericSubmissionRef.current[target];
    if (!user || !uncertainGenerationMatches(mediaJobs[target], current)) return;
    delete genericSubmissionRef.current[target];
    try { window.sessionStorage.removeItem(`ailoom.mediaPending.${user.id}.${target}`); }
    catch { /* The in-memory key has already been cleared. */ }
    setMediaErrors(previous => ({ ...previous, [target]: "" }));
    setNotice(locale === "fa"
      ? "درخواست تازه آماده است. زدن «تولید» ممکن است هزینهٔ جداگانه داشته باشد."
      : "A new request is ready. Pressing Generate may incur another charge.");
  };

  const startGeneration = async (target: MediaView, options: StudioRequestOptions) => {
    const imageEdit = target === "image" && options.modeIndex === 1;
    const imageUpscale = target === "image" && options.modeIndex === 2;
    const imageInpaint = target === "image" && options.modeIndex === 3;
    const imageCharacter = target === "image" && options.modeIndex === 4;
    const referenceVideo = target === "video" && options.modeIndex === 1;
    const videoRepair = target === "video" && options.modeIndex === 2;
    const firstLastVideo = target === "video" && options.modeIndex === 3;
    const musicGeneration = target === "audio" && options.modeIndex === 1;
    const textGeneration = options.modeIndex === 0 || musicGeneration;
    if (imageUpscale && mediaJobs.image && ["queued", "submitting", "running"].includes(mediaJobs.image.state)) return;
    if (imageInpaint && mediaJobs.image && ["queued", "submitting", "running"].includes(mediaJobs.image.state)) return;
    if (imageCharacter && mediaJobs.image && ["queued", "submitting", "running"].includes(mediaJobs.image.state)) return;
    if (target === "audio" && mediaJobs.audio && ["queued", "submitting", "running"].includes(mediaJobs.audio.state)) return;
    if ((!imageEdit && !imageUpscale && !imageInpaint && !imageCharacter && !referenceVideo && !videoRepair && !firstLastVideo && !textGeneration) || (textGeneration && preview) || ((imageEdit || imageUpscale || imageInpaint || imageCharacter || referenceVideo || videoRepair || firstLastVideo) && !preview) || (firstLastVideo && !options.lastFrame) || (imageInpaint && !options.maskFile)) {
      setMediaErrors(previous => ({ ...previous, [target]: t.unsupportedOperation }));
      return;
    }
    if (!user) { openLogin(drafts[target], target); return; }
    const prompt = drafts[target].trim();
    if (!prompt && !imageUpscale) return;
    const chosenMediaModel = mediaModels.find(item => item.id === options.modelId);
    const operation = imageUpscale ? "image_upscale" : imageInpaint ? "image_inpaint" : imageCharacter ? "character_to_image" : imageEdit ? "image_edit" : referenceVideo ? chosenMediaModel?.operations.includes("image_to_video") ? "image_to_video" : "reference_to_video" : videoRepair ? "temporal_inpaint" : firstLastVideo ? "first_last_frame_to_video" : target === "image" ? "text_to_image" : target === "video" ? "text_to_video" : musicGeneration ? "text_to_music" : "text_to_speech";
    const supported = mediaModels.length ? mediaModels.some(item => item.id === options.modelId && item.operations.includes(operation))
      : modelOptions[target].some(item => item.id === options.modelId);
    if (!supported && !videoRepair) {
      setMediaErrors(previous => ({ ...previous, [target]: t.generationNotReady }));
      return;
    }
    let payload: Record<string, unknown>;
    if (imageEdit || imageUpscale || imageInpaint || imageCharacter || referenceVideo || videoRepair || firstLastVideo) {
      payload = {};
    } else if (target === "image") {
      payload = { modelId: options.modelId, operation: "text_to_image", prompt };
      if (chosenMediaModel?.provider === "fal" || options.modelId === "fal-ai/flux-2-pro") {
        const imageSizes: Record<string, string> = {
          "16:9": "landscape_16_9", "9:16": "portrait_16_9",
          "4:3": "landscape_4_3", "1:1": options.quality === "high" ? "square_hd" : "square"
        };
        payload.imageSize = imageSizes[options.aspect] ?? "landscape_16_9";
        if (options.modelId.startsWith("openai/gpt-image-2.5/")) {
          payload.quality = options.quality === "high" ? "high" : "medium";
        }
      } else if (chosenMediaModel?.provider === "wavespeed" && chosenMediaModel.operations.includes("text_to_image") ||
        options.modelId === "wavespeed-ai/z-image/turbo") {
        const high = options.quality === "high";
        const dimensions: Record<string, [number, number]> = high
          ? { "16:9": [1536, 864], "9:16": [864, 1536], "4:3": [1536, 1152], "1:1": [1536, 1536] }
          : { "16:9": [1024, 576], "9:16": [576, 1024], "4:3": [1024, 768], "1:1": [1024, 1024] };
        const [width, height] = dimensions[options.aspect] ?? dimensions["16:9"];
        payload.width = width;
        payload.height = height;
      } else if (options.modelId.startsWith("google/imagen4")) {
        payload.aspectRatio = ["16:9", "1:1", "4:3", "9:16"].includes(options.aspect) ? options.aspect : "16:9";
      }
    } else if (target === "video") {
      if (options.modelId === "bytedance/seedance-2.5/text-to-video") {
        payload = { modelId: options.modelId, operation: "text_to_video", prompt,
          durationSec: options.duration === "auto" ? "auto" : Math.max(4, Math.min(30, options.duration)),
          aspectRatio: ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(options.aspect) ? options.aspect : "16:9",
          resolution: options.quality === "low" ? "480p" : options.quality === "high" ? "1080p" : "720p",
          audio: options.audio };
      } else if (options.modelId === "bytedance/seedance-2-5") {
        payload = { modelId: options.modelId, operation: "text_to_video", prompt };
      } else if (options.modelId === "kling-3.0/video") {
        payload = { modelId: options.modelId, operation: "text_to_video", prompt,
          durationSec: typeof options.duration === "number" ? Math.max(3, Math.min(15, options.duration)) : 5,
          aspectRatio: ["16:9", "9:16", "1:1"].includes(options.aspect) ? options.aspect : "16:9",
          audio: options.audio, mode: options.quality === "ultra" ? "4K" : options.quality === "high" ? "pro" : "std" };
      } else if (options.modelId === "fal-ai/kling-video/v3/standard/text-to-video") {
        payload = { modelId: options.modelId, operation: "text_to_video", prompt,
          durationSec: typeof options.duration === "number" ? Math.max(3, Math.min(15, options.duration)) : 5,
          aspectRatio: ["16:9", "9:16", "1:1"].includes(options.aspect) ? options.aspect : "16:9",
          audio: options.audio };
      } else if (options.modelId === "fal-ai/kling-video/v3/turbo/standard/text-to-video") {
        payload = { modelId: options.modelId, operation: "text_to_video", prompt,
          durationSec: typeof options.duration === "number" ? Math.max(3, Math.min(15, options.duration)) : 5,
          aspectRatio: ["16:9", "9:16", "1:1"].includes(options.aspect) ? options.aspect : "16:9" };
      } else if (options.modelId === "fal-ai/minimax/hailuo-2.3/standard/text-to-video") {
        payload = { modelId: options.modelId, operation: "text_to_video", prompt,
          durationSec: options.duration === 10 ? 10 : 6, promptOptimizer: options.promptOptimizer };
      } else if (options.modelId === "fal-ai/luma-dream-machine/ray-2-flash") {
        payload = { modelId: options.modelId, operation: "text_to_video", prompt,
          durationSec: options.duration === 9 ? 9 : 5,
          aspectRatio: ["16:9", "9:16", "4:3", "3:4", "21:9", "9:21"].includes(options.aspect) ? options.aspect : "16:9",
          resolution: options.quality === "high" ? "1080p" : options.quality === "standard" ? "720p" : "540p",
          loop: options.loop };
      } else if (options.modelId === "fal-ai/veo3.1") {
        payload = { modelId: options.modelId, operation: "text_to_video", prompt,
          durationSec: typeof options.duration === "number" && [4, 6, 8].includes(options.duration) ? options.duration : 8,
          aspectRatio: options.aspect === "9:16" ? "9:16" : "16:9",
          resolution: options.quality === "ultra" ? "4k" : options.quality === "high" ? "1080p" : "720p",
          audio: options.audio };
      } else if (options.modelId === "fal-ai/wan/v2.7/text-to-video") {
        payload = { modelId: options.modelId, operation: "text_to_video", prompt,
          durationSec: typeof options.duration === "number" ? Math.max(2, Math.min(15, options.duration)) : 5,
          aspectRatio: ["16:9", "9:16", "1:1", "4:3", "3:4"].includes(options.aspect) ? options.aspect : "16:9",
          resolution: options.quality === "high" ? "1080p" : "720p" };
      } else {
        payload = { modelId: options.modelId, operation: "text_to_video", prompt,
          durationSec: typeof options.duration === "number" && [4, 6, 8].includes(options.duration) ? options.duration : 8,
          aspectRatio: options.aspect === "9:16" ? "9:16" : "16:9",
          resolution: options.quality === "high" ? "1080p" : "720p", audio: options.audio };
      }
    } else if (musicGeneration) {
      payload = { modelId: options.modelId, operation: "text_to_music", prompt,
        durationSec: options.musicDurationSec,
        ...(["elevenlabs/music/v2", "elevenlabs/music/v2.5"].includes(options.modelId) ? { forceInstrumental: options.forceInstrumental } : {}) };
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
      const sourceAssetIds: string[] = [];
      let upscaleKey: string | null = null;
      let inpaintKey: string | null = null;
      let characterKey: string | null = null;
      let musicKey: string | null = null;
      let firstLastKey: string | null = null;
      let repairKey: string | null = null;
      if (imageEdit || imageUpscale || imageInpaint || imageCharacter || referenceVideo || videoRepair || firstLastVideo) {
        const source = preview?.file;
        if (!source && !preview?.assetId) throw new Error(t.unsupportedOperation);
        if (imageInpaint && (!usableReference(preview, ["image/png", "image/jpeg"], 8_000_000) ||
          !options.maskFile || options.maskFile.type !== "image/png" || options.maskFile.size === 0 || options.maskFile.size > 8_000_000)) throw new Error(t.inpaintInvalid);
        if (imageCharacter && !usableReference(preview, ["image/png", "image/jpeg", "image/webp"], 10_000_000)) throw new Error(t.characterInvalid);
        if ((imageEdit || imageUpscale || referenceVideo || firstLastVideo) && !usableReference(preview, ["image/png", "image/jpeg", "image/webp"])) throw new Error(imageUpscale ? t.upscaleUnsupportedFile : t.unsupportedOperation);
        if (firstLastVideo && (!usableReference(preview, ["image/png", "image/jpeg", "image/webp"], 8_000_000) || !options.lastFrame ||
          options.lastFrame.size === 0 || options.lastFrame.size > 8_000_000 ||
          !["image/png", "image/jpeg", "image/webp"].includes(options.lastFrame.type))) throw new Error(t.firstLastTooLarge);
        if (videoRepair && !usableReference(preview, ["video/mp4", "video/webm"])) throw new Error(t.unsupportedOperation);
        let sourceAssetId = preview?.assetId;
        if (!sourceAssetId) {
          if (!source) throw new Error(t.unsupportedOperation);
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
        sourceAssetIds.push(sourceAssetId);
        if (imageCharacter) {
          const sizes: Record<string, string> = { "16:9": "landscape_16_9", "9:16": "portrait_16_9",
            "4:3": "landscape_4_3", "1:1": "square_hd" };
          const imageSize = sizes[options.aspect] ?? "landscape_16_9";
          const renderingSpeed = options.quality === "high" ? "QUALITY" : "BALANCED";
          endpoint = "/api/image/character";
          payload = { sourceAssetId, prompt, imageSize, renderingSpeed };
           const identity = JSON.stringify([sourceAssetId, prompt, imageSize, renderingSpeed, mediaProjectId]);
          const previous = characterSubmissionRef.current;
          characterKey = previous?.identity === identity ? previous.key : crypto.randomUUID();
          characterSubmissionRef.current = { identity, key: characterKey };
        } else if (imageInpaint) {
          const previousMask = inpaintMaskUploadRef.current;
          let maskAssetId = previousMask && previousMask.file === options.maskFile ? previousMask.assetId : null;
          if (!maskAssetId) {
            const maskData = new FormData();
            maskData.append("file", options.maskFile!);
            const maskUpload = await fetch("/api/assets", { method: "POST", credentials: "same-origin", body: maskData });
            if (!maskUpload.ok) throw new Error(await responseError(maskUpload));
            const maskBody = await maskUpload.json();
            maskAssetId = typeof maskBody?.asset?.id === "string" ? maskBody.asset.id : null;
            if (!maskAssetId) throw new Error(t.attachmentUnavailable);
            inpaintMaskUploadRef.current = { file: options.maskFile!, assetId: maskAssetId };
          }
          endpoint = "/api/image/inpaint";
          payload = { sourceAssetId, maskAssetId, prompt };
           const identity = JSON.stringify([sourceAssetId, maskAssetId, prompt, mediaProjectId]);
          const previous = inpaintSubmissionRef.current;
          inpaintKey = previous?.identity === identity ? previous.key : crypto.randomUUID();
          inpaintSubmissionRef.current = { identity, key: inpaintKey };
        } else if (imageEdit || imageUpscale || referenceVideo || firstLastVideo) {
          const access = await fetch(`/api/assets/${encodeURIComponent(sourceAssetId)}`, { method: "POST", credentials: "same-origin" });
          if (!access.ok) throw new Error(await responseError(access));
          const signed = await access.json();
          if (typeof signed?.url !== "string" || !signed.url.startsWith("https://")) throw new Error(t.unsupportedOperation);
          if (imageUpscale) {
            payload = upscaleRequest(signed.url, options.upscale);
            const identity = upscaleRequestIdentity(sourceAssetId, options.upscale);
            const previous = upscaleSubmissionRef.current;
            upscaleKey = previous?.identity === identity ? previous.key : crypto.randomUUID();
            upscaleSubmissionRef.current = { identity, key: upscaleKey };
          } else if (imageEdit) {
            const sizes: Record<string, string> = { "16:9": "landscape_16_9", "9:16": "portrait_16_9", "4:3": "landscape_4_3", "1:1": options.quality === "high" ? "square_hd" : "square" };
            payload = { modelId: options.modelId, operation: "image_edit", prompt,
              imageUrl: signed.url, imageSize: sizes[options.aspect] ?? "landscape_16_9" };
            if (options.modelId.startsWith("openai/gpt-image-2.5/")) {
              payload.quality = options.quality === "high" ? "high" : "medium";
            }
          } else if (firstLastVideo) {
            const cachedLastFrame = lastFrameUploadRef.current;
            let lastAssetId = cachedLastFrame && cachedLastFrame.file === options.lastFrame ? cachedLastFrame.assetId : null;
            if (!lastAssetId) {
              const lastData = new FormData();
              lastData.append("file", options.lastFrame!);
              const lastUpload = await fetch("/api/assets", { method: "POST", credentials: "same-origin", body: lastData });
              if (!lastUpload.ok) throw new Error(await responseError(lastUpload));
              const lastBody = await lastUpload.json();
              lastAssetId = typeof lastBody?.asset?.id === "string" ? lastBody.asset.id : null;
              if (!lastAssetId) throw new Error(t.attachmentUnavailable);
              lastFrameUploadRef.current = { file: options.lastFrame!, assetId: lastAssetId };
            }
            sourceAssetIds.push(lastAssetId);
            const lastAccess = await fetch(`/api/assets/${encodeURIComponent(lastAssetId)}`, { method: "POST", credentials: "same-origin" });
            if (!lastAccess.ok) throw new Error(await responseError(lastAccess));
            const lastSigned = await lastAccess.json();
            if (typeof lastSigned?.url !== "string" || !lastSigned.url.startsWith("https://")) throw new Error(t.unsupportedOperation);
            const controls: FirstLastControls = { prompt,
              durationSec: options.duration === 4 || options.duration === 6 ? options.duration : 8,
              aspectRatio: options.aspect === "9:16" ? "9:16" : "16:9",
              resolution: options.quality === "high" ? "1080p" : "720p", audio: options.audio };
            payload = { modelId: options.modelId, operation: "first_last_frame_to_video",
              ...controls, firstFrameUrl: signed.url, lastFrameUrl: lastSigned.url };
            const identity = firstLastRequestIdentity(sourceAssetId, lastAssetId, controls);
            const previous = firstLastSubmissionRef.current;
            firstLastKey = previous?.identity === identity ? previous.key : crypto.randomUUID();
            firstLastSubmissionRef.current = { identity, key: firstLastKey };
          } else if (options.modelId === "fal-ai/veo3.1/fast/image-to-video") {
            payload = { modelId: options.modelId, operation: "image_to_video", prompt, imageUrl: signed.url,
              durationSec: typeof options.duration === "number" && [4, 6, 8].includes(options.duration) ? options.duration : 8,
              aspectRatio: options.aspect === "9:16" ? "9:16" : "16:9",
              resolution: options.quality === "high" ? "1080p" : "720p", audio: options.audio };
          } else if (options.modelId === "kling-3.0/video") {
            payload = { modelId: options.modelId, operation: "image_to_video", prompt, imageUrl: signed.url,
              durationSec: typeof options.duration === "number" ? Math.max(3, Math.min(15, options.duration)) : 5,
              audio: options.audio, mode: options.quality === "ultra" ? "4K" : options.quality === "high" ? "pro" : "std" };
          } else if (options.modelId === "fal-ai/kling-video/v3/standard/image-to-video") {
            payload = { modelId: options.modelId, operation: "image_to_video", prompt, imageUrl: signed.url,
              durationSec: typeof options.duration === "number" ? Math.max(3, Math.min(15, options.duration)) : 5,
              audio: options.audio };
          } else if (options.modelId === "fal-ai/minimax/hailuo-2.3/standard/image-to-video") {
            payload = { modelId: options.modelId, operation: "image_to_video", prompt, imageUrl: signed.url,
              durationSec: options.duration === 10 ? 10 : 6, promptOptimizer: options.promptOptimizer };
          } else if (options.modelId === "fal-ai/wan/v2.7/image-to-video") {
            payload = { modelId: options.modelId, operation: "image_to_video", prompt, imageUrl: signed.url,
              durationSec: typeof options.duration === "number" ? Math.max(2, Math.min(15, options.duration)) : 5,
              resolution: options.quality === "high" ? "1080p" : "720p" };
          } else if (options.modelId === "wavespeed-ai/open-video/image-to-video") {
            payload = { modelId: options.modelId, operation: "image_to_video", prompt, imageUrl: signed.url,
              durationSec: typeof options.duration === "number" ? Math.max(3, Math.min(20, options.duration)) : 5,
              resolution: options.quality === "low" ? "480p" : options.quality === "high" ? "1080p" : "720p" };
          } else if (options.modelId === "fal-ai/wan/v2.7/reference-to-video") {
            payload = { modelId: options.modelId, operation: "reference_to_video", prompt, imageUrls: [signed.url],
              durationSec: typeof options.duration === "number" ? Math.max(2, Math.min(10, options.duration)) : 5,
              aspectRatio: ["16:9", "9:16", "1:1", "4:3", "3:4"].includes(options.aspect) ? options.aspect : "16:9",
              resolution: options.quality === "high" ? "1080p" : "720p" };
          } else {
            payload = { modelId: options.modelId, operation: "reference_to_video", prompt,
              imageUrls: [signed.url], durationSec: options.duration === "auto" ? "auto" : Math.max(4, Math.min(30, options.duration)),
              aspectRatio: ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(options.aspect) ? options.aspect : "16:9",
              resolution: options.quality === "low" ? "480p" : options.quality === "high" ? "1080p" : "720p",
              audio: options.audio };
          }
        } else {
          endpoint = "/api/video/repair";
          payload = { sourceAssetId, startSec: options.repairStart, endSec: options.repairEnd, prompt };
           const identity = JSON.stringify([repairRequestIdentity(sourceAssetId, options.repairStart, options.repairEnd, prompt), mediaProjectId]);
          const previous = repairSubmissionRef.current;
          repairKey = previous?.identity === identity ? previous.key : crypto.randomUUID();
          repairSubmissionRef.current = { identity, key: repairKey };
        }
      }
      payload = { ...payload, ...(mediaProjectId ? { projectId: mediaProjectId } : {}) };
      if (musicGeneration) {
        const identity = JSON.stringify([user.id, payload]);
        const previous = musicSubmissionRef.current;
        musicKey = previous?.identity === identity ? previous.key : crypto.randomUUID();
        musicSubmissionRef.current = { identity, key: musicKey };
      }
      let genericKey: string | null = null;
      if (endpoint === "/api/generations") {
        const identity = generationRequestIdentity(endpoint, payload, sourceAssetIds);
        const storageKey = `ailoom.mediaPending.${user.id}.${target}`;
        let previous = genericSubmissionRef.current[target];
        if (previous?.identity !== identity) {
          try { previous = parsePendingGeneration(window.sessionStorage.getItem(storageKey), identity) ?? undefined; }
          catch { previous = undefined; }
        }
        if (uncertainGenerationMatches(mediaJobs[target], previous, identity))
          throw new Error(uncertainGenerationMessage(locale));
        genericKey = previous?.key ?? crypto.randomUUID();
        genericSubmissionRef.current[target] = { identity, key: genericKey };
        try { window.sessionStorage.setItem(storageKey, JSON.stringify({ identity, key: genericKey })); }
        catch { /* In-page retries still reuse the request key. */ }
      }
      const requestKey = genericKey || upscaleKey || inpaintKey || characterKey || musicKey || firstLastKey || repairKey;
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json", ...(requestKey ? { "Idempotency-Key": requestKey } : {}) },
          body: JSON.stringify(payload)
        });
      } catch (error) {
        if (!genericKey) throw error;
        const check = await fetch(`/api/generations/${encodeURIComponent(genericKey)}`, { credentials: "same-origin", cache: "no-store" });
        if (!check.ok) throw error;
        response = check;
      }
      if (response.status >= 500 && genericKey) {
        const check = await fetch(`/api/generations/${encodeURIComponent(genericKey)}`, { credentials: "same-origin", cache: "no-store" }).catch(() => null);
        if (check?.ok) response = check;
      }
      if (!response.ok) {
        if (genericKey && response.status < 500) {
          delete genericSubmissionRef.current[target];
          try { window.sessionStorage.removeItem(`ailoom.mediaPending.${user.id}.${target}`); }
          catch { /* In-memory state is already cleared. */ }
        }
        throw new Error(await responseError(response));
      }
      const job = mediaJobFromPayload(await response.json());
      if (!job) throw new Error(t.generationNotReady);
      setMediaJobs(previous => ({ ...previous, [target]: job }));
      if (imageUpscale) upscaleSubmissionRef.current = null;
      if (imageInpaint) { inpaintSubmissionRef.current = null; inpaintMaskUploadRef.current = null; }
      if (imageCharacter) characterSubmissionRef.current = null;
      if (musicGeneration) musicSubmissionRef.current = null;
      if (firstLastVideo) { firstLastSubmissionRef.current = null; lastFrameUploadRef.current = null; }
      if (videoRepair) repairSubmissionRef.current = null;
      if (imageEdit || imageUpscale || imageInpaint || referenceVideo || videoRepair || firstLastVideo) setPreview(null);
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
          ? <ChatWorkspace locale={locale} user={user} conversations={conversations} historyLoading={historyLoading} historyLoadingMore={historyLoadingMore} hasMoreConversations={hasMoreConversations} onLoadMoreConversations={() => void loadMoreConversations()} selectedId={selectedConversationId} projects={projects} selectedProjectId={selectedProjectId} projectBusy={projectBusy} projectError={projectError} onSelectProject={selectProject} onCreateProject={createChatProject} onUpdateProject={updateChatProject} onDeleteProject={deleteChatProject} onMoveConversation={moveConversation} messages={messages} messageLoading={messagesLoading} olderMessagesLoading={olderMessagesLoading} hasOlderMessages={hasOlderMessages} onLoadOlderMessages={() => void loadOlderMessages()} pending={chatPending} error={chatError} showSeparateRequest={chatNeedsDecision} previousRequestId={chatPreviousRequestId} onSeparateRequest={startSeparateTextRequest} prompt={drafts.chat} onPrompt={value => updateDraft("chat", value)} model={chatMode === "image" ? imageChatModel : models.chat} onModel={value => chatMode === "image" ? setImageChatModel(value) : updateModel("chat", value)} modelList={chatMode === "image" ? imageChatModels : chatModels} mode={chatMode} onMode={changeChatMode} webSearch={webSearch} onWebSearch={setWebSearch} onSend={() => void sendChat()} onSelect={id => void selectConversation(id)} onNew={newConversation} attachment={attachment} onAttach={event => onUpload(event, "chat")} onRemoveAttachment={() => setAttachment(null)} inputRef={promptRef} />
          : <ChatLanding locale={locale} prompt={drafts.chat} setPrompt={value => updateDraft("chat", value)} model={chatMode === "image" ? imageChatModel : models.chat} setModel={value => chatMode === "image" ? setImageChatModel(value) : updateModel("chat", value)} modelList={chatMode === "image" ? imageChatModels : chatModels} mode={chatMode} onMode={changeChatMode} webSearch={webSearch} onWebSearch={setWebSearch} onSubmit={() => void sendChat()} onNavigate={navigate} onStarter={useWorkflow} attachment={attachment} onAttach={event => onUpload(event, "chat")} onRemoveAttachment={() => setAttachment(null)} inputRef={promptRef} />)}
        {isMediaView(view) && <StudioPage key={`${view}-${studioMode}`} initialMode={studioMode} view={view} locale={locale} model={models[view]} onModel={value => updateModel(view, value)} draft={drafts[view]} onDraft={value => updateDraft(view, value)} onSubmit={options => void startGeneration(view, options)} preview={preview} onFile={event => onUpload(event, view)} onRemoveFile={() => setPreview(null)} onUseReference={setPreview} onLastFrameChange={() => { lastFrameUploadRef.current = null; firstLastSubmissionRef.current = null; }} availableModels={mediaModels.filter(item => item.outputKind === view)} catalogState={mediaCatalogState} onCatalogRetry={() => setMediaCatalogRevision(value => value + 1)} job={mediaJobs[view] ?? null} jobError={mediaErrors[view] ?? ""} uncertainRequestBlocked={uncertainGenerationMatches(mediaJobs[view], genericSubmissionRef.current[view])} onNewUncertainRequest={() => startNewUncertainGeneration(view)} busy={Boolean(mediaSubmitting[view])} signedIn={Boolean(user)} onLogin={() => openLogin("", view)} projects={projects} projectId={mediaProjectId} onProjectChange={setMediaProjectId} />}
        {view === "explore" && <ConnectedExplorePage locale={locale} user={user} onUse={useWorkflow} onLogin={() => openLogin()} />}
        {view === "specialists" && <ConnectedSpecialistsPage locale={locale} onAsk={askSpecialist} />}
      </main>
      <footer className="site-footer"><strong>Ailoom</strong><span>{t.privateWorkspace}</span></footer>
      {authOpen && <LoginDialog locale={locale} draft={loginDraft} inviteToken={inviteToken} busy={authBusy} error={authError} onClose={closeLogin} onAuthenticate={input => void authenticate(input)} closeRef={closeRef} />}
      {notice && <div className="toast" role="status" aria-live="polite">{notice}</div>}
    </>
  );
}
