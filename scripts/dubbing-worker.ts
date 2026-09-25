import { resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "../src/server/db";
import { runDubbingWorkerCycle } from "../src/server/dubbing/worker";

migrate(getDb(), { migrationsFolder: resolve(process.cwd(), "src/server/db/migrations") });
let stopped = false;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

console.log("Ailoom dubbing worker ready.");
while (!stopped) {
  try { await runDubbingWorkerCycle(); }
  catch { console.error("Ailoom dubbing worker cycle failed; will retry."); }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
