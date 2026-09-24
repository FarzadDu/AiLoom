/**
 * Server-side WaveSpeed prediction adapter. Model input and output schemas vary by endpoint.
 * The caller must persist the prediction ID and handle webhook signature verification separately.
 * https://wavespeed.ai/docs/what-are-predictions
 */
const BASE_URL = "https://api.wavespeed.ai/api/v3";
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type WaveSpeedTaskState = "queued" | "running" | "completed" | "failed";
export type WaveSpeedProviderStatus = "created" | "processing" | "completed" | "failed" | "cancelled" | "timeout" | "deleted" | "unknown";
export type WaveSpeedOutput =
  | { kind: "media"; url: string; contentType: string | null }
  | { kind: "text"; text: string }
  | { kind: "data"; value: Record<string, unknown> };
export type WaveSpeedTask = {
  predictionId: string;
  model: string | null;
  state: WaveSpeedTaskState;
  providerStatus: WaveSpeedProviderStatus;
  outputs: WaveSpeedOutput[];
  inferenceMs: number | null;
};

export class WaveSpeedError extends Error {
  constructor(
    public readonly status: number,
    public readonly kind: "http" | "transport" | "uncertain_submission" | "invalid_response",
    public readonly providerCode: number | null = null
  ) {
    super(kind === "uncertain_submission"
      ? "WaveSpeed submission outcome is unknown. Check provider history before retrying."
      : kind === "invalid_response" ? "WaveSpeed returned an invalid response."
      : status === 401 || status === 403 ? "WaveSpeed authorization failed."
      : status === 402 ? "WaveSpeed account needs credit."
      : status === 429 ? "WaveSpeed rate limit reached."
      : "WaveSpeed request failed.");
    this.name = "WaveSpeedError";
  }
}

type RequestOptions = {
  apiKey?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function serverOnly(): void {
  if (typeof window !== "undefined") throw new Error("WaveSpeed adapter must run on the server.");
}

function apiKey(value?: string): string {
  serverOnly();
  const key = value ?? process.env.WAVESPEED_API_KEY;
  if (!key) throw new Error("WaveSpeed is not configured.");
  return key;
}

function modelPath(value: string): string {
  if (!MODEL_PATTERN.test(value) || value.length > 240) {
    throw new Error("Invalid WaveSpeed model.");
  }
  return value;
}

function predictionId(value: string): string {
  if (!ID_PATTERN.test(value)) throw new Error("Invalid WaveSpeed prediction ID.");
  return value;
}

function webhookUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("WaveSpeed webhook must be a public HTTPS URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("WaveSpeed webhook must be a public HTTPS URL.");
  }
  return url.toString();
}

function jsonBody(value: unknown): string {
  try { return JSON.stringify(value); }
  catch { throw new Error("WaveSpeed input must be JSON serializable."); }
}

async function requestJson(
  url: string,
  options: RequestOptions,
  method: "GET" | "POST",
  body?: string
): Promise<Record<string, unknown>> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: "Bearer " + apiKey(options.apiKey),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body }),
    signal: options.signal,
    cache: "no-store"
  };
  let response: Response;
  try { response = await (options.fetcher ?? fetch)(url, init); }
  catch { throw new WaveSpeedError(0, method === "POST" ? "uncertain_submission" : "transport"); }
  if (!response.ok) throw new WaveSpeedError(response.status, "http");
  let payload: Record<string, unknown> | null = null;
  try { payload = record(await response.json()); }
  catch {
    // Never copy upstream bodies into application errors.
  }
  if (!payload) {
    throw new WaveSpeedError(response.status, method === "POST" ? "uncertain_submission" : "invalid_response");
  }
  if (payload.code !== 200) {
    const code = typeof payload.code === "number" && Number.isInteger(payload.code) ? payload.code : null;
    throw new WaveSpeedError(response.status, "http", code);
  }
  return payload;
}

function nonnegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function httpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

function normalizeOutput(value: unknown): WaveSpeedOutput | null {
  if (typeof value === "string") {
    const url = httpsUrl(value);
    return url ? { kind: "media", url, contentType: null } : { kind: "text", text: value };
  }
  const data = record(value);
  if (!data) return null;
  if (typeof data.url === "string") {
    const url = httpsUrl(data.url);
    if (url) {
      return {
        kind: "media",
        url,
        contentType: typeof data.content_type === "string" ? data.content_type : null
      };
    }
  }
  return { kind: "data", value: data };
}

function normalizeTask(data: Record<string, unknown>, expectedId?: string): WaveSpeedTask {
  if (typeof data.id !== "string" || !ID_PATTERN.test(data.id) ||
      expectedId && data.id !== expectedId || typeof data.status !== "string") {
    throw new WaveSpeedError(200, "invalid_response");
  }
  const status = data.status;
  const knownStatus: WaveSpeedProviderStatus = status === "created" || status === "processing" ||
    status === "completed" || status === "failed" || status === "cancelled" ||
    status === "timeout" || status === "deleted" ? status : "unknown";
  const state: WaveSpeedTaskState = status === "created" ? "queued"
    : status === "completed" ? "completed"
    : status === "failed" || status === "cancelled" || status === "timeout" || status === "deleted"
      ? "failed" : "running";
  if (data.outputs !== undefined && !Array.isArray(data.outputs)) {
    throw new WaveSpeedError(200, "invalid_response");
  }
  const outputs = state === "completed"
    ? ((data.outputs ?? []) as unknown[]).map(normalizeOutput).filter((item): item is WaveSpeedOutput => item !== null)
    : [];
  const timings = record(data.timings);
  return {
    predictionId: data.id,
    model: typeof data.model === "string" ? data.model : null,
    state,
    providerStatus: knownStatus,
    outputs,
    inferenceMs: timings ? nonnegativeNumber(timings.inference) : null
  };
}

export async function submitWaveSpeedTask(options: RequestOptions & {
  model: string;
  input: Record<string, unknown>;
  webhookUrl?: string;
}): Promise<WaveSpeedTask> {
  const model = modelPath(options.model);
  if (!record(options.input)) throw new Error("WaveSpeed input must be an object.");
  // Sync mode can outlive a client timeout and obscure the accepted prediction ID.
  if (options.input.enable_sync_mode === true) {
    throw new Error("WaveSpeed enable_sync_mode is not supported by the prediction adapter.");
  }
  if (options.input.enable_base64_output === true) {
    throw new Error("WaveSpeed base64 outputs are not supported by the prediction adapter.");
  }
  const url = new URL(BASE_URL + "/" + model);
  if (options.webhookUrl) url.searchParams.set("webhook", webhookUrl(options.webhookUrl));
  const payload = await requestJson(url.toString(), options, "POST", jsonBody(options.input));
  const data = record(payload.data);
  if (!data) throw new WaveSpeedError(200, "uncertain_submission");
  try {
    const task = normalizeTask(data);
    return { ...task, model: task.model ?? model };
  } catch (error) {
    if (error instanceof WaveSpeedError && error.kind === "invalid_response") {
      throw new WaveSpeedError(200, "uncertain_submission");
    }
    throw error;
  }
}

export async function getWaveSpeedTask(options: RequestOptions & {
  predictionId: string;
}): Promise<WaveSpeedTask> {
  const id = predictionId(options.predictionId);
  const url = BASE_URL + "/predictions/" + encodeURIComponent(id) + "/result";
  const payload = await requestJson(url, options, "GET");
  const data = record(payload.data);
  if (!data) throw new WaveSpeedError(200, "invalid_response");
  return normalizeTask(data, id);
}
