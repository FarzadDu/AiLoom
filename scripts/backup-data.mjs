#!/usr/bin/env node

// Create a consistent SQLite snapshot and copy every private file referenced by
// that snapshot. A backup is complete only after its manifest is written.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import Database from "better-sqlite3";

const DATABASE_FILE = "ailoom.sqlite";
const MANIFEST_FILE = "manifest.json";

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function futureRealPath(path) {
  const missing = [];
  let ancestor = path;
  while (true) {
    try {
      const physical = await realpath(ancestor);
      return resolve(physical, ...missing.reverse());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.push(relative(parent, ancestor));
      ancestor = parent;
    }
  }
}

function safeStorageKey(key) {
  if (typeof key !== "string" || !/^[A-Za-z0-9._/-]{1,500}$/.test(key) ||
      key.startsWith("/") || key.split("/").some(segment => !segment || segment === "." || segment === "..")) {
    throw new Error("Database contains an invalid private media key.");
  }
  return key;
}

function referencedMedia(db) {
  const references = new Map();
  const add = (key, size) => {
    key = safeStorageKey(key);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid stored size for ${key}.`);
    const previous = references.get(key);
    if (previous !== undefined && previous !== size) throw new Error(`Conflicting stored sizes for ${key}.`);
    references.set(key, size);
  };
  for (const row of db.prepare("SELECT storageKey AS key, sizeBytes AS size FROM asset").all()) add(row.key, row.size);
  for (const row of db.prepare("SELECT storage_key AS key, size_bytes AS size FROM lora_dataset").all()) add(row.key, row.size);
  for (const row of db.prepare("SELECT weight_storage_key AS key, weight_size_bytes AS size FROM lora_model WHERE weight_storage_key IS NOT NULL").all()) add(row.key, row.size);
  return [...references].sort(([a], [b]) => a.localeCompare(b));
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function regularFileWithin(root, path) {
  const physical = await realpath(path);
  if (!inside(root, physical)) throw new Error(`Private file resolves outside its media directory: ${path}`);
  const info = await stat(physical);
  if (!info.isFile()) throw new Error(`Expected a regular file: ${path}`);
  return { physical, size: info.size };
}

function checkIntegrity(db) {
  const result = db.pragma("integrity_check", { simple: true });
  if (result !== "ok") throw new Error(`SQLite integrity check failed: ${result}`);
}

async function copyReferencedMedia(db, sourceRoot, outputRoot) {
  const files = [];
  for (const [key, expectedSize] of referencedMedia(db)) {
    const source = join(sourceRoot, key);
    const output = join(outputRoot, "media", key);
    let sourceInfo;
    try {
      sourceInfo = await regularFileWithin(sourceRoot, source);
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`A media file referenced by the snapshot is missing: ${key}`);
      throw error;
    }
    if (sourceInfo.size !== expectedSize) throw new Error(`Media size differs from the snapshot: ${key}`);
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    await copyFile(sourceInfo.physical, output);
    const copied = await stat(output);
    if (!copied.isFile() || copied.size !== expectedSize) throw new Error(`Copied media file is incomplete: ${key}`);
    const [sourceHash, outputHash] = await Promise.all([sha256(sourceInfo.physical), sha256(output)]);
    if (sourceHash !== outputHash) throw new Error(`Copied media file changed during backup: ${key}`);
    files.push({ path: `media/${key}`, sizeBytes: expectedSize, sha256: outputHash });
  }
  return files;
}

async function createBackup(destination) {
  const databasePath = resolve(process.env.DATABASE_PATH?.trim() || "data/ailoom.sqlite");
  const mediaPath = resolve(process.env.MEDIA_DIR?.trim() || "data/media");
  const [databaseReal, mediaReal, targetReal] = await Promise.all([
    realpath(databasePath), futureRealPath(mediaPath), futureRealPath(destination)
  ]);
  const databaseInfo = await stat(databaseReal);
  if (!databaseInfo.isFile()) throw new Error("DATABASE_PATH is not a file.");
  try {
    const mediaInfo = await stat(mediaReal);
    if (!mediaInfo.isDirectory()) throw new Error("MEDIA_DIR is not a directory.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (inside(dirname(databaseReal), targetReal) || inside(mediaReal, targetReal)) {
    throw new Error("Backup destination must be outside the live data directory.");
  }
  try {
    await lstat(destination);
    throw new Error("Backup destination already exists; choose a new directory.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  await mkdir(destination, { mode: 0o700 });
  await mkdir(join(destination, "media"), { mode: 0o700 });
  const live = new Database(databaseReal, { readonly: true, fileMustExist: true });
  try {
    await live.backup(join(destination, DATABASE_FILE));
  } finally {
    live.close();
  }
  const snapshot = new Database(join(destination, DATABASE_FILE), { readonly: true, fileMustExist: true });
  let files;
  try {
    checkIntegrity(snapshot);
    files = await copyReferencedMedia(snapshot, mediaReal, destination);
  } finally {
    snapshot.close();
  }
  const databaseFile = join(destination, DATABASE_FILE);
  const manifest = {
    format: 1,
    createdAt: new Date().toISOString(),
    database: { path: DATABASE_FILE, sizeBytes: (await stat(databaseFile)).size, sha256: await sha256(databaseFile) },
    media: files
  };
  await writeFile(join(destination, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(`Backup complete: ${destination} (${files.length} private files).`);
  console.log(`Run: node scripts/backup-data.mjs --verify "${destination}"`);
}

async function verifyBackup(destination) {
  const root = await realpath(destination);
  const manifest = JSON.parse(await readFile(join(root, MANIFEST_FILE), "utf8"));
  if (manifest.format !== 1 || manifest.database?.path !== DATABASE_FILE || !Array.isArray(manifest.media)) {
    throw new Error("Invalid backup manifest.");
  }
  const databaseFile = join(root, DATABASE_FILE);
  const databaseInfo = await regularFileWithin(root, databaseFile);
  if (databaseInfo.size !== manifest.database.sizeBytes || await sha256(databaseInfo.physical) !== manifest.database.sha256) {
    throw new Error("Backed-up database does not match its manifest.");
  }
  const snapshot = new Database(databaseInfo.physical, { readonly: true, fileMustExist: true });
  let references;
  try {
    checkIntegrity(snapshot);
    references = referencedMedia(snapshot);
  } finally {
    snapshot.close();
  }
  if (manifest.media.length !== references.length) throw new Error("Backup manifest does not list every database media file.");
  for (let i = 0; i < references.length; i++) {
    const [key, expectedSize] = references[i];
    const item = manifest.media[i];
    if (item?.path !== `media/${key}` || item.sizeBytes !== expectedSize) {
      throw new Error(`Backup manifest does not match database media reference: ${key}`);
    }
    let copied;
    try {
      copied = await regularFileWithin(root, join(root, item.path));
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`Backed-up media file is missing: ${key}`);
      throw error;
    }
    if (copied.size !== expectedSize || await sha256(copied.physical) !== item.sha256) {
      throw new Error(`Backed-up media file does not match its manifest: ${key}`);
    }
  }
  console.log(`Backup verified: ${destination} (${references.length} private files).`);
}

const [first, second, ...extra] = process.argv.slice(2);
if (!first || extra.length || first === "--verify" && !second || first !== "--verify" && second) {
  console.error("Usage: node scripts/backup-data.mjs <new-backup-directory>\n       node scripts/backup-data.mjs --verify <backup-directory>");
  process.exitCode = 2;
} else {
  try {
    const destination = resolve(first === "--verify" ? second : first);
    if (first === "--verify") await verifyBackup(destination);
    else await createBackup(destination);
  } catch (error) {
    console.error(`Backup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
