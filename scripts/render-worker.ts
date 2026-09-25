import { resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "../src/server/db";
import { runStoryboardWorkerCycle } from "../src/server/media/worker";

migrate(getDb(), { migrationsFolder: resolve(process.cwd(), "src/server/db/migrations") });
let stopped = false;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

console.log("Ailoom storyboard renderer ready.");
while (!stopped) {
  try { await runStoryboardWorkerCycle(); }
  catch { console.error("Ailoom storyboard renderer cycle failed; will retry."); }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
