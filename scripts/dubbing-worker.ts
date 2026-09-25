import { resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "../src/server/db";
import { runDubbingWorkerCycle } from "../src/server/dubbing/worker";
import { observeWorker } from "../src/server/worker-health";

migrate(getDb(), { migrationsFolder: resolve(process.cwd(), "src/server/db/migrations") });
let stopped = false;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

console.log("Ailoom dubbing worker ready.");
const health = observeWorker("dubbing");
while (!stopped) {
  health.cycleStarted();
  try { await runDubbingWorkerCycle(); health.cycleSucceeded(); }
  catch { health.cycleFailed(); console.error("Ailoom dubbing worker cycle failed; will retry."); }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
await health.stop();
