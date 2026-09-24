import { resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "../src/server/db";

const migrationsFolder = resolve(process.cwd(), "src/server/db/migrations");
migrate(getDb(), { migrationsFolder });
console.log("Ailoom database migrations applied.");
