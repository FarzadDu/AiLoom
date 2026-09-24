import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { invite, user } from "../db/schema";

export type InviteRole = "admin" | "user";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function validTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function getValidInvite(token: unknown, email?: string) {
  if (!validTokenShape(token)) return null;

  const conditions = [
    eq(invite.tokenHash, tokenHash(token)),
    gt(invite.expiresAt, new Date()),
    isNull(invite.redeemedAt),
    isNull(invite.revokedAt)
  ];
  if (email !== undefined) conditions.push(eq(invite.email, normalizeEmail(email)));

  return getDb().select().from(invite).where(and(...conditions)).get() ?? null;
}

export function createInvite(input: {
  email: string;
  role?: InviteRole;
  createdByUserId?: string;
  expiresInDays?: number;
}) {
  const email = normalizeEmail(input.email);
  const role = input.role ?? "user";
  const expiresInDays = input.expiresInDays ?? 7;
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30) {
    throw new Error("Invalid invite lifetime");
  }

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInDays * 86_400_000);
  const db = getDb();

  const row = db.transaction((tx) => {
    if (tx.select({ id: user.id }).from(user).where(eq(user.email, email)).get()) {
      throw new Error("An account already exists for this email");
    }

    tx.update(invite)
      .set({ revokedAt: now })
      .where(and(eq(invite.email, email), isNull(invite.redeemedAt), isNull(invite.revokedAt)))
      .run();

    return tx.insert(invite).values({
      id: randomUUID(),
      email,
      role,
      tokenHash: tokenHash(token),
      createdByUserId: input.createdByUserId ?? null,
      createdAt: now,
      expiresAt
    }).returning().get();
  });

  return { token, invite: row };
}

export function redeemInvite(token: unknown, email: string, userId: string): boolean {
  if (!validTokenShape(token)) return false;
  const row = getDb().update(invite)
    .set({ redeemedAt: new Date(), redeemedByUserId: userId })
    .where(and(
      eq(invite.tokenHash, tokenHash(token)),
      eq(invite.email, normalizeEmail(email)),
      gt(invite.expiresAt, new Date()),
      isNull(invite.redeemedAt),
      isNull(invite.revokedAt)
    ))
    .returning({ id: invite.id })
    .get();
  return Boolean(row);
}

export function listInvites() {
  return getDb().select({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    redeemedAt: invite.redeemedAt,
    revokedAt: invite.revokedAt,
    createdByUserId: invite.createdByUserId,
    redeemedByUserId: invite.redeemedByUserId
  }).from(invite).orderBy(desc(invite.createdAt)).limit(100).all();
}

export function revokeInvite(id: string): boolean {
  const row = getDb().update(invite)
    .set({ revokedAt: new Date() })
    .where(and(eq(invite.id, id), isNull(invite.redeemedAt), isNull(invite.revokedAt)))
    .returning({ id: invite.id })
    .get();
  return Boolean(row);
}

export function getBaseUrl(): string {
  return process.env.BETTER_AUTH_URL?.trim() || process.env.PUBLIC_BASE_URL?.trim() || "http://localhost:3000";
}

export function inviteUrl(token: string): string {
  return new URL(`/invite/${token}`, getBaseUrl()).toString();
}

