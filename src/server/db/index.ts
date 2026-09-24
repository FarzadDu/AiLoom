import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

let sqlite: SQLite.Database | undefined;
let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function databasePath(): string {
  return resolve(process.env.DATABASE_PATH?.trim() || "data/ailoom.sqlite");
}

export function getSqlite(): SQLite.Database {
  if (!sqlite) {
    const path = databasePath();
    mkdirSync(dirname(path), { recursive: true });
    sqlite = new SQLite(path);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");
  }
  return sqlite;
}

export function getDb() {
  db ??= drizzle({ client: getSqlite(), schema });
  return db;
}
