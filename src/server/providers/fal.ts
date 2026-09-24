/**
 * Server-side fal queue adapter. Model input is endpoint-specific; consult its API schema
 * before submitting. The queue keeps a request ID that must be persisted by the caller.
 * https://fal.ai/docs/documentation/model-apis/inference/queue
 */
const BASE_URL = "https://queue.fal.run";
const ENDPOINT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_ERROR_TYPES = new Set([
  "request_timeout", "startup_timeout", "runner_scheduling_failure",
  "runner_connection_timeout", "runner_disconnected", "runner_connection_refused",
  "runner_connection_error", "runner_incomplete_response", "runner_server_error",
  "client_disconnected", "client_cancelled", "bad_request", "internal_error"
]);

export type FalTaskState = "queued" | "running" | "completed" | "failed";
export type FalMediaKind = "image" | "video" | "audio" | "file";
export type FalMediaOutput = {
  kind: FalMediaKind;
  url: string;
  contentType: string | null;
  width: number | null;
  height: number | null;
  fileSize: number | null;
};
export type FalSubmission = {
  requestId: string;
  endpoint: string;
  state: "queued";
  queuePosition: number | null;
};
export type FalTask = {
  requestId: string;
  endpoint: string;
  state: FalTaskState;
  queuePosition: number | null;
  inferenceSeconds: number | null;
  failureType: string | null;
};
export type FalResult = {
  requestId: string;
  endpoint: string;
  outputs: FalMediaOutput[];
  seed: number | null;
};

export class FalError extends Error {
  constructor(
    public readonly status: number,
    public readonly kind: "http" | "transport" | "uncertain_submission" | "invalid_response"
  ) {
    super(kind === "uncertain_submission"
      ? "Fal submission outcome is unknown. Check provider history before retrying."
      : kind === "invalid_response" ? "Fal returned an invalid response."
      : status === 401 || status === 403 ? "Fal authorization failed."
      : status === 402 ? "Fal account needs credit."
      : status === 429 ? "Fal rate limit reached."
      : "Fal request failed.");
    this.name = "FalError";
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
  if (typeof window !== "undefined") throw new Error("Fal adapter must run on the server.");
}

function apiKey(value?: string): string {
  serverOnly();
  const key = value ?? process.env.FAL_KEY;
  if (!key) throw new Error("Fal is not configured.");
  return key;
}

function endpointPath(value: string): string {
  if (!ENDPOINT_PATTERN.test(value) || value.length > 240) {
    throw new Error("Invalid Fal endpoint.");
  }
  return value;
}

// Fal routes submissions to the full model path, but queue control routes
// belong to the app alias. Keep the optional workflow/comfy namespace.
function queueControlPath(endpoint: string): string {
  const parts = endpoint.split("/");
  return (parts[0] === "workflows" || parts[0] === "comfy")
    ? parts.slice(0, 3).join("/")
    : parts.slice(0, 2).join("/");
}

function requestId(value: string): string {
  if (!ID_PATTERN.test(value)) throw new Error("Invalid Fal request ID.");
  return value;
}

function webhookUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Fal webhook must be a public HTTPS URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Fal webhook must be a public HTTPS URL.");
  }
  return url.toString();
}

function jsonBody(value: unknown): string {
  try { return JSON.stringify(value); }
  catch { throw new Error("Fal input must be JSON serializable."); }
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
      Authorization: "Key " + apiKey(options.apiKey),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body }),
    signal: options.signal,
    cache: "no-store"
  };
  let response: Response;
  try { response = await (options.fetcher ?? fetch)(url, init); }
  catch { throw new FalError(0, method === "POST" ? "uncertain_submission" : "transport"); }
  if (!response.ok) throw new FalError(response.status, "http");
  try {
    const data: unknown = await response.json();
    const parsed = record(data);
    if (parsed) return parsed;
  } catch {
    // Upstream bodies can contain prompts or secrets. Never include them in errors.
  }
  throw new FalError(response.status, method === "POST" ? "uncertain_submission" : "invalid_response");
}

