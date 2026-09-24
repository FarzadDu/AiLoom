import { z } from "zod";

export const CONTENT_JSON_LIMIT = 1_000_000;

export class BoundedJsonError extends Error {
  constructor(public readonly status: 400 | 413, message: string) {
    super(message);
    this.name = "BoundedJsonError";
  }
}

/** Enforce the byte limit while streaming; Content-Length can be absent or false. */
export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Invalid JSON body limit.");
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader !== null) {
    const length = Number(lengthHeader);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new BoundedJsonError(400, "Invalid request length.");
    }
    if (length > maxBytes) throw new BoundedJsonError(413, "Request too large.");
  }
  if (!request.body) throw new BoundedJsonError(400, "Invalid JSON request.");

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
        throw new BoundedJsonError(413, "Request too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total)));
  } catch {
    throw new BoundedJsonError(400, "Invalid JSON request.");
  }
}

export async function parseBoundedJson<S extends z.ZodType>(request: Request, schema: S,
  maxBytes: number, invalidMessage: string): Promise<
  { success: true; data: z.output<S> } | { success: false; response: Response }
> {
  try {
    const parsed = schema.safeParse(await readBoundedJson(request, maxBytes));
    if (parsed.success) return { success: true, data: parsed.data };
    return { success: false, response: Response.json({ error: invalidMessage }, { status: 400 }) };
  } catch (error) {
    const oversized = error instanceof BoundedJsonError && error.status === 413;
    return { success: false, response: Response.json({ error: oversized ? "Request too large." : invalidMessage },
      { status: oversized ? 413 : 400 }) };
  }
}
