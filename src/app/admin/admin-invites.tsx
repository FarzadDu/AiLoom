"use client";

import { ArrowLeft, Check, Copy, Moon, Plus, Sun, UserRoundPlus, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ThemedSelect } from "@/components/themed-select";
import styles from "./admin.module.css";

type Locale = "en" | "fa";
type Theme = "light" | "dark";
type Invite = {
  id: string;
  email: string;
  role: "user" | "admin";
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  revokedAt: string | null;
};

const labels = {
  en: {
    back: "Back to workspace", admin: "Administration", title: "Invite people to Ailoom.",
    description: "Access is by invitation. Each link works once for the specified email address and expires after the chosen period.",
    create: "Create invitation", email: "Email address", role: "Access", user: "Member", administrator: "Administrator",
    days: "Expires in", day: "day", daysPlural: "days", issue: "Create invite", issuing: "Creating…",
    active: "Active invitations", records: "Recent invitations", status: "Status", expiry: "Expiry", action: "Action",
    pending: "Pending", redeemed: "Used", revoked: "Revoked", expired: "Expired", revoke: "Revoke", revoking: "Revoking…",
    noInvites: "No invitations yet.", linkReady: "Invitation link created", linkWarning: "Copy this link now. For privacy, it will not be shown again.",
    copy: "Copy link", copied: "Copied", manualCopy: "Select the link and copy it manually.",
    invalidEmail: "Enter a valid email address.", invalidDays: "Choose 1 to 30 days.",
    failed: "Something went wrong. Please try again.", theme: "Switch theme", language: "Choose language",
    as: "Signed in as", once: "One-time link", latest: "Showing up to 100 recent invitations.",
    revokeFailure: "The invitation could not be revoked. It may have already been used."
  },
  fa: {
    back: "بازگشت به فضای کار", admin: "مدیریت", title: "دعوت به Ailoom",
    description: "ورود فقط با دعوت‌نامه است. هر لینک یک بار و فقط برای ایمیل مشخص‌شده کار می‌کند و پس از زمان انتخابی منقضی می‌شود.",
    create: "ایجاد دعوت‌نامه", email: "نشانی ایمیل", role: "سطح دسترسی", user: "کاربر", administrator: "مدیر",
    days: "اعتبار تا", day: "روز", daysPlural: "روز", issue: "ساخت دعوت‌نامه", issuing: "در حال ساخت…",
    active: "دعوت‌نامه‌های فعال", records: "دعوت‌نامه‌های اخیر", status: "وضعیت", expiry: "انقضا", action: "عملیات",
    pending: "در انتظار", redeemed: "استفاده‌شده", revoked: "لغوشده", expired: "منقضی‌شده", revoke: "لغو", revoking: "در حال لغو…",
    noInvites: "هنوز دعوت‌نامه‌ای وجود ندارد.", linkReady: "لینک دعوت ساخته شد", linkWarning: "همین حالا لینک را کپی کنید؛ برای حفظ حریم خصوصی دوباره نمایش داده نمی‌شود.",
    copy: "کپی لینک", copied: "کپی شد", manualCopy: "لینک را انتخاب و دستی کپی کنید.",
    invalidEmail: "یک نشانی ایمیل معتبر وارد کنید.", invalidDays: "مدت اعتبار باید بین ۱ تا ۳۰ روز باشد.",
    failed: "خطایی رخ داد. دوباره تلاش کنید.", theme: "تغییر ظاهر", language: "انتخاب زبان",
    as: "ورود با", once: "لینک یک‌بارمصرف", latest: "حداکثر ۱۰۰ دعوت‌نامهٔ اخیر نمایش داده می‌شود.",
    revokeFailure: "لغو دعوت‌نامه ممکن نشد؛ شاید قبلاً استفاده شده باشد."
  }
} satisfies Record<Locale, Record<string, string>>;

