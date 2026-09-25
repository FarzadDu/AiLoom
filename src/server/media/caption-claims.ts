import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mediaPath } from "../storage/private-files";

type Claim = { digest: string; startedAt: number };
type Result = { state: "completed"; assetId: string } | { state: "failed" };
export type CaptionClaimState = { state: "processing" | "expired" | "conflict" } | Result;

const MAX_PENDING_MS = 5 * 60 * 1000;

function claimPaths(ownerId: string, key: string) {
  const ownerHash = createHash("sha256").update(ownerId).digest("hex").slice(0, 32);
  const base = `captions/claims/${ownerHash}/${key}`;
  return { claim: mediaPath(`${base}.json`), result: mediaPath(`${base}.result.json`) };
}

export function captionRequestDigest(input: { sourceAssetId: string; format: string; text: string }): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/** A hard link makes a fully written claim visible atomically and never overwrites an earlier request. */
async function writeOnce(path: string, value: unknown): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    try {
      await link(temporary, path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function readJson(path: string): Promise<unknown | null> {
  let bytes: string;
  try { bytes = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return JSON.parse(bytes);
}

export async function readCaptionClaim(ownerId: string, key: string,
  digest: string): Promise<CaptionClaimState | null> {
  const paths = claimPaths(ownerId, key);
  const raw = await readJson(paths.claim);
  if (raw === null) return null;
  const claim = raw as Claim;
  if (!claim || claim.digest !== digest) return { state: "conflict" };
  const result = await readJson(paths.result) as Result | null;
  if (result?.state === "completed" && typeof result.assetId === "string") return result;
  if (result?.state === "failed") return result;
  if (!Number.isSafeInteger(claim.startedAt) || Date.now() - claim.startedAt > MAX_PENDING_MS) {
    return { state: "expired" };
  }
  return { state: "processing" };
}

export async function beginCaptionClaim(ownerId: string, key: string, digest: string): Promise<boolean> {
  return writeOnce(claimPaths(ownerId, key).claim, { digest, startedAt: Date.now() } satisfies Claim);
}

export async function finishCaptionClaim(ownerId: string, key: string, result: Result): Promise<void> {
  const created = await writeOnce(claimPaths(ownerId, key).result, result);
  if (!created) throw new Error("Caption claim was already finished.");
}
