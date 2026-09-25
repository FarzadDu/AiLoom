"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, Square } from "lucide-react";
import type { Locale } from "./workspace-data";

type State = "idle" | "starting" | "recording" | "transcribing";
const maxRecordingMs = 60_000;
const maxRecordingBytes = 15_000_000;

const labels = {
  en: {
    start: "Record voice; ElevenLabs will transcribe it",
    stop: "Stop recording",
    busy: "Transcribing voice…",
    recording: "Recording… Select the microphone again to stop. One minute maximum.",
    added: "Transcript added to your draft. Review it before sending.",
    unsupported: "This browser cannot record audio here.",
    failed: "Voice transcription failed. Check microphone access and provider credit, then try again."
  },
  fa: {
    start: "ضبط صدا؛ ElevenLabs آن را رونویسی می‌کند",
    stop: "پایان ضبط",
    busy: "در حال رونویسی صدا…",
    recording: "در حال ضبط… برای پایان دوباره میکروفون را بزن. حداکثر یک دقیقه.",
    added: "متن صدا به پیش‌نویس اضافه شد. پیش از ارسال آن را بررسی کن.",
    unsupported: "این مرورگر در این صفحه امکان ضبط صدا ندارد.",
    failed: "رونویسی صدا انجام نشد. دسترسی میکروفون و اعتبار سرویس را بررسی و دوباره تلاش کن."
  }
} as const;

function supportedMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]
    .find(type => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** Recording is user initiated; audio is sent to the authenticated ElevenLabs transcription route. */
export function ChatVoiceInput({ locale, disabled, onTranscript }: {
  locale: Locale; disabled: boolean; onTranscript: (text: string) => void;
}) {
  const [state, setState] = useState<State>("idle");
  const [notice, setNotice] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const transcriptRef = useRef(onTranscript);
  transcriptRef.current = onTranscript;
  const t = labels[locale];

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.onstop = null;
        if (recorder.state !== "inactive") recorder.stop();
      }
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  async function transcribe(blob: Blob, mime: string) {
    if (!mountedRef.current) return;
    if (blob.size < 100 || blob.size > maxRecordingBytes) {
      setNotice(t.failed); setState("idle"); return;
    }
    setState("transcribing");
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const form = new FormData();
      const extension = mime === "audio/mp4" ? "m4a" : mime === "audio/ogg" ? "ogg" : "webm";
      form.set("file", new File([blob], `voice-note.${extension}`, { type: mime }));
      const response = await fetch("/api/audio/transcribe", {
        method: "POST", credentials: "same-origin", body: form, signal: controller.signal
      });
      if (!response.ok) throw new Error("Transcription unavailable");
      const payload = await response.json() as { text?: unknown };
      if (typeof payload.text !== "string" || !payload.text.trim()) throw new Error("Empty transcript");
      if (!mountedRef.current) return;
      transcriptRef.current(payload.text.trim());
      setNotice(t.added);
    } catch {
      if (!controller.signal.aborted && mountedRef.current) setNotice(t.failed);
    } finally {
      if (mountedRef.current) setState("idle");
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  async function start() {
    setNotice("");
    const mime = supportedMime();
    if (!mime || !navigator.mediaDevices?.getUserMedia) {
      setNotice(t.unsupported); return;
    }
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];
      let recordingFailed = false;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { recordingFailed = true; setNotice(t.failed); };
      recorder.onstop = () => {
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = null;
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (!recordingFailed) void transcribe(new Blob(chunks, { type: mime }), mime.split(";", 1)[0]);
        else if (mountedRef.current) setState("idle");
      };
      recorder.start(1000);
      timerRef.current = window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, maxRecordingMs);
      setState("recording");
    } catch {
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      if (mountedRef.current) { setNotice(t.failed); setState("idle"); }
    }
  }

  function activate() {
    if (state === "recording") {
      setState("transcribing");
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    } else if (state === "idle" && !disabled) void start();
  }

  return <div className="chat-voice-wrap">
    <button type="button" className="chat-voice-mode" aria-label={state === "recording" ? t.stop : t.start}
      title={state === "recording" ? t.stop : t.start} aria-pressed={state === "recording"}
      disabled={(disabled && state !== "recording") || state === "starting" || state === "transcribing"} onClick={activate}>
      {state === "recording" ? <Square size={17} aria-hidden="true" /> :
        state === "starting" || state === "transcribing" ? <LoaderCircle size={18} aria-hidden="true" /> :
          <Mic size={18} aria-hidden="true" />}
    </button>
    {(state === "recording" || state === "transcribing" || notice) &&
      <span className="chat-voice-status" role="status">{state === "recording" ? t.recording :
        state === "transcribing" ? t.busy : notice}</span>}
  </div>;
}
