export class MultipartBodyError extends Error {
  constructor(public readonly status: 400 | 413, message: string) {
    super(message);
    this.name = "MultipartBodyError";
  }
}

/** Read a multipart upload with a real byte limit, including chunked requests. */
export async function readBoundedMultipartForm(request: Request, maxBytes: number): Promise<FormData> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) {
    throw new MultipartBodyError(400, "Upload a file as multipart form data.");
  }
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader !== null) {
    const length = Number(lengthHeader);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new MultipartBodyError(400, "Invalid upload length.");
    }
    if (length > maxBytes) throw new MultipartBodyError(413, "File is too large.");
  }
  if (!request.body) throw new MultipartBodyError(400, "Choose a file to upload.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new MultipartBodyError(413, "File is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(Buffer.concat(chunks, total), {
      headers: { "content-type": contentType }
    }).formData();
  } catch {
    throw new MultipartBodyError(400, "Choose a file to upload.");
  }
}
