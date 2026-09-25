import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { mediaPath, privateFileResponse } from "../storage/private-files";
import { pinnedHttpsRequestOptions } from "../storage/provider-import";

export const MAX_DATASET_BYTES = 100 * 1024 * 1024;
export const MAX_WEIGHTS_BYTES = 200 * 1024 * 1024;
const TTL_SECONDS = 6 * 60 * 60;
type Kind = "dataset" | "weights";

export function loraStorageKey(kind: Kind, id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid LoRA file ID.");
  return `lora/${kind}/${id}.${kind === "dataset" ? "zip" : "safetensors"}`;
}

function sign(kind: Kind, id: string, expires: number): string {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("Private LoRA access is not configured.");
  return createHmac("sha256", secret).update(`lora:${kind}:${id}:${expires}`).digest("base64url");
}

export function signedLoraFileUrl(kind: Kind, id: string): string {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (!base) throw new Error("Set PUBLIC_BASE_URL before using LoRA training or inference.");
  const origin = new URL(base);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.hash ||
      origin.hostname === "localhost" || origin.hostname.endsWith(".localhost")) {
    throw new Error("A public HTTPS URL is required for LoRA provider access.");
  }
  const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const url = new URL(`/api/lora/files/${kind}/${id}`, origin);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("token", sign(kind, id, expires));
  return url.toString();
}

export function verifyLoraFileUrl(kind: Kind, id: string, expiresValue: string | null,
  tokenValue: string | null): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !expiresValue || !/^\d{10,12}$/.test(expiresValue) ||
      !tokenValue || !/^[A-Za-z0-9_-]{43}$/.test(tokenValue)) return false;
  const expires = Number(expiresValue);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + TTL_SECONDS) return false;
  const expected = Buffer.from(sign(kind, id, expires));
  const provided = Buffer.from(tokenValue);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function loraFileResponse(kind: Kind, id: string, storageKey = loraStorageKey(kind, id)): Promise<Response> {
  return privateFileResponse(storageKey, "application/octet-stream", null,
    `${id}.${kind === "dataset" ? "zip" : "safetensors"}`);
}

function cap(max: number): Transform {
  let size = 0;
  return new Transform({ transform(chunk: Buffer, _encoding, callback) {
    size += chunk.length;
    callback(size > max ? new Error("LoRA file is too large.") : null, chunk);
  } });
}

export async function saveDatasetStream(stream: ReadableStream<Uint8Array>, id = randomUUID()) {
  const storageKey = loraStorageKey("dataset", id);
  const path = mediaPath(storageKey);
  const temporary = mediaPath(`lora/tmp/${randomUUID()}.zip`);
  await mkdir(dirname(path), { recursive: true });
  await mkdir(dirname(temporary), { recursive: true });
  try {
    await pipeline(Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0]),
      cap(MAX_DATASET_BYTES), createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
    const sizeBytes = (await stat(temporary)).size;
    if (sizeBytes < 100) throw new Error("Dataset ZIP is empty.");
    const imageCount = await validateDatasetZip(temporary, sizeBytes);
    await rename(temporary, path);
    return { id, storageKey, sizeBytes, imageCount };
  } catch (error) { await rm(temporary, { force: true }).catch(() => undefined); throw error; }
}

