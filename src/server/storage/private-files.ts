import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { dirname, resolve, sep } from "node:path";

const formats = {
  "image/png": { kind: "image", extension: "png", match: (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  "image/jpeg": { kind: "image", extension: "jpg", match: (bytes: Buffer) => bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 },
  "image/webp": { kind: "image", extension: "webp", match: (bytes: Buffer) => bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" },
  "image/gif": { kind: "image", extension: "gif", match: (bytes: Buffer) => ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)) },
  "video/mp4": { kind: "video", extension: "mp4", match: (bytes: Buffer) => bytes.toString("ascii", 4, 8) === "ftyp" },
  "video/webm": { kind: "video", extension: "webm", match: (bytes: Buffer) => bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) },
  "audio/mpeg": { kind: "audio", extension: "mp3", match: (bytes: Buffer) => bytes.toString("ascii", 0, 3) === "ID3" || bytes.length > 1 && bytes[0] === 255 && (bytes[1] & 224) === 224 },
  "audio/wav": { kind: "audio", extension: "wav", match: (bytes: Buffer) => bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE" },
  "audio/ogg": { kind: "audio", extension: "ogg", match: (bytes: Buffer) => bytes.toString("ascii", 0, 4) === "OggS" },
  "application/pdf": { kind: "file", extension: "pdf", match: (bytes: Buffer) => bytes.toString("ascii", 0, 5) === "%PDF-" }
} as const;

export type AcceptedMime = keyof typeof formats;
export type StoredKind = "image" | "video" | "audio" | "file";

export function inspectFile(bytes: Buffer, mimeType: string): { kind: StoredKind; extension: string } | null {
  const format = formats[mimeType as AcceptedMime];
  if (!format || !format.match(bytes)) return null;
  return { kind: format.kind, extension: format.extension };
}

export function detectMediaMime(bytes: Buffer, expectedKind: "image" | "video" | "audio"): AcceptedMime | null {
  for (const [mimeType, format] of Object.entries(formats)) {
    if (format.kind === expectedKind && format.match(bytes)) return mimeType as AcceptedMime;
  }
  return null;
}

export function mediaRoot(): string {
  return resolve(/* turbopackIgnore: true */ process.env.MEDIA_DIR?.trim() || "data/media");
}

export function mediaPath(storageKey: string): string {
  if (!/^[A-Za-z0-9._/-]{1,500}$/.test(storageKey) || storageKey.startsWith("/") ||
      storageKey.split("/").some(segment => segment === ".." || segment === "." || segment === "")) {
    throw new Error("Invalid private file key.");
  }
  const root = mediaRoot();
  const fullPath = resolve(root, storageKey);
  if (!fullPath.startsWith(root + sep)) throw new Error("Invalid private file key.");
  return fullPath;
}

export async function savePrivateFile(bytes: Buffer, mimeType: string) {
  const format = inspectFile(bytes, mimeType);
  if (!format) throw new Error("Unsupported file content.");
  const id = randomUUID();
  const storageKey = `uploads/${id.slice(0, 2)}/${id}.${format.extension}`;
  const path = mediaPath(storageKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  return { storageKey, kind: format.kind, mimeType, sizeBytes: bytes.length };
}

export async function deletePrivateFile(storageKey: string) {
  await unlink(mediaPath(storageKey)).catch(error => { if (error?.code !== "ENOENT") throw error; });
}

export async function privateFileResponse(storageKey: string, mimeType: string, rangeHeader: string | null, downloadName?: string | null): Promise<Response> {
  const path = mediaPath(storageKey);
  const info = await stat(/* turbopackIgnore: true */ path);
  const total = info.size;
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("Invalid private file.");
  let start = 0;
  let end = total - 1;
  let status = 200;
  if (rangeHeader) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (!match) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : total - 1;
    if (start < 0 || start >= total || end < start || end >= total) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    }
    status = 206;
  }
  const safeMime = Object.hasOwn(formats, mimeType) ? mimeType : "application/octet-stream";
  const headers = new Headers({
    "Content-Type": safeMime,
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": safeMime === "application/pdf" || safeMime === "application/octet-stream"
      ? `attachment; filename="${(downloadName || "download").replace(/[\\"\r\n]/g, "_")}"` : "inline"
  });
  if (status === 206) headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
  const body = Readable.toWeb(createReadStream(/* turbopackIgnore: true */ path, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
}
