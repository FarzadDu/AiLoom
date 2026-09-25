import { randomUUID } from "node:crypto";
import { readFile, mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const WORKER_NAMES = ["media", "renderer", "lora", "dubbing"] as const;
export type WorkerName = typeof WORKER_NAMES[number];

const HEARTBEAT_INTERVAL_MS = 5_000;
const MAX_HEARTBEAT_AGE_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;

export type WorkerHeartbeat = {
  version: 1;
  worker: WorkerName;
  updatedAt: number;
  consecutiveFailures: number;
  state: "starting" | "working" | "idle" | "error" | "stopped";
};

function heartbeatPath(worker: WorkerName, mediaDirectory?: string): string {
  const root = resolve(/* turbopackIgnore: true */ (mediaDirectory ?? process.env.MEDIA_DIR?.trim()) || "data/media");
  return join(root, ".worker-health", `${worker}.json`);
}

export async function writeWorkerHeartbeat(heartbeat: WorkerHeartbeat, mediaDirectory?: string): Promise<void> {
  const destination = heartbeatPath(heartbeat.worker, mediaDirectory);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, JSON.stringify(heartbeat), { flag: "wx", mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

/** A heartbeat proves the loop is responsive and has not failed repeatedly. */
export async function workerHealthy(worker: WorkerName, options: {
  mediaDirectory?: string; now?: number
} = {}): Promise<boolean> {
  try {
    const path = heartbeatPath(worker, options.mediaDirectory);
    const info = await stat(path);
    if (!info.isFile() || info.size > 512) return false;
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const heartbeat = value as Partial<WorkerHeartbeat>;
    const age = (options.now ?? Date.now()) - (heartbeat.updatedAt ?? NaN);
    return heartbeat.version === 1 && heartbeat.worker === worker &&
      Number.isSafeInteger(heartbeat.updatedAt) && age >= -5_000 && age <= MAX_HEARTBEAT_AGE_MS &&
      Number.isSafeInteger(heartbeat.consecutiveFailures) &&
      heartbeat.consecutiveFailures! >= 0 && heartbeat.consecutiveFailures! < MAX_CONSECUTIVE_FAILURES &&
      (heartbeat.state === "starting" || heartbeat.state === "working" ||
        heartbeat.state === "idle" || heartbeat.state === "error");
  } catch {
    return false;
  }
}

/** Write one file per process in the shared media volume; never include jobs or credentials. */
export function observeWorker(worker: WorkerName): {
  cycleStarted(): void;
  cycleSucceeded(): void;
  cycleFailed(): void;
  stop(): Promise<void>;
} {
  let state: WorkerHeartbeat["state"] = "starting";
  let consecutiveFailures = 0;
  let writing = Promise.resolve();
  let writeFailed = false;
  const publish = () => {
    const snapshot: WorkerHeartbeat = { version: 1, worker, updatedAt: Date.now(),
      consecutiveFailures, state };
    writing = writing.then(async () => {
      try {
        await writeWorkerHeartbeat(snapshot);
        writeFailed = false;
      } catch {
        if (!writeFailed) console.error(`Ailoom ${worker} worker health write failed.`);
        writeFailed = true;
      }
    });
    return writing;
  };
  void publish();
  const interval = setInterval(() => { void publish(); }, HEARTBEAT_INTERVAL_MS);
  interval.unref();
  return {
    cycleStarted() { state = "working"; void publish(); },
    cycleSucceeded() { state = "idle"; consecutiveFailures = 0; void publish(); },
    cycleFailed() { state = "error"; consecutiveFailures++; void publish(); },
    async stop() { clearInterval(interval); state = "stopped"; await publish(); }
  };
}
