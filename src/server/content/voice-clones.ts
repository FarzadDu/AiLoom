import { createHash } from "node:crypto";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "../db";
import { voiceClone, voiceSpeech } from "../db/schema";
import { getOwnedAsset } from "./assets";

const STALE_AFTER_MS = 2 * 60_000;

export class VoiceRequestConflictError extends Error {
  constructor() {
    super("This request key belongs to a different voice request.");
    this.name = "VoiceRequestConflictError";
  }
}

export function sampleDigest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function speechDigest(cloneId: string, text: string): string {
  return createHash("sha256").update(JSON.stringify([cloneId, "eleven_v3", text])).digest("hex");
}

export function reserveVoiceClone(input: {
  ownerId: string; requestId: string; name: string; sampleHash: string;
  sampleMimeType: string; sampleSizeBytes: number;
}) {
  const requestId = input.requestId.toLowerCase();
  const prior = getDb().select().from(voiceClone)
    .where(sql`lower(${voiceClone.id}) = ${requestId}`).get();
  if (prior) {
    if (prior.ownerId !== input.ownerId || prior.name !== input.name ||
      prior.sampleHash !== input.sampleHash || prior.sampleMimeType !== input.sampleMimeType ||
      prior.sampleSizeBytes !== input.sampleSizeBytes) throw new VoiceRequestConflictError();
    return { voice: prior, created: false };
  }
  const now = new Date();
  const providerName = `${input.name.slice(0, 70)} · Ailoom ${requestId.replaceAll("-", "").slice(0, 16)}`;
  const row = { id: requestId, ownerId: input.ownerId, name: input.name, providerName,
    sampleHash: input.sampleHash, sampleMimeType: input.sampleMimeType,
    sampleSizeBytes: input.sampleSizeBytes, consentAt: now,
    state: "submitting" as const, providerVoiceId: null,
    createdAt: now, updatedAt: now };
  const inserted = getDb().insert(voiceClone).values(row).onConflictDoNothing().run().changes === 1;
  const current = getDb().select().from(voiceClone).where(eq(voiceClone.id, requestId)).get();
  if (!current || current.ownerId !== input.ownerId || current.name !== input.name ||
    current.sampleHash !== input.sampleHash || current.sampleMimeType !== input.sampleMimeType ||
    current.sampleSizeBytes !== input.sampleSizeBytes) throw new VoiceRequestConflictError();
  return { voice: current, created: inserted };
}

export function finishVoiceClone(ownerId: string, id: string,
  state: "ready" | "verification_required" | "failed" | "uncertain", providerVoiceId?: string) {
  getDb().update(voiceClone).set({ state, providerVoiceId: providerVoiceId ?? null, updatedAt: new Date() })
    .where(and(eq(voiceClone.id, id), eq(voiceClone.ownerId, ownerId), eq(voiceClone.state, "submitting"))).run();
  return getOwnedVoiceClone(ownerId, id);
}

export function getOwnedVoiceClone(ownerId: string, id: string) {
  return getDb().select().from(voiceClone)
    .where(and(eq(voiceClone.ownerId, ownerId),
      sql`lower(${voiceClone.id}) = ${id.toLowerCase()}`)).get() ?? null;
}

export function reconcileVoiceClone(ownerId: string, id: string, providerVoiceId: string,
  state: "ready" | "verification_required" | "uncertain") {
  const current = getOwnedVoiceClone(ownerId, id);
  if (!current) return null;
  if (current.providerVoiceId && current.providerVoiceId !== providerVoiceId) {
    throw new VoiceRequestConflictError();
  }
  getDb().update(voiceClone).set({ providerVoiceId, state, updatedAt: new Date() })
    .where(and(eq(voiceClone.id, current.id), eq(voiceClone.ownerId, ownerId),
      inArray(voiceClone.state, ["uncertain", "verification_required"]))).run();
  return getOwnedVoiceClone(ownerId, id);
}

