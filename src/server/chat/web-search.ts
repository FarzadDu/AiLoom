import { isIP } from "node:net";
import type { ChatMessage } from "../providers/openrouter";
import { OpenRouterError } from "../providers/openrouter";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export type WebSearchSource = {
  url: string;
  title: string;
};

export type WebSearchAnswer = {
  answer: string;
  sources: WebSearchSource[];
};

export type WebSearchRequest = {
  query: string;
  history?: ChatMessage[];
  model: string;
  signal?: AbortSignal;
  siteUrl?: string;
  apiKey?: string;
  fetcher?: typeof fetch;
};

export class WebSearchGroundingError extends Error {
  constructor() {
    super("The web search response did not include verifiable source citations.");
    this.name = "WebSearchGroundingError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validWebUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    if (!["https:", "http:"].includes(url.protocol) || !host || !host.includes(".")) return null;
    if (url.username || url.password || isIP(host) || host === "localhost" ||
      host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function cleanTitle(value: unknown, url: string): string {
  const title = typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240)
    : "";
  return title || new URL(url).hostname;
}

/** Only provider-native url_citation annotations become displayed sources. */
export function extractWebSearchSources(annotations: unknown): WebSearchSource[] {
  if (!Array.isArray(annotations)) return [];
  const result: WebSearchSource[] = [];
  const seen = new Set<string>();
  for (const raw of annotations) {
    const annotation = record(raw);
    if (annotation?.type !== "url_citation") continue;
    // OpenRouter's Chat Completions schema nests citation fields in url_citation.
    // Some native provider adapters return the same fields directly instead.
    const citation = record(annotation.url_citation) ?? annotation;
    const url = validWebUrl(citation.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push({ url, title: cleanTitle(citation.title, url) });
    if (result.length >= 25) break;
  }
  return result;
}

function completionMessage(value: unknown): Record<string, unknown> | null {
  const body = record(value);
  if (!Array.isArray(body?.choices)) return null;
  return record(record(body.choices[0])?.message);
}

/**
 * Answers a chat query with OpenRouter's server-side web search tool. The result
 * is returned only if the provider supplies at least one valid url_citation.
 * Callers should render the structured sources, not scrape links from answer.
 */
export async function answerWithWebSearch(request: WebSearchRequest): Promise<WebSearchAnswer> {
  const query = request.query.trim();
  const model = request.model.trim();
  if (!query || query.length > 40_000 || !model || model.length > 200) {
    throw new Error("Invalid web search request.");
  }
  const apiKey = request.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OpenRouter is not configured.");

  const response = await (request.fetcher || fetch)(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Ailoom",
      ...(request.siteUrl ? { "HTTP-Referer": request.siteUrl } : {})
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Use the web search tool to answer the latest user question. Ground factual claims in the search results. If search results do not support an answer, say so. Do not invent sources or URLs." },
        ...(request.history ?? []),
        { role: "user", content: query }
      ],
      tools: [{
        type: "openrouter:web_search",
        parameters: { max_results: 5, max_total_results: 10, max_uses: 2, max_characters: 2000 }
      }],
      max_tool_calls: 2,
      stream: false
    }),
    signal: request.signal,
    cache: "no-store"
  });
  if (!response.ok) throw new OpenRouterError(response.status);

  let body: unknown;
  try { body = await response.json(); } catch { throw new Error("OpenRouter returned an invalid web search response."); }
  const message = completionMessage(body);
  if (!message || typeof message.content !== "string" || !message.content.trim() ||
    message.content.length > 200_000) {
    throw new Error("OpenRouter returned an invalid web search response.");
  }
  const sources = extractWebSearchSources(message.annotations);
  if (sources.length === 0) throw new WebSearchGroundingError();
  return { answer: message.content, sources };
}
