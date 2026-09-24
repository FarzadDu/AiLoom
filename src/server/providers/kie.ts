const BASE_URL = "https://api.kie.ai/api/v1/jobs";

export type KieTaskState = "waiting" | "queuing" | "generating" | "success" | "fail";

export type KieTask = {
  taskId: string;
  model: string | null;
  state: KieTaskState;
  resultUrls: string[];
  progress: number | null;
  creditsConsumed: number | null;
  failureMessage: string | null;
};

export class KieError extends Error {
  constructor(public readonly status: number) {
    super(status === 401 ? "Kie API key is invalid." : status === 429
      ? "Kie rate limit reached." : "Kie request failed.");
    this.name = "KieError";
  }
}

function apiKey(value?: string): string {
  const key = value || process.env.KIE_API_KEY;
  if (!key) throw new Error("Kie is not configured.");
  return key;
}

function headers(key: string): HeadersInit {
  return { Authorization: "Bearer " + key, "Content-Type": "application/json" };
}

export async function createKieTask(options: {
  model: string;
  input: Record<string, unknown>;
  callbackUrl?: string;
  apiKey?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<string> {
  const response = await (options.fetcher || fetch)(BASE_URL + "/createTask", {
    method: "POST",
    headers: headers(apiKey(options.apiKey)),
    body: JSON.stringify({
      model: options.model,
      input: options.input,
      ...(options.callbackUrl ? { callBackUrl: options.callbackUrl } : {})
    }),
    signal: options.signal,
    cache: "no-store"
  });
  if (!response.ok) throw new KieError(response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("data" in payload) ||
      !payload.data || typeof payload.data !== "object" ||
      !("taskId" in payload.data) || typeof payload.data.taskId !== "string") {
    throw new Error("Kie returned an invalid task ID.");
  }
  return payload.data.taskId;
}

function resultUrls(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || !("resultUrls" in parsed) ||
        !Array.isArray(parsed.resultUrls)) return [];
    return parsed.resultUrls.filter((url): url is string => typeof url === "string");
  } catch {
    return [];
  }
}

export async function getKieTask(options: {
  taskId: string;
  apiKey?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<KieTask> {
  const url = BASE_URL + "/recordInfo?taskId=" + encodeURIComponent(options.taskId);
  const response = await (options.fetcher || fetch)(url, {
    headers: headers(apiKey(options.apiKey)),
    signal: options.signal,
    cache: "no-store"
  });
  if (!response.ok) throw new KieError(response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("data" in payload) ||
      !payload.data || typeof payload.data !== "object") {
    throw new Error("Kie returned an invalid task status.");
  }
  const data = payload.data as Record<string, unknown>;
  const state = data.state;
  if (typeof data.taskId !== "string" || data.taskId !== options.taskId ||
      state !== "waiting" && state !== "queuing" && state !== "generating" &&
      state !== "success" && state !== "fail") {
    throw new Error("Kie returned an invalid task status.");
  }
  return {
    taskId: data.taskId,
    model: typeof data.model === "string" ? data.model : null,
    state,
    resultUrls: resultUrls(data.resultJson),
    progress: typeof data.progress === "number" ? data.progress : null,
    creditsConsumed: typeof data.creditsConsumed === "number" ? data.creditsConsumed : null,
    failureMessage: state === "fail" && typeof data.failMsg === "string" ? data.failMsg : null
  };
}