export function listOwnedVoiceClones(ownerId: string) {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  getDb().update(voiceClone).set({ state: "uncertain", updatedAt: new Date() })
    .where(and(eq(voiceClone.ownerId, ownerId), eq(voiceClone.state, "submitting"),
      lt(voiceClone.updatedAt, cutoff))).run();
  return getDb().select().from(voiceClone).where(eq(voiceClone.ownerId, ownerId))
    .orderBy(desc(voiceClone.createdAt), desc(voiceClone.id)).limit(100).all();
}

export function reserveVoiceSpeech(input: {
  ownerId: string; requestId: string; cloneId: string; inputHash: string;
}) {
  const requestId = input.requestId.toLowerCase();
  const prior = getDb().select().from(voiceSpeech)
    .where(sql`lower(${voiceSpeech.id}) = ${requestId}`).get();
  if (prior) {
    if (prior.ownerId !== input.ownerId || prior.cloneId !== input.cloneId ||
      prior.inputHash !== input.inputHash) throw new VoiceRequestConflictError();
    return { speech: prior, created: false };
  }
  const now = new Date();
  const row = { id: requestId, ownerId: input.ownerId, cloneId: input.cloneId,
    inputHash: input.inputHash, state: "submitting" as const, outputAssetId: null,
    createdAt: now, updatedAt: now };
  const inserted = getDb().insert(voiceSpeech).values(row).onConflictDoNothing().run().changes === 1;
  const current = getDb().select().from(voiceSpeech).where(eq(voiceSpeech.id, requestId)).get();
  if (!current || current.ownerId !== input.ownerId || current.cloneId !== input.cloneId ||
    current.inputHash !== input.inputHash) throw new VoiceRequestConflictError();
  return { speech: current, created: inserted };
}

export function finishVoiceSpeech(ownerId: string, id: string,
  state: "ready" | "failed" | "uncertain", outputAssetId?: string) {
  getDb().update(voiceSpeech).set({ state, outputAssetId: outputAssetId ?? null,
    updatedAt: new Date() }).where(and(eq(voiceSpeech.id, id), eq(voiceSpeech.ownerId, ownerId),
      eq(voiceSpeech.state, "submitting"))).run();
  return getOwnedVoiceSpeech(ownerId, id);
}

export function getOwnedVoiceSpeech(ownerId: string, id: string) {
  return getDb().select().from(voiceSpeech)
    .where(and(eq(voiceSpeech.ownerId, ownerId),
      sql`lower(${voiceSpeech.id}) = ${id.toLowerCase()}`)).get() ?? null;
}

export function listOwnedVoiceSpeech(ownerId: string) {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  getDb().update(voiceSpeech).set({ state: "uncertain", updatedAt: new Date() })
    .where(and(eq(voiceSpeech.ownerId, ownerId), eq(voiceSpeech.state, "submitting"),
      lt(voiceSpeech.updatedAt, cutoff))).run();
  return getDb().select().from(voiceSpeech).where(eq(voiceSpeech.ownerId, ownerId))
    .orderBy(desc(voiceSpeech.createdAt), desc(voiceSpeech.id)).limit(100).all();
}

export function publicVoiceClone(voice: NonNullable<ReturnType<typeof getOwnedVoiceClone>>) {
  return { id: voice.id, name: voice.name, state: voice.state,
    createdAt: voice.createdAt, updatedAt: voice.updatedAt };
}

export function publicVoiceSpeech(ownerId: string,
  speech: NonNullable<ReturnType<typeof getOwnedVoiceSpeech>>) {
  const asset = speech.outputAssetId ? getOwnedAsset(ownerId, speech.outputAssetId) : null;
  return { id: speech.id, cloneId: speech.cloneId, state: speech.state,
    outputUrl: asset ? `/api/assets/${asset.id}` : null,
    createdAt: speech.createdAt, updatedAt: speech.updatedAt };
}
