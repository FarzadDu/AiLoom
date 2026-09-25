"use client";

import { useState, type FormEvent } from "react";
import { Check, FolderClosed, Pencil, Plus, Trash2, X } from "lucide-react";
import type { ChatProject } from "./chat-api";
import type { Locale } from "./workspace-data";

const labels = {
  en: {
    projects: "Projects", all: "All conversations", create: "New project", edit: "Edit project",
    name: "Project name", note: "Project instructions", noteHint: "Text chats send this note and bounded recent text from this project to OpenRouter for context. Image chats only save the project link.",
    save: "Save", cancel: "Cancel", remove: "Delete project", confirm: "Delete project and unfile its conversations?",
    emptyName: "Add a project name."
  },
  fa: {
    projects: "پروژه‌ها", all: "همهٔ گفتگوها", create: "پروژهٔ تازه", edit: "ویرایش پروژه",
    name: "نام پروژه", note: "دستورهای پروژه", noteHint: "در چت متنی، این یادداشت و گزیده‌های محدود از گفت‌وگوهای اخیر همین پروژه برای زمینهٔ پاسخ به OpenRouter فرستاده می‌شود. چت تصویری فقط به پروژه پیوند می‌خورد.",
    save: "ذخیره", cancel: "انصراف", remove: "حذف پروژه", confirm: "پروژه حذف شود و گفتگوهایش بدون پروژه بمانند؟",
    emptyName: "برای پروژه نامی بنویس."
  }
} as const;

export function projectLabel(locale: Locale, project: ChatProject | null) {
  return project?.name ?? labels[locale].all;
}

export function ChatProjects({ locale, projects, selectedId, busy, error, onSelect, onCreate, onUpdate, onDelete }: {
  locale: Locale; projects: ChatProject[]; selectedId: string | null; busy: boolean; error: string;
  onSelect: (id: string | null) => void;
  onCreate: (name: string, description: string | null) => Promise<boolean>;
  onUpdate: (id: string, name: string, description: string | null) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const t = labels[locale];
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [localError, setLocalError] = useState("");
  const beginEdit = (project: ChatProject | null) => {
    setEditingId(project?.id ?? "new");
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setConfirmingDelete(false);
    setLocalError("");
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) { setLocalError(t.emptyName); return; }
    const cleanDescription = description.trim() || null;
    const done = editingId === "new"
      ? await onCreate(cleanName, cleanDescription)
      : editingId ? await onUpdate(editingId, cleanName, cleanDescription) : false;
    if (done) setEditingId(null);
  };
  const remove = async () => {
    if (!editingId || editingId === "new") return;
    if (!confirmingDelete) { setConfirmingDelete(true); return; }
    if (await onDelete(editingId)) setEditingId(null);
  };
  return <div className="chat-projects">
    <div className="chat-projects-head"><strong>{t.projects}</strong><button type="button" title={t.create} aria-label={t.create} disabled={busy} onClick={() => beginEdit(null)}><Plus size={17} /></button></div>
    <div className="chat-project-list">
      <button type="button" className="chat-project-row" aria-current={selectedId === null ? "page" : undefined} onClick={() => onSelect(null)}><FolderClosed size={15} /><span>{t.all}</span></button>
      {projects.map(project => <div className="chat-project-item" key={project.id}>
        <button type="button" className="chat-project-row" aria-current={selectedId === project.id ? "page" : undefined} onClick={() => onSelect(project.id)}><FolderClosed size={15} /><span>{project.name}</span></button>
        <button type="button" className="chat-project-edit" aria-label={`${t.edit}: ${project.name}`} title={t.edit} disabled={busy} onClick={() => beginEdit(project)}><Pencil size={14} /></button>
      </div>)}
    </div>
    {editingId && <form className="chat-project-form" onSubmit={event => void save(event)}>
      <div className="chat-project-form-head"><strong>{editingId === "new" ? t.create : t.edit}</strong><button type="button" aria-label={t.cancel} onClick={() => setEditingId(null)}><X size={16} /></button></div>
      <label>{t.name}<input value={name} onChange={event => setName(event.target.value)} maxLength={120} autoFocus disabled={busy} /></label>
      <label>{t.note}<textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} rows={3} disabled={busy} /></label>
      <small>{t.noteHint}</small>
      {(localError || error) && <p role="alert" className="chat-project-error">{localError || error}</p>}
      <div className="chat-project-actions"><button type="submit" disabled={busy}><Check size={15} />{t.save}</button>{editingId !== "new" && <button type="button" className="chat-project-delete" disabled={busy} onClick={() => void remove()}><Trash2 size={15} />{confirmingDelete ? t.confirm : t.remove}</button>}</div>
    </form>}
    {!editingId && error && <p role="alert" className="chat-project-error">{error}</p>}
  </div>;
}