function inviteStatus(item: Invite): "pending" | "redeemed" | "revoked" | "expired" {
  if (item.redeemedAt) return "redeemed";
  if (item.revokedAt) return "revoked";
  if (new Date(item.expiresAt).getTime() <= Date.now()) return "expired";
  return "pending";
}

function parseInvites(value: unknown): Invite[] | null {
  if (!value || typeof value !== "object" || !("invites" in value) || !Array.isArray(value.invites)) return null;
  return value.invites.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.email !== "string" ||
        (row.role !== "user" && row.role !== "admin") ||
        typeof row.createdAt !== "string" || typeof row.expiresAt !== "string") return [];
    return [{
      id: row.id, email: row.email, role: row.role,
      createdAt: row.createdAt, expiresAt: row.expiresAt,
      redeemedAt: typeof row.redeemedAt === "string" ? row.redeemedAt : null,
      revokedAt: typeof row.revokedAt === "string" ? row.revokedAt : null
    }];
  });
}

async function apiError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : fallback;
}

export default function AdminInvites({ initialInvites, adminEmail }: { initialInvites: Invite[]; adminEmail: string }) {
  const [locale, setLocale] = useState<Locale>("en");
  const [theme, setTheme] = useState<Theme>("light");
  const [invites, setInvites] = useState(initialInvites);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Invite["role"]>("user");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const t = labels[locale];

  useEffect(() => {
    try {
      const savedLocale = localStorage.getItem("ailoom.locale");
      const savedTheme = localStorage.getItem("ailoom.theme");
      if (savedLocale === "en" || savedLocale === "fa") setLocale(savedLocale);
      if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
    } catch { /* Storage may be disabled. */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "fa" ? "rtl" : "ltr";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("ailoom.locale", locale);
      localStorage.setItem("ailoom.theme", theme);
    } catch { /* Storage may be disabled. */ }
  }, [locale, theme]);

  async function refreshInvites() {
    const response = await fetch("/api/admin/invites", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error(await apiError(response, t.failed));
    const parsed = parseInvites(await response.json());
    if (!parsed) throw new Error(t.failed);
    setInvites(parsed);
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) { setError(t.invalidEmail); return; }
    if (!Number.isInteger(days) || days < 1 || days > 30) { setError(t.invalidDays); return; }
    setBusy(true);
    setError("");
    setNewUrl("");
    setCopied(false);
    try {
      const response = await fetch("/api/admin/invites", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, role, expiresInDays: days })
      });
      if (!response.ok) throw new Error(await apiError(response, t.failed));
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("inviteUrl" in result) || typeof result.inviteUrl !== "string") {
        throw new Error(t.failed);
      }
      setNewUrl(result.inviteUrl);
      setEmail("");
      await refreshInvites();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.failed);
    } finally { setBusy(false); }
  }

  async function revoke(id: string) {
    setRevokingId(id);
    setError("");
    try {
      const response = await fetch(`/api/admin/invites/${encodeURIComponent(id)}`, {
        method: "DELETE", credentials: "same-origin"
      });
      if (!response.ok) throw new Error(await apiError(response, t.revokeFailure));
      await refreshInvites();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.revokeFailure);
    } finally { setRevokingId(null); }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(newUrl);
      setCopied(true);
    } catch {
      linkRef.current?.focus();
      linkRef.current?.select();
      setError(t.manualCopy);
    }
  }

  const pendingCount = invites.filter(item => inviteStatus(item) === "pending").length;
  const dateLabel = (date: string) => new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-US", {
    dateStyle: "medium", timeStyle: "short"
  }).format(new Date(date));

  return <main className={styles.page}>
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label={t.back}><span className={styles.mark}>A</span><span>Ailoom</span></a>
      <div className={styles.controls}>
        <div className={styles.languages} aria-label={t.language}>
          <button type="button" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>EN</button>
          <button type="button" aria-pressed={locale === "fa"} onClick={() => setLocale("fa")}>فا</button>
        </div>
        <button type="button" className={styles.iconButton} aria-label={t.theme} onClick={() => setTheme(current => current === "light" ? "dark" : "light")}>
          {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </div>
    </header>

    <div className={styles.content}>
      <a className={styles.back} href="/"><ArrowLeft size={17} aria-hidden="true" />{t.back}</a>
      <div className={styles.intro}>
        <div><p className={styles.eyebrow}>{t.admin}</p><h1>{t.title}</h1><p>{t.description}</p></div>
        <span className={styles.account}>{t.as} <b dir="ltr">{adminEmail}</b></span>
      </div>

      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="create-heading">
          <div className={styles.cardHeading}><span className={styles.headingIcon}><UserRoundPlus size={19} /></span><h2 id="create-heading">{t.create}</h2></div>
          <form onSubmit={event => void createInvite(event)} className={styles.form}>
            <label htmlFor="invite-email">{t.email}</label>
            <input id="invite-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" dir="ltr" disabled={busy} />
            <div className={styles.formRow}>
              <div><label htmlFor="invite-role">{t.role}</label><ThemedSelect id="invite-role" value={role} onValueChange={value => setRole(value as Invite["role"])} disabled={busy}><option value="user">{t.user}</option><option value="admin">{t.administrator}</option></ThemedSelect></div>
              <div><label htmlFor="invite-days">{t.days}</label><div className={styles.daysInput}><input id="invite-days" type="number" min={1} max={30} step={1} value={days} onChange={event => setDays(Number(event.target.value))} disabled={busy} /><span>{days === 1 ? t.day : t.daysPlural}</span></div></div>
            </div>
            <button className={styles.primary} type="submit" disabled={busy}><Plus size={18} aria-hidden="true" />{busy ? t.issuing : t.issue}</button>
          </form>
          {newUrl && <div className={styles.newLink} role="status">
            <div className={styles.newLinkTitle}><Check size={17} aria-hidden="true" /><strong>{t.linkReady}</strong><span>{t.once}</span></div>
            <p>{t.linkWarning}</p>
            <div className={styles.linkLine}><input ref={linkRef} readOnly value={newUrl} dir="ltr" aria-label={t.linkReady} onFocus={event => event.target.select()} /><button type="button" onClick={() => void copyUrl()}><Copy size={16} aria-hidden="true" />{copied ? t.copied : t.copy}</button></div>
          </div>}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </section>

        <aside className={styles.summary}>
          <p>{t.active}</p><strong>{new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(pendingCount)}</strong>
          <span>{t.latest}</span>
        </aside>
      </div>

      <section className={styles.records} aria-labelledby="records-heading">
        <div className={styles.recordsHeading}><h2 id="records-heading">{t.records}</h2><span>{invites.length} / 100</span></div>
        {invites.length === 0 ? <p className={styles.empty}>{t.noInvites}</p> : <div className={styles.tableScroll}><table>
          <thead><tr><th>{t.email}</th><th>{t.role}</th><th>{t.status}</th><th>{t.expiry}</th><th>{t.action}</th></tr></thead>
          <tbody>{invites.map(item => {
            const status = inviteStatus(item);
            return <tr key={item.id}>
              <td className={styles.email} dir="ltr">{item.email}</td>
              <td>{item.role === "admin" ? t.administrator : t.user}</td>
              <td><span className={`${styles.status} ${styles[status]}`}>{t[status]}</span></td>
              <td><time dateTime={item.expiresAt}>{dateLabel(item.expiresAt)}</time></td>
              <td>{status === "pending" && <button className={styles.revoke} type="button" onClick={() => void revoke(item.id)} disabled={revokingId === item.id}><X size={15} aria-hidden="true" />{revokingId === item.id ? t.revoking : t.revoke}</button>}</td>
            </tr>;
          })}</tbody>
        </table></div>}
      </section>
    </div>
  </main>;
}
