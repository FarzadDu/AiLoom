import { inspectFile } from "../storage/private-files";

export const MAX_TRANSCRIPTION_FILE_BYTES = 50_000_000;
const MAX_MULTIPART_BYTES = MAX_TRANSCRIPTION_FILE_BYTES + 1_000_000;

const acceptedMimeTypes: Record<string, "audio/mpeg" | "audio/wav" | "audio/ogg" | "video/mp4" | "video/webm"> = {
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
  "audio/wav": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/ogg": "audio/ogg",
  "audio/mp4": "video/mp4",
  "audio/x-m4a": "video/mp4",
  "audio/webm": "video/webm",
  "video/mp4": "video/mp4",
  "video/webm": "video/webm"
};

export class TranscriptionRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "TranscriptionRequestError";
  }
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > MAX_MULTIPART_BYTES) {
    throw new TranscriptionRequestError(413, "File exceeds the 50 MB transcription limit.");
  }
  if (!request.body) throw new TranscriptionRequestError(400, "Choose an audio or video file.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_MULTIPART_BYTES) {
        await reader.cancel();
        throw new TranscriptionRequestError(413, "File exceeds the 50 MB transcription limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function parseTranscriptionRequest(request: Request): Promise<{
  bytes: Buffer;
  filename: string;
  mimeType: string;
  languageCode?: string;
  diarize: boolean;
}> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) {
    throw new TranscriptionRequestError(415, "Upload the file as multipart form data.");
  }
  const body = await readBoundedBody(request);
  let form: FormData;
  try {
    form = await new Request("http://local/transcription", {
      method: "POST", headers: { "content-type": contentType }, body: new Uint8Array(body)
    }).formData();
  } catch {
    throw new TranscriptionRequestError(400, "Invalid transcription upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new TranscriptionRequestError(400, "Choose an audio or video file.");
  if (!file.size || file.size > MAX_TRANSCRIPTION_FILE_BYTES) {
    throw new TranscriptionRequestError(413, "File size must be between 1 byte and 50 MB.");
  }
  const mimeType = file.type.toLowerCase().split(";", 1)[0].trim();
  const inspectAs = acceptedMimeTypes[mimeType];
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!inspectAs || !inspectFile(bytes, inspectAs)) {
    throw new TranscriptionRequestError(415, "Unsupported or invalid audio/video file.");
  }
  const rawLanguage = form.get("languageCode");
  if (rawLanguage !== null && typeof rawLanguage !== "string") {
    throw new TranscriptionRequestError(400, "Invalid language code.");
  }
  const languageCode = rawLanguage?.trim().toLowerCase() || undefined;
  if (languageCode && !/^[a-z]{2,3}$/.test(languageCode)) {
    throw new TranscriptionRequestError(400, "Use a two- or three-letter language code.");
  }
  const rawDiarize = form.get("diarize");
  if (rawDiarize !== null && rawDiarize !== "true" && rawDiarize !== "false") {
    throw new TranscriptionRequestError(400, "Invalid speaker-label setting.");
  }
  return {
    bytes, filename: (file.name || "upload").replace(/[\\/\r\n\x00-\x1f]/g, "_").slice(0, 240),
    mimeType, languageCode, diarize: rawDiarize === "true"
  };
}
