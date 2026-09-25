import { resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "../src/server/db";
import { runLoraWorkerCycle } from "../src/server/lora/worker";
import { observeWorker } from "../src/server/worker-health";

migrate(getDb(), { migrationsFolder: resolve(process.cwd(), "src/server/db/migrations") });
let stopped = false;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });
console.log("Ailoom LoRA worker ready.");
const health = observeWorker("lora");
while (!stopped) {
  health.cycleStarted();
  try { await runLoraWorkerCycle(); health.cycleSucceeded(); }
  catch { health.cycleFailed(); console.error("Ailoom LoRA worker cycle failed; will retry."); }
  await new Promise(resolve => setTimeout(resolve, 10_000));
}
await health.stop();
