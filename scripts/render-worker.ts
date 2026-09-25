import { resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "../src/server/db";
import { runStoryboardWorkerCycle } from "../src/server/media/worker";
import { observeWorker } from "../src/server/worker-health";

migrate(getDb(), { migrationsFolder: resolve(process.cwd(), "src/server/db/migrations") });
let stopped = false;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

console.log("Ailoom storyboard renderer ready.");
const health = observeWorker("renderer");
while (!stopped) {
  health.cycleStarted();
  try { await runStoryboardWorkerCycle(); health.cycleSucceeded(); }
  catch { health.cycleFailed(); console.error("Ailoom storyboard renderer cycle failed; will retry."); }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
await health.stop();
