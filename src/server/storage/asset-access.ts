import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_TTL_SECONDS = 2 * 60 * 60;

function signingKey(): string {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("Private asset access is not configured.");
  return secret;
}

function signature(assetId: string, expires: number): string {
  return createHmac("sha256", signingKey()).update(`${assetId}.${expires}`).digest("base64url");
}

export function verifyAssetAccess(assetId: string, expiresValue: string | null, tokenValue: string | null): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(assetId) || !expiresValue || !/^\d{10,12}$/.test(expiresValue) ||
      !tokenValue || !/^[A-Za-z0-9_-]{43}$/.test(tokenValue)) return false;
  const expires = Number(expiresValue);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + MAX_TTL_SECONDS) return false;
  const expected = Buffer.from(signature(assetId, expires));
  const provided = Buffer.from(tokenValue);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function signedAssetUrl(assetId: string, ttlSeconds = 60 * 60): { url: string; expiresAt: string } {
  if (!/^[0-9a-f-]{36}$/i.test(assetId) || !Number.isInteger(ttlSeconds) ||
      ttlSeconds < 60 || ttlSeconds > MAX_TTL_SECONDS) throw new Error("Invalid private asset access request.");
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (!base) throw new Error("Set PUBLIC_BASE_URL before sharing an asset with a model.");
  const origin = new URL(base);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.hash ||
      origin.hostname === "localhost" || origin.hostname.endsWith(".localhost")) {
    throw new Error("A public HTTPS site URL is required for provider asset access.");
  }
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const url = new URL(`/api/assets/${assetId}`, origin);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("token", signature(assetId, expires));
  return { url: url.toString(), expiresAt: new Date(expires * 1000).toISOString() };
}