export async function submitFalTask(options: RequestOptions & {
  endpoint: string;
  input: Record<string, unknown>;
  webhookUrl?: string;
}): Promise<FalSubmission> {
  const endpoint = endpointPath(options.endpoint);
  if (!record(options.input)) throw new Error("Fal input must be an object.");
  // sync_mode can return a data URI without a durable queue result.
  if (options.input.sync_mode === true) throw new Error("Fal sync_mode is not supported by the queue adapter.");
  const url = new URL(BASE_URL + "/" + endpoint);
  if (options.webhookUrl) url.searchParams.set("fal_webhook", webhookUrl(options.webhookUrl));
  const data = await requestJson(url.toString(), options, "POST", jsonBody(options.input));
  if (typeof data.request_id !== "string" || !ID_PATTERN.test(data.request_id)) {
    throw new FalError(200, "uncertain_submission");
  }
  return {
    requestId: data.request_id,
    endpoint,
    state: "queued",
    queuePosition: nonnegativeInteger(data.queue_position)
  };
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function nonnegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export async function getFalTask(options: RequestOptions & {
  endpoint: string;
  requestId: string;
}): Promise<FalTask> {
  const endpoint = endpointPath(options.endpoint);
  const id = requestId(options.requestId);
  const url = BASE_URL + "/" + queueControlPath(endpoint) + "/requests/" + encodeURIComponent(id) + "/status?logs=0";
  const data = await requestJson(url, options, "GET");
  if (data.request_id !== id) throw new FalError(200, "invalid_response");
  const providerState = data.status;
  if (providerState !== "IN_QUEUE" && providerState !== "IN_PROGRESS" && providerState !== "COMPLETED") {
    throw new FalError(200, "invalid_response");
  }
  const failure = typeof data.error === "string" && data.error.length > 0;
  const failureType = typeof data.error_type === "string" && data.error_type.length > 0
    ? SAFE_ERROR_TYPES.has(data.error_type) ? data.error_type : "unknown" : null;
  const metrics = record(data.metrics);
  return {
    requestId: id,
    endpoint,
    state: providerState === "IN_QUEUE" ? "queued"
      : providerState === "IN_PROGRESS" ? "running"
      : failure || failureType ? "failed" : "completed",
    queuePosition: providerState === "IN_QUEUE" ? nonnegativeInteger(data.queue_position) : null,
    inferenceSeconds: metrics ? nonnegativeNumber(metrics.inference_time) : null,
    failureType: failureType
  };
}

function mediaUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

function mediaOutput(kind: FalMediaKind, value: unknown): FalMediaOutput | null {
  const data = record(value);
  const url = mediaUrl(data?.url ?? value);
  if (!url) return null;
  return {
    kind,
    url,
    contentType: typeof data?.content_type === "string" ? data.content_type : null,
    width: nonnegativeInteger(data?.width),
    height: nonnegativeInteger(data?.height),
    fileSize: nonnegativeInteger(data?.file_size)
  };
}

function mediaOutputs(data: Record<string, unknown>): FalMediaOutput[] {
  const outputs: FalMediaOutput[] = [];
  const groups: Array<[string, FalMediaKind]> = [
    ["images", "image"], ["videos", "video"], ["audios", "audio"], ["files", "file"]
  ];
  for (const [name, kind] of groups) {
    const values = data[name];
    if (Array.isArray(values)) {
      for (const value of values) {
        const output = mediaOutput(kind, value);
        if (output) outputs.push(output);
      }
    }
  }
  const singles: Array<[string, FalMediaKind]> = [
    ["image", "image"], ["video", "video"], ["audio", "audio"], ["file", "file"],
    ["image_url", "image"], ["video_url", "video"], ["audio_url", "audio"]
  ];
  for (const [name, kind] of singles) {
    if (data[name] === undefined) continue;
    const output = mediaOutput(kind, data[name]);
    if (output) outputs.push(output);
  }
  return [...new Map(outputs.map(output => [output.url, output])).values()];
}

export async function getFalResult(options: RequestOptions & {
  endpoint: string;
  requestId: string;
}): Promise<FalResult> {
  const endpoint = endpointPath(options.endpoint);
  const id = requestId(options.requestId);
  const url = BASE_URL + "/" + queueControlPath(endpoint) + "/requests/" + encodeURIComponent(id);
  const data = await requestJson(url, options, "GET");
  return {
    requestId: id,
    endpoint,
    outputs: mediaOutputs(data),
    seed: nonnegativeInteger(data.seed)
  };
}
