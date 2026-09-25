import { resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "../src/server/db";
import { runLoraWorkerCycle } from "../src/server/lora/worker";

migrate(getDb(), { migrationsFolder: resolve(process.cwd(), "src/server/db/migrations") });
let stopped = false;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });
console.log("Ailoom LoRA worker ready.");
while (!stopped) {
  try { await runLoraWorkerCycle(); }
  catch { console.error("Ailoom LoRA worker cycle failed; will retry."); }
  await new Promise(resolve => setTimeout(resolve, 10_000));
}
