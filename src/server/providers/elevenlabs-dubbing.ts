import { z } from "zod";

const BASE_URL = "https://api.elevenlabs.io";
const providerId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const projectResponse = z.object({
  project_id: providerId,
  status: z.enum(["queued", "preparing", "processing", "ready", "failed"]),
  language_ids: z.array(providerId).optional()
}).passthrough();
const languageResponse = z.object({
  project_id: providerId,
  language_id: providerId,
  status: z.enum(["queued", "processing", "completed", "stale", "failed"]),
  outputs: z.object({ lossless_audio: z.url().optional() }).passthrough().nullable().optional()
}).passthrough();

export class DubbingProviderError extends Error {
  constructor(public readonly status: number) {
    super("ElevenLabs dubbing request failed.");
    this.name = "DubbingProviderError";
  }
}

function apiKey(value?: string) {
  const key = value || process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new Error("ElevenLabs is not configured.");
  return key;
}

/** Current Dubbing v2 API. Project creation prepays the first language. */
export async function createDubbingProject(options: {
  requestId: string;
  sourceUrl: string;
  sourceLanguage: string | null;
  targetLanguage: string;
  apiKey?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}) {
  const form = new FormData();
  form.set("reference", `Ailoom:${options.requestId}`);
  form.set("source_url", options.sourceUrl);
  form.set("model_id", "dubbing_v2");
  form.set("target_language", options.targetLanguage);
  if (options.sourceLanguage) form.set("source_language", options.sourceLanguage);
  const response = await (options.fetcher ?? fetch)(`${BASE_URL}/v1/dubbing/project`, {
    method: "POST", headers: { "xi-api-key": apiKey(options.apiKey) },
    body: form, signal: options.signal ?? AbortSignal.timeout(75_000), cache: "no-store"
  });
  if (!response.ok) throw new DubbingProviderError(response.status);
  const body = projectResponse.parse(await response.json());
  const languageId = body.language_ids?.[0];
  if (!languageId || body.language_ids?.length !== 1) {
    // A charge might already have occurred; the worker must never POST again.
    throw new Error("ElevenLabs did not return the first language target.");
  }
  return { projectId: body.project_id, languageId, status: body.status };
}

export async function getDubbingProject(options: {
  projectId: string; apiKey?: string; fetcher?: typeof fetch; signal?: AbortSignal;
}) {
  const id = providerId.parse(options.projectId);
  const response = await (options.fetcher ?? fetch)(`${BASE_URL}/v1/dubbing/project/${encodeURIComponent(id)}`, {
    headers: { "xi-api-key": apiKey(options.apiKey) },
    signal: options.signal ?? AbortSignal.timeout(20_000), cache: "no-store"
  });
  if (!response.ok) throw new DubbingProviderError(response.status);
  const body = projectResponse.parse(await response.json());
  if (body.project_id !== id) throw new Error("ElevenLabs returned another dubbing project.");
  return { status: body.status, languageIds: body.language_ids ?? [] };
}

/** Read-only recovery for an uncertain paid POST, matched by our exact UUID reference. */
export async function findDubbingProjectByReference(options: {
  requestId: string; apiKey?: string; fetcher?: typeof fetch; signal?: AbortSignal;
}): Promise<string | null> {
  const reference = `Ailoom:${z.uuid().parse(options.requestId)}`;
  let cursor: string | null = null;
  let match: string | null = null;
  for (let page = 0; page < 10; page++) {
    const url = new URL(`${BASE_URL}/v1/dubbing/project`);
    url.searchParams.set("page_size", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await (options.fetcher ?? fetch)(url, {
      headers: { "xi-api-key": apiKey(options.apiKey) },
      signal: options.signal ?? AbortSignal.timeout(20_000), cache: "no-store"
    });
    if (!response.ok) throw new DubbingProviderError(response.status);
    const body = z.object({ projects: z.array(z.object({ project_id: providerId,
      reference: z.string().nullable().optional() }).passthrough()),
      next_cursor: z.string().nullable().optional() }).passthrough().parse(await response.json());
    for (const project of body.projects) {
      if (project.reference !== reference) continue;
      if (match && match !== project.project_id) throw new Error("Multiple dubbing projects match this request.");
      match = project.project_id;
    }
    cursor = body.next_cursor ?? null;
    if (!cursor) return match;
  }
  // An incomplete search cannot prove there is no project.
  throw new Error("Dubbing project search exceeded the safe page limit.");
}

/** Fetching a completed target again refreshes its signed lossless_audio URL. */
export async function getDubbingLanguage(options: {
  projectId: string; languageId: string;
  apiKey?: string; fetcher?: typeof fetch; signal?: AbortSignal;
}) {
  const projectId = providerId.parse(options.projectId);
  const languageId = providerId.parse(options.languageId);
  const response = await (options.fetcher ?? fetch)(
    `${BASE_URL}/v1/dubbing/project/${encodeURIComponent(projectId)}/language/${encodeURIComponent(languageId)}`, {
      headers: { "xi-api-key": apiKey(options.apiKey) },
      signal: options.signal ?? AbortSignal.timeout(20_000), cache: "no-store"
    });
  if (!response.ok) throw new DubbingProviderError(response.status);
  const body = languageResponse.parse(await response.json());
  if (body.project_id !== projectId || body.language_id !== languageId) {
    throw new Error("ElevenLabs returned another dubbing target.");
  }
  return { status: body.status, losslessAudioUrl: body.outputs?.lossless_audio ?? null };
}
