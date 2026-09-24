"use client";

import { ArrowRight, BookOpen, Check, Compass, Image as ImageIcon, MessageCircle, Plus, Stethoscope, Video, Volume2, X, type LucideIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { responseError, type SessionUser } from "./chat-api";
import { resolveTemplatePrompt, specialistsFromPayload, templateFromPayload, templatesFromPayload, type ExploreStep, type ExploreTemplate, type SpecialistProfile } from "./content-api";
import { copy, modelOptions, specialistCatalog, type Locale, type View } from "./workspace-data";

const stepIcons: Record<ExploreStep["kind"], LucideIcon> = {
  chat: MessageCircle, image: ImageIcon, video: Video, audio: Volume2
};

type TemplateDraft = {
  id: string | null;
  title: string;
  description: string;
  category: string;
  inputs: ExploreTemplate["definition"]["inputs"];
  steps: ExploreStep[];
};

function newStep(): ExploreStep {
  return { id: crypto.randomUUID(), title: "", kind: "chat", prompt: "" };
}

function newDraft(): TemplateDraft {
  return { id: null, title: "", description: "", category: "General", inputs: [], steps: [newStep()] };
}

function draftFromTemplate(template: ExploreTemplate): TemplateDraft {
  return { id: template.id, title: template.title, description: template.description,
    category: template.category, inputs: template.definition.inputs,
    steps: template.definition.steps.map(step => ({ ...step })) };
}

export function ExplorePage({ locale, user, onUse, onLogin }: {
  locale: Locale; user: SessionUser | null;
  onUse: (view: View, prompt: string, options?: { file?: File; modelId?: string }) => void; onLogin: () => void;
}) {
  const t = copy[locale];
  const [templates, setTemplates] = useState<ExploreTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [inputFiles, setInputFiles] = useState<Record<string, File>>({});
  const [inputError, setInputError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false);
    fetch("/api/explore", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(await responseError(response)); return response.json(); })
      .then(body => { setTemplates(templatesFromPayload(body)); setLoadError(""); })
      .catch(error => { if (controller.signal.aborted) return; setLoadError(error instanceof Error ? error.message : t.exploreLoadError); })
      .finally(() => { if (!controller.signal.aborted) setLoaded(true); });
    return () => controller.abort();
  }, [user?.id, t.exploreLoadError]);

  const selected = templates.find(item => item.id === selectedId) ?? templates[0] ?? null;
  const selectedStep = selected?.definition.steps.find(step => step.id === selectedStepId) ?? selected?.definition.steps[0] ?? null;
  const isOwner = Boolean(user && selected?.ownerId === user.id);
  useEffect(() => { setInputValues({}); setInputFiles({}); setInputError(""); }, [selected?.id]);

  const updateStep = (id: string, patch: Partial<ExploreStep>) =>
    setDraft(previous => previous ? { ...previous, steps: previous.steps.map(step => step.id === id ? { ...step, ...patch } : step) } : previous);
  const updateInput = (index: number, patch: Partial<ExploreTemplate["definition"]["inputs"][number]>) =>
    setDraft(previous => previous ? { ...previous, inputs: previous.inputs.map((input, position) => position === index ? { ...input, ...patch } : input) } : previous);

  const launchStep = () => {
    if (!selected || !selectedStep) return;
    const missing = selected.definition.inputs.find(input => input.required &&
      (input.type === "text" ? !inputValues[input.key]?.trim() : !inputFiles[input.key]));
    if (missing) {
      setInputError(t.workflowRequired);
      document.getElementById(`workflow-input-${missing.key}`)?.focus();
      return;
    }
    const files = selected.definition.inputs.flatMap(input => input.type !== "text" && inputFiles[input.key] ? [inputFiles[input.key]] : []);
    if (files.length > 1) { setInputError(t.workflowOneReference); return; }
    const file = files[0];
    const modelId = selectedStep.modelId;
    const needsImage = modelId === "fal-ai/qwen-image-edit" || modelId === "fal-ai/veo3.1/fast/image-to-video" || modelId === "bytedance/seedance-2.5/reference-to-video";
    if (needsImage && !file) { setInputError(t.workflowReferenceRequired); return; }
    if (modelId === "fal-ai/ltx-2.3-quality/inpaint" && (!file || !["video/mp4", "video/webm"].includes(file.type))) { setInputError(t.workflowReferenceRequired); return; }
    if (file && (selectedStep.kind === "audio" || selectedStep.kind === "chat" && !file.type.startsWith("image/") || selectedStep.kind === "image" && !file.type.startsWith("image/") || selectedStep.kind === "video" && !(file.type.startsWith("image/") || modelId === "fal-ai/ltx-2.3-quality/inpaint" && file.type.startsWith("video/")))) {
      setInputError(t.workflowUnsupportedFile); return;
    }
    const resolved = resolveTemplatePrompt(selectedStep.prompt, selected.definition.inputs, inputValues, inputFiles);
    if (resolved.hasUndefinedInput) { setInputError(t.workflowUndefinedInput); return; }
    setInputError("");
    onUse(selectedStep.kind, resolved.text, { file, modelId });
  };

  const saveTemplate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || saving) return;
    const prepared = { title: draft.title.trim(), description: draft.description.trim(),
      category: draft.category.trim(), definition: { version: 1 as const, inputs: draft.inputs,
        steps: draft.steps.map(step => ({ ...step, title: step.title.trim(), prompt: step.prompt.trim() })) } };
    if (new Set(draft.inputs.map(input => input.key)).size !== draft.inputs.length) {
      setSaveError(t.workflowDuplicateInput);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch(draft.id ? `/api/explore/${encodeURIComponent(draft.id)}` : "/api/explore", {
        method: draft.id ? "PATCH" : "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(prepared)
      });
      if (!response.ok) throw new Error(await responseError(response));
      const template = templateFromPayload((await response.json()).template);
      if (!template) throw new Error(t.workflowError);
      setTemplates(previous => [template, ...previous.filter(item => item.id !== template.id)]);
      setSelectedId(template.id);
      setSelectedStepId(template.definition.steps[0].id);
      setDraft(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t.workflowError);
    } finally { setSaving(false); }
  };

  const setVisibility = async (visibility: "public" | "private") => {
    if (!selected || !isOwner || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch(`/api/explore/${encodeURIComponent(selected.id)}/visibility`, {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility })
      });
      if (!response.ok) throw new Error(await responseError(response));
      setTemplates(previous => previous.map(item => item.id === selected.id ? { ...item, visibility } : item));
    } catch (error) { setSaveError(error instanceof Error ? error.message : t.workflowError); }
    finally { setSaving(false); }
  };

  return (
    <section className="browse-page" aria-labelledby="explore-title">
      <div className="workspace-heading"><div><span className="section-eyebrow">{t.exploreEyebrow}</span><h1 id="explore-title">{t.exploreTitle}</h1><p>{t.exploreDescription}</p></div><button className="outline-action" type="button" onClick={() => user ? (setDraft(newDraft()), setSaveError("")) : onLogin()}><Plus size={17} aria-hidden="true" />{t.createWorkflow}</button></div>
      {loadError && <div className="content-error" role="alert">{loadError}</div>}
      <div className="browse-layout">
        <div className="workflow-list" aria-label={t.exploreEyebrow}>
          {!loaded && <p className="content-empty" role="status">{t.loadingConversations}</p>}
          {loaded && !templates.length && <p className="content-empty">{t.exploreEmpty}</p>}
          {templates.map(item => {
            const Icon = stepIcons[item.definition.steps[0].kind];
            return <button type="button" key={item.id} className="workflow-row" aria-pressed={selected?.id === item.id && !draft} onClick={() => { setSelectedId(item.id); setSelectedStepId(null); setDraft(null); setSaveError(""); setInputValues({}); setInputFiles({}); setInputError(""); }}><span className="workflow-icon"><Icon size={22} aria-hidden="true" /></span><span><strong>{item.title}</strong><small>{item.description || item.category} · {item.definition.steps.length} {t.stepCount} · {item.visibility === "public" ? t.workflowPublic : t.workflowPrivate}</small></span><ArrowRight size={17} aria-hidden="true" /></button>;
          })}
        </div>
        <div className="workflow-detail">
          {draft ? <form className="workflow-editor" onSubmit={event => void saveTemplate(event)}>
            <div className="editor-heading"><div className="detail-icon"><Compass size={25} aria-hidden="true" /></div><button type="button" className="icon-button" aria-label={t.workflowCancel} onClick={() => { setDraft(null); setSaveError(""); }}><X size={19} /></button></div>
            <span className="detail-kicker">{draft.id ? t.workflowEdit : t.createWorkflow}</span>
            <label className="editor-field"><span>{t.workflowTitle}</span><input required maxLength={160} value={draft.title} placeholder={t.workflowTitlePlaceholder} onChange={event => setDraft(previous => previous && { ...previous, title: event.target.value })} /></label>
            <label className="editor-field"><span>{t.workflowDescription}</span><textarea maxLength={2000} rows={2} value={draft.description} placeholder={t.workflowDescriptionPlaceholder} onChange={event => setDraft(previous => previous && { ...previous, description: event.target.value })} /></label>
            <label className="editor-field"><span>{t.workflowCategory}</span><input required maxLength={80} value={draft.category} placeholder={t.workflowCategoryPlaceholder} onChange={event => setDraft(previous => previous && { ...previous, category: event.target.value })} /></label>
            <strong className="editor-steps-label">{t.workflowInputs}</strong>
            {draft.inputs.map((input, index) => <div className="editor-step" key={index}>
              <div className="editor-step-head"><strong>{String(index + 1).padStart(2, "0")}</strong><button type="button" aria-label={`${t.workflowRemoveInput} ${index + 1}`} onClick={() => setDraft(previous => previous && { ...previous, inputs: previous.inputs.filter((_, position) => position !== index) })}><X size={16} />{t.workflowRemoveInput}</button></div>
              <label className="editor-field"><span>{t.workflowInputKey}</span><input required pattern="[A-Za-z][A-Za-z0-9_]*" maxLength={80} value={input.key} onChange={event => updateInput(index, { key: event.target.value })} /></label>
              <label className="editor-field"><span>{t.workflowInputLabel}</span><input required maxLength={120} value={input.label} onChange={event => updateInput(index, { label: event.target.value })} /></label>
              <label className="editor-field"><span>{t.workflowInputType}</span><select value={input.type} onChange={event => updateInput(index, { type: event.target.value as typeof input.type })}>{(["text", "image", "video", "audio", "file"] as const).map(type => <option key={type} value={type}>{type === "text" ? t.outputTabs.text : type === "file" ? t.attach : t.nav[type]}</option>)}</select></label>
              <label className="toggle-field"><input type="checkbox" checked={input.required} onChange={event => updateInput(index, { required: event.target.checked })} /><span>{t.workflowInputRequired}</span></label>
            </div>)}
            {draft.inputs.length < 20 && <button className="outline-action editor-add-step" type="button" onClick={() => setDraft(previous => previous && { ...previous, inputs: [...previous.inputs, { key: `input${previous.inputs.length + 1}`, label: "", type: "text", required: true }] })}><Plus size={16} />{t.workflowAddInput}</button>}
            <strong className="editor-steps-label">{t.workflowSteps}</strong>
            {draft.steps.map((step, index) => <div className="editor-step" key={step.id}>
              <div className="editor-step-head"><strong>{String(index + 1).padStart(2, "0")}</strong><button type="button" aria-label={`${t.workflowRemoveStep} ${index + 1}`} disabled={draft.steps.length === 1} onClick={() => setDraft(previous => previous && { ...previous, steps: previous.steps.filter(item => item.id !== step.id) })}><X size={16} />{t.workflowRemoveStep}</button></div>
              <label className="editor-field"><span>{t.workflowStepTitle}</span><input required maxLength={120} value={step.title} placeholder={t.workflowStepPlaceholder} onChange={event => updateStep(step.id, { title: event.target.value })} /></label>
              <label className="editor-field"><span>{t.workflowStepKind}</span><select value={step.kind} onChange={event => updateStep(step.id, { kind: event.target.value as ExploreStep["kind"], modelId: undefined })}>{(["chat", "image", "video", "audio"] as const).map(kind => <option value={kind} key={kind}>{t.nav[kind]}</option>)}</select></label>
              <label className="editor-field"><span>{t.workflowStepModel}</span><select value={step.modelId ?? ""} onChange={event => updateStep(step.id, { modelId: event.target.value || undefined })}><option value="">{t.automatic}</option>{modelOptions[step.kind].map(option => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
              <label className="editor-field"><span>{t.workflowStepPrompt}</span><textarea required maxLength={20000} rows={3} value={step.prompt} placeholder={t.workflowPromptPlaceholder} onChange={event => updateStep(step.id, { prompt: event.target.value })} /></label>
            </div>)}
            {draft.steps.length < 30 && <button className="outline-action editor-add-step" type="button" onClick={() => setDraft(previous => previous && { ...previous, steps: [...previous.steps, newStep()] })}><Plus size={16} />{t.workflowAddStep}</button>}
            {saveError && <p className="content-error" role="alert">{saveError}</p>}
            <button className="primary-action" type="submit" disabled={saving}>{saving ? t.workflowSaving : t.workflowSave}<Check size={17} aria-hidden="true" /></button>
          </form> : selected && selectedStep ? <>
            <div className="detail-icon">{(() => { const Icon = stepIcons[selectedStep.kind]; return <Icon size={25} aria-hidden="true" />; })()}</div>
            <span className="detail-kicker">{selected.category} · {selected.definition.steps.length} {t.stepCount}</span>
            <h2>{selected.title}</h2><p>{selected.description}</p>
            {selected.definition.inputs.length > 0 && <div className="workflow-inputs"><strong>{t.workflowFillInputs}</strong>{selected.definition.inputs.map(input => <label className="editor-field" key={`${selected.id}-${input.key}`} htmlFor={`workflow-input-${input.key}`}><span>{input.label}{input.required ? " *" : ""}</span>{input.type === "text" ? <input id={`workflow-input-${input.key}`} type="text" value={inputValues[input.key] ?? ""} onChange={event => { setInputValues(previous => ({ ...previous, [input.key]: event.target.value })); setInputError(""); }} /> : <input id={`workflow-input-${input.key}`} type="file" accept={input.type === "image" ? "image/png,image/jpeg,image/webp" : input.type === "video" ? "video/mp4,video/webm" : input.type === "audio" ? "audio/*" : undefined} onChange={event => { const file = event.target.files?.[0]; if (file) setInputFiles(previous => ({ ...previous, [input.key]: file })); else setInputFiles(previous => { const next = { ...previous }; delete next[input.key]; return next; }); setInputError(""); }} />}</label>)}</div>}
            <div className="workflow-steps" role="group" aria-label={t.workflowChooseStep}>{selected.definition.steps.map((step, index) => <button className="workflow-step workflow-step-button" type="button" key={step.id} aria-pressed={selectedStep.id === step.id} onClick={() => setSelectedStepId(step.id)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step.title}</strong><ArrowRight size={16} aria-hidden="true" /></button>)}</div>
            <div className="step-prompt" dir="auto">{selectedStep.prompt}</div>
            {inputError && <p className="content-error" role="alert">{inputError}</p>}
            <button className="primary-action" type="button" onClick={launchStep}>{t.workflowUseStep}<ArrowRight size={17} aria-hidden="true" /></button>
            {isOwner && <div className="owner-actions"><span>{t.workflowOwn} · {selected.visibility === "public" ? t.workflowPublic : t.workflowPrivate}</span><div><button type="button" disabled={saving} onClick={() => { setDraft(draftFromTemplate(selected)); setSaveError(""); }}>{t.workflowEdit}</button><button type="button" disabled={saving} onClick={() => void setVisibility(selected.visibility === "public" ? "private" : "public")}>{selected.visibility === "public" ? t.workflowUnpublish : t.workflowPublish}</button></div></div>}
            {saveError && <p className="content-error" role="alert">{saveError}</p>}
          </> : <div className="content-empty detail-empty"><Compass size={28} aria-hidden="true" /><p>{t.exploreEmpty}</p></div>}
        </div>
      </div>
    </section>
  );
}

export function SpecialistsPage({ locale, onAsk }: { locale: Locale; onAsk: (id: string, prompt: string) => void }) {
  const t = copy[locale];
  const [profiles, setProfiles] = useState<SpecialistProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/specialists", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(await responseError(response)); return response.json(); })
      .then(body => { setProfiles(specialistsFromPayload(body)); setError(""); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t.specialistLoadError); })
      .finally(() => { if (!controller.signal.aborted) setLoaded(true); });
    return () => controller.abort();
  }, [t.specialistLoadError]);

  const selected = profiles.find(item => item.id === selectedId) ?? profiles[0] ?? null;
  const localized = (slug: string) => specialistCatalog.find(item =>
    ({ general: "general-health", skin: "skin-and-hair", mental: "mental-wellbeing" })[item.id] === slug);
  const titleFor = (profile: SpecialistProfile) => locale === "fa" ? localized(profile.slug)?.fa ?? profile.name : profile.name;
  const descriptionFor = (profile: SpecialistProfile) => locale === "fa" ? localized(profile.slug)?.faDescription ?? profile.description : profile.description;
  const iconFor = (slug: string): LucideIcon => slug === "skin-and-hair" ? ImageIcon : slug === "mental-wellbeing" ? MessageCircle : Stethoscope;
  const promptFor = (profile: SpecialistProfile) => {
    const seed = localized(profile.slug);
    if (seed) return locale === "fa" ? seed.faPrompt : seed.enPrompt;
    return locale === "fa" ? `دربارهٔ ${titleFor(profile)} این پرسش را دارم: ` : `I have a question about ${profile.domain}: `;
  };

  return <section className="browse-page" aria-labelledby="specialists-title">
    <div className="workspace-heading"><div><span className="section-eyebrow">{t.specialistEyebrow}</span><h1 id="specialists-title">{t.specialistTitle}</h1><p>{t.specialistDescription}</p></div></div>
    <div className="specialist-notice"><BookOpen size={21} aria-hidden="true" /><p>{t.specialistNotice}</p></div>
    {error && <div className="content-error" role="alert">{error}</div>}
    <div className="browse-layout specialists-layout"><div className="workflow-list">
      {!loaded && <p className="content-empty" role="status">{t.loadingConversations}</p>}
      {loaded && !profiles.length && <p className="content-empty">{t.specialistEmpty}</p>}
      {profiles.map(profile => { const Icon = iconFor(profile.slug); return <button type="button" key={profile.id} className="workflow-row" aria-pressed={selected?.id === profile.id} onClick={() => setSelectedId(profile.id)}><span className="workflow-icon"><Icon size={22} aria-hidden="true" /></span><span><strong>{titleFor(profile)}</strong><small>{descriptionFor(profile)}</small></span><ArrowRight size={17} aria-hidden="true" /></button>; })}
    </div><div className="workflow-detail">
      {selected ? <><div className="detail-icon">{(() => { const Icon = iconFor(selected.slug); return <Icon size={25} aria-hidden="true" />; })()}</div><span className="detail-kicker">{selected.domain}</span><h2>{titleFor(selected)}</h2><p>{descriptionFor(selected)}</p>
        {selected.sourceLinks.length > 0 && <div className="specialist-sources"><strong><BookOpen size={17} aria-hidden="true" />{t.sourceLinks}</strong>{selected.sourceLinks.map(link => <a href={link} key={link} target="_blank" rel="noreferrer">{new URL(link).hostname}<ArrowRight size={14} aria-hidden="true" /></a>)}</div>}
        <button className="primary-action" type="button" onClick={() => onAsk(selected.slug, promptFor(selected))}>{t.askSpecialist}<ArrowRight size={17} aria-hidden="true" /></button></>
      : <div className="content-empty detail-empty"><Stethoscope size={28} aria-hidden="true" /><p>{t.specialistEmpty}</p></div>}
    </div></div>
  </section>;
}