export async function validateDatasetZip(path: string, knownSize?: number): Promise<number> {
  const file = await open(path, "r");
  try {
    const size = knownSize ?? (await file.stat()).size;
    const tailSize = Math.min(size, 65_557);
    const tail = Buffer.alloc(tailSize);
    await file.read(tail, 0, tailSize, size - tailSize);
    let end = -1;
    for (let i = tailSize - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tailSize) { end = i; break; }
    }
    if (end < 0 || tail.readUInt16LE(end + 4) !== 0 || tail.readUInt16LE(end + 6) !== 0 ||
        tail.readUInt16LE(end + 8) !== tail.readUInt16LE(end + 10)) throw new Error("Unsupported ZIP archive.");
    const entries = tail.readUInt16LE(end + 10);
    const directorySize = tail.readUInt32LE(end + 12);
    const directoryOffset = tail.readUInt32LE(end + 16);
    if (entries < 4 || entries > 250 || directorySize > 2_000_000 ||
        directoryOffset + directorySize > size - tailSize + end) throw new Error("Dataset ZIP is too large or invalid.");
    const directory = Buffer.alloc(directorySize);
    await file.read(directory, 0, directorySize, directoryOffset);
    let offset = 0, imageCount = 0, uncompressed = 0;
    const seen = new Set<string>();
    for (let i = 0; i < entries; i++) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid ZIP directory.");
      const flags = directory.readUInt16LE(offset + 8);
      const method = directory.readUInt16LE(offset + 10);
      const compressed = directory.readUInt32LE(offset + 20);
      const original = directory.readUInt32LE(offset + 24);
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      const entryLength = 46 + nameLength + extraLength + commentLength;
      const localOffset = directory.readUInt32LE(offset + 42);
      if (offset + entryLength > directory.length || flags & 1 || ![0, 8].includes(method) ||
          compressed === 0xffffffff || original === 0xffffffff || localOffset >= directoryOffset ||
          original > 40_000_000 || compressed > MAX_DATASET_BYTES) throw new Error("Unsupported ZIP entry.");
      const name = directory.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
      if (!name || name.length > 240 || name.startsWith("/") || name.includes("\\") || name.includes(":") ||
          name.includes("\0") || name.split("/").some(part => part === ".." || part === ".") ||
          seen.has(name.toLowerCase())) throw new Error("Unsafe ZIP filename.");
      seen.add(name.toLowerCase());
      const unixMode = directory.readUInt32LE(offset + 38) >>> 16;
      if ((unixMode & 0o170000) === 0o120000) throw new Error("ZIP symbolic links are unsupported.");
      uncompressed += original;
      if (uncompressed > 500_000_000) throw new Error("Dataset ZIP expands too large.");
      if (!name.endsWith("/") && !name.startsWith("__MACOSX/")) {
        const extension = name.split(".").at(-1)?.toLowerCase();
        if (["jpg", "jpeg", "png", "webp"].includes(extension ?? "")) imageCount++;
        else if (extension !== "txt") throw new Error("ZIP may contain only images and text captions.");
      }
      offset += entryLength;
    }
    if (offset !== directory.length || imageCount < 4 || imageCount > 100) throw new Error("ZIP needs 4 to 100 images.");
    return imageCount;
  } finally { await file.close(); }
}

export async function validateSafetensors(path: string): Promise<void> {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    if (size < 64 || size > MAX_WEIGHTS_BYTES) throw new Error("LoRA weights are invalid or too large.");
    const head = Buffer.alloc(8);
    await file.read(head, 0, 8, 0);
    const length = Number(head.readBigUInt64LE());
    if (!Number.isSafeInteger(length) || length < 2 || length > 16_000_000 || length + 8 >= size) throw new Error("Invalid LoRA weights.");
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, 8);
    const data = JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        !Object.entries(data).some(([key, value]) => key !== "__metadata__" && value &&
          typeof value === "object" && Array.isArray((value as Record<string, unknown>).data_offsets))) {
      throw new Error("Invalid LoRA weights.");
    }
  } finally { await file.close(); }
}

export async function importLoraWeights(urlValue: string, id: string) {
  const url = new URL(urlValue);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port && url.port !== "443" ||
      url.hostname === "localhost" || url.hostname.endsWith(".local")) throw new Error("Unsafe LoRA output URL.");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length) throw new Error("LoRA output address unavailable.");
  for (const entry of addresses) pinnedHttpsRequestOptions(url, entry.address, entry.family as 4 | 6);
  const address = addresses[0];
  // An import attempt gets its own path. A worker that loses its lease can
  // remove only its own bytes without deleting another worker's completed copy.
  const storageKey = loraStorageKey("weights", id)
    .replace(/\.safetensors$/, `-${randomUUID()}.safetensors`);
  const target = mediaPath(storageKey);
  const temporary = mediaPath(`lora/tmp/${randomUUID()}.safetensors`);
  await mkdir(dirname(target), { recursive: true });
  await mkdir(dirname(temporary), { recursive: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const request = httpsRequest(url, { ...pinnedHttpsRequestOptions(url, address.address, address.family as 4 | 6),
        signal: AbortSignal.timeout(180_000), timeout: 180_000 }, response => {
        if (response.statusCode !== 200 || Number(response.headers["content-length"] ?? 0) > MAX_WEIGHTS_BYTES) {
          response.destroy(); reject(new Error("LoRA weights could not be downloaded.")); return;
        }
        void pipeline(response, cap(MAX_WEIGHTS_BYTES), createWriteStream(temporary, { flags: "wx", mode: 0o600 }))
          .then(resolve, reject);
      });
      request.on("error", reject);
      request.on("timeout", () => request.destroy(new Error("LoRA download timed out.")));
      request.end();
    });
    await validateSafetensors(temporary);
    const sizeBytes = (await stat(temporary)).size;
    await rename(temporary, target);
    return { storageKey, sizeBytes };
  } catch (error) { await rm(temporary, { force: true }).catch(() => undefined); throw error; }
}

export async function removeLoraFile(storageKey: string): Promise<void> {
  await rm(mediaPath(storageKey), { force: true });
}
