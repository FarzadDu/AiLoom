import { getSqlite } from "@/server/db";
import { WORKER_NAMES, workerHealthy } from "@/server/worker-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(healthy: boolean): Response {
  return Response.json({ status: healthy ? "ok" : "unavailable" }, {
    status: healthy ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }
  });
}

/** Public, detail-free readiness check. Compose uses web scope to avoid a worker startup cycle. */
export async function GET(request: Request): Promise<Response> {
  try {
    // The schema query fails if the database is missing, locked, or not migrated.
    getSqlite().prepare("SELECT 1 FROM user LIMIT 1").get();
    if (new URL(request.url).searchParams.get("scope") === "web") return response(true);
    const states = await Promise.all(WORKER_NAMES.map(worker => workerHealthy(worker)));
    return response(states.every(Boolean));
  } catch {
    return response(false);
  }
}
