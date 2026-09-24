import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { specialistProfile, user } from "../db/schema";
import { ContentAccessError } from "./shared";

const specialistInputSchema = z.object({
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(120),
  domain: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2_000),
  systemPrompt: z.string().trim().min(1).max(30_000),
  sourceLinks: z.array(z.url().max(2_000)).max(50),
  enabled: z.boolean()
}).strict();

export type SpecialistInput = z.infer<typeof specialistInputSchema>;

function requireAdmin(adminId: string) {
  const admin = getDb().select({ role: user.role }).from(user).where(eq(user.id, adminId)).get();
  if (admin?.role !== "admin") throw new ContentAccessError();
}

function hydrate(row: typeof specialistProfile.$inferSelect) {
  return { ...row, sourceLinks: z.array(z.url()).parse(JSON.parse(row.sourceLinksJson)) };
}

export function createSpecialistProfile(adminId: string, input: SpecialistInput) {
  requireAdmin(adminId);
  const parsed = specialistInputSchema.parse(input);
  const { sourceLinks, ...metadata } = parsed;
  const now = new Date();
  const record = {
    id: randomUUID(), ...metadata, sourceLinksJson: JSON.stringify(sourceLinks),
    createdByUserId: adminId, createdAt: now, updatedAt: now
  };
  getDb().insert(specialistProfile).values(record).run();
  return hydrate(record);
}

export function listEnabledSpecialists() {
  return getDb().select().from(specialistProfile).where(eq(specialistProfile.enabled, true))
    .orderBy(asc(specialistProfile.domain), asc(specialistProfile.name)).all().map(hydrate);
}

export function getEnabledSpecialist(slug: string) {
  const row = getDb().select().from(specialistProfile)
    .where(eq(specialistProfile.slug, slug)).get();
  return row?.enabled ? hydrate(row) : null;
}

export function listSpecialistsForAdmin(adminId: string) {
  requireAdmin(adminId);
  return getDb().select().from(specialistProfile)
    .orderBy(asc(specialistProfile.domain), asc(specialistProfile.name)).all().map(hydrate);
}

export function updateSpecialistProfile(adminId: string, profileId: string, input: Partial<SpecialistInput>) {
  requireAdmin(adminId);
  const parsed = specialistInputSchema.partial().parse(input);
  const current = getDb().select().from(specialistProfile).where(eq(specialistProfile.id, profileId)).get();
  if (!current) return null;
  const { sourceLinks, ...metadata } = parsed;
  getDb().update(specialistProfile).set({
    ...metadata,
    sourceLinksJson: sourceLinks ? JSON.stringify(sourceLinks) : current.sourceLinksJson,
    updatedAt: new Date()
  }).where(eq(specialistProfile.id, profileId)).run();
  const updated = getDb().select().from(specialistProfile).where(eq(specialistProfile.id, profileId)).get();
  return updated ? hydrate(updated) : null;
}
