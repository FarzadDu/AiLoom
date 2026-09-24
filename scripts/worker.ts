import { resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "../src/server/db";
import { runMediaWorkerCycle } from "../src/server/media/worker";

migrate(getDb(), { migrationsFolder: resolve(process.cwd(), "src/server/db/migrations") });
let stopped = false;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

console.log("Ailoom media worker ready.");
while (!stopped) {
  try { await runMediaWorkerCycle(); }
  catch { console.error("Ailoom media worker cycle failed; will retry."); }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
