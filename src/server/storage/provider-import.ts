import { lookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { detectMediaMime, savePrivateFile } from "./private-files";

const MAX_BYTES = 100_000_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

type ResolvedOutput = { url: URL; address: string; family: 4 | 6 };

export function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || b === 0 && c === 0 || b === 0 && c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (!/^[0-9a-f:]+$/.test(lower)) return false;
  if (lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") ||
      lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") ||
      lower.startsWith("feb") || lower.startsWith("2001:db8:")) return false;
  return /^[23][0-9a-f]{3}:/.test(lower);
}

async function resolveProviderOutputUrl(value: string): Promise<ResolvedOutput> {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port && url.port !== "443" ||
      url.hostname === "localhost" || url.hostname.endsWith(".localhost") ||
      url.hostname.endsWith(".local") || url.hostname.endsWith(".internal") ||
      isIP(url.hostname) !== 0 || url.hostname.startsWith("[")) {
    throw new Error("Unsafe provider output URL.");
  }
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address, family }) =>
    family === 4 ? !isPublicIpv4(address) : family === 6 ? !isPublicIpv6(address) : true)) {
    throw new Error("Unsafe provider output address.");
  }
  const selected = addresses[0];
  return { url, address: selected.address, family: selected.family as 4 | 6 };
}

export async function validateProviderOutputUrl(value: string): Promise<URL> {
  return (await resolveProviderOutputUrl(value)).url;
}

/** Node's HTTPS client keeps the URL host for Host, SNI and certificate checks;
 * only the TCP lookup is replaced with the already validated address. */
export function pinnedHttpsRequestOptions(url: URL, address: string, family: 4 | 6): RequestOptions {
  if (url.protocol !== "https:" || isIP(url.hostname) !== 0 || url.hostname.startsWith("[") ||
      !(family === 4 ? isPublicIpv4(address) : isPublicIpv6(address))) {
    throw new Error("Unsafe provider output address.");
  }
  const hostname = url.hostname;
  return {
    method: "GET",
    agent: false,
    family,
    servername: hostname,
    rejectUnauthorized: true,
    headers: { "Accept-Encoding": "identity" },
    lookup: (requestedHost, options, callback) => {
      if (requestedHost.toLowerCase() !== hostname) {
        callback(new Error("Unsafe provider output host."), "");
        return;
      }
      if (options.all) callback(null, [{ address, family }]);
      else callback(null, address, family);
    }
  };
}

async function pinnedHttpsResponse(target: ResolvedOutput): Promise<Response> {
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(target.url, {
      ...pinnedHttpsRequestOptions(target.url, target.address, target.family),
      signal,
      timeout: DOWNLOAD_TIMEOUT_MS
    }, response => {
      // Node's HTTPS client never follows redirects automatically. Accepting only
      // 200 also rejects any redirect or unexpected partial response explicitly.
      if (response.statusCode !== 200) {
        response.destroy();
        reject(new Error("Provider output could not be downloaded."));
        return;
      }
      const length = response.headers["content-length"];
      const headers = typeof length === "string" ? { "Content-Length": length } : undefined;
      resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, { status: 200, headers }));
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("Provider output download timed out.")));
    request.end();
  });
}

async function limitedBytes(response: Response): Promise<Buffer> {
  if (!response.ok || !response.body) throw new Error("Provider output could not be downloaded.");
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) throw new Error("Provider output is too large.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw new Error("Provider output is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export async function importProviderMedia(url: string, expectedKind: "image" | "video" | "audio", fetcher: typeof fetch = fetch) {
  const target = await resolveProviderOutputUrl(url);
  // The injectable fetcher is used by unit tests; real downloads always use the
  // pinned HTTPS connection so DNS cannot change between validation and connect.
  const response = fetcher === fetch ? await pinnedHttpsResponse(target) : await fetcher(target.url, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  });
  const bytes = await limitedBytes(response);
  const mimeType = detectMediaMime(bytes, expectedKind);
  if (!mimeType) throw new Error("Provider output has an unsupported media format.");
  return savePrivateFile(bytes, mimeType);
}

