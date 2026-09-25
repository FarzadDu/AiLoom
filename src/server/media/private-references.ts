import { getOwnedAsset } from "../content/assets";
import { signedAssetUrl } from "../storage/asset-access";

const referenceFields = new Set([
  "imageUrl", "maskImageUrl", "videoUrl", "maskVideoUrl", "firstFrameUrl", "lastFrameUrl",
  "imageUrls", "videoUrls", "audioUrls"
]);
const assetPath = /^\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export class PrivateReferenceError extends Error {
  constructor() {
    super("A private media reference is no longer available.");
    this.name = "PrivateReferenceError";
  }
}

/** Renew only Ailoom's signed private references just before a queued provider POST.
 * The stored job payload stays stable for idempotency and account export.
 */
export function refreshPrivateAssetUrls(
  ownerId: string,
  input: unknown,
  ownsAsset: (ownerId: string, assetId: string) => boolean = (owner, id) => Boolean(getOwnedAsset(owner, id))
): unknown {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  const origin = base ? new URL(base).origin : null;
  const renewed = new Map<string, string>();
  const refresh = (value: string): string => {
    let url: URL;
    try { url = new URL(value); } catch { return value; }
    if (!origin || url.origin !== origin) return value;
    const match = assetPath.exec(url.pathname);
    if (!match) return value;
    const assetId = match[1].toLowerCase();
    if (url.hash || url.username || url.password ||
        !url.searchParams.has("expires") || !url.searchParams.has("token") ||
        [...url.searchParams.keys()].some(key => key !== "expires" && key !== "token") ||
        !ownsAsset(ownerId, assetId)) {
      throw new PrivateReferenceError();
    }
    let fresh = renewed.get(assetId);
    if (!fresh) {
      fresh = signedAssetUrl(assetId, 2 * 60 * 60).url;
      renewed.set(assetId, fresh);
    }
    return fresh;
  };
  const walk = (value: unknown, key = ""): unknown => {
    if (typeof value === "string") return referenceFields.has(key) ? refresh(value) : value;
    if (Array.isArray(value)) return value.map(item => walk(item, key));
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, walk(child, childKey)]));
    return value;
  };
  return walk(input);
}
