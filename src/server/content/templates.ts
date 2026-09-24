import { randomUUID } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { exploreStarterSeed, exploreTemplate } from "../db/schema";
import { STARTER_TEMPLATES } from "./starter-templates";
import { decodeJson, encodeJson } from "./types";

export const templateDefinitionSchema = z.object({
  version: z.literal(1),
  inputs: z.array(z.object({
    key: z.string().trim().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
    label: z.string().trim().min(1).max(120),
    type: z.enum(["text", "image", "video", "audio", "file"]),
    required: z.boolean()
  }).strict()).max(20),
  steps: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(120),
    kind: z.enum(["chat", "image", "video", "audio"]),
    prompt: z.string().min(1).max(20_000),
    modelId: z.string().trim().min(1).max(200).optional()
  }).strict()).min(1).max(30)
}).strict();

export type TemplateDefinition = z.infer<typeof templateDefinitionSchema>;

const templateMetadataSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000),
  category: z.string().trim().min(1).max(80)
}).strict();

function hydrate(row: typeof exploreTemplate.$inferSelect) {
  const decoded = decodeJson(row.definitionJson);
  return { ...row, definition: templateDefinitionSchema.parse(decoded) };
}

export function createExploreTemplate(ownerId: string, input: {
  title: string; description: string; category: string; definition: TemplateDefinition;
}) {
  const { definition, ...metadata } = input;
  const parsed = templateMetadataSchema.parse(metadata);
  const validatedDefinition = templateDefinitionSchema.parse(definition);
  const now = new Date();
  const record = {
    id: randomUUID(), ownerId, ...parsed, definitionJson: encodeJson(validatedDefinition),
    visibility: "private" as const, createdAt: now, updatedAt: now
  };
  getDb().insert(exploreTemplate).values(record).run();
  return hydrate(record);
}

/** Seeds once per account, even if its starter templates are later edited or deleted. */
export function ensureStarterTemplates(ownerId: string): number {
  return getDb().transaction((tx) => {
    const now = new Date();
    const marker = tx.insert(exploreStarterSeed)
      .values({ ownerId, seededAt: now })
      .onConflictDoNothing()
      .run();
    if (marker.changes !== 1) return 0;

    const records = STARTER_TEMPLATES.map((starter) => {
      const metadata = templateMetadataSchema.parse({
        title: starter.title, description: starter.description, category: starter.category
      });
      const definition = templateDefinitionSchema.parse(starter.definition);
      return {
        id: randomUUID(), ownerId, ...metadata,
        definitionJson: encodeJson(definition), visibility: "private" as const,
        createdAt: now, updatedAt: now
      };
    });
    tx.insert(exploreTemplate).values(records).run();
    return records.length;
  });
}
export function getExploreTemplate(requesterId: string | null, templateId: string) {
  const row = getDb().select().from(exploreTemplate).where(and(
    eq(exploreTemplate.id, templateId), requesterId
      ? or(eq(exploreTemplate.ownerId, requesterId), eq(exploreTemplate.visibility, "public"))
      : eq(exploreTemplate.visibility, "public")
  )).get();
  return row ? hydrate(row) : null;
}

export function listExploreTemplates(requesterId: string | null, options: { category?: string; limit?: number } = {}) {
  const limit = z.number().int().min(1).max(200).parse(options.limit ?? 100);
  const condition = requesterId
    ? or(eq(exploreTemplate.ownerId, requesterId), eq(exploreTemplate.visibility, "public"))
    : eq(exploreTemplate.visibility, "public");
  return getDb().select().from(exploreTemplate).where(and(
    condition, options.category ? eq(exploreTemplate.category, options.category) : undefined
  )).orderBy(desc(exploreTemplate.updatedAt), desc(exploreTemplate.id)).limit(limit).all().map(hydrate);
}

export function updateExploreTemplate(ownerId: string, templateId: string, input: {
  title?: string; description?: string; category?: string; definition?: TemplateDefinition;
}) {
  const { definition, ...metadata } = input;
  const parsed = templateMetadataSchema.partial().parse(metadata);
  const current = getDb().select().from(exploreTemplate)
    .where(and(eq(exploreTemplate.id, templateId), eq(exploreTemplate.ownerId, ownerId))).get();
  if (!current) return null;
  const definitionJson = definition === undefined ? current.definitionJson
    : encodeJson(templateDefinitionSchema.parse(definition));
  getDb().update(exploreTemplate).set({ ...parsed, definitionJson, updatedAt: new Date() })
    .where(and(eq(exploreTemplate.id, templateId), eq(exploreTemplate.ownerId, ownerId))).run();
  return getExploreTemplate(ownerId, templateId);
}

export function setExploreTemplateVisibility(ownerId: string, templateId: string, visibility: "private" | "public") {
  const parsed = z.enum(["private", "public"]).parse(visibility);
  const current = getDb().select({ id: exploreTemplate.id }).from(exploreTemplate)
    .where(and(eq(exploreTemplate.id, templateId), eq(exploreTemplate.ownerId, ownerId))).get();
  if (!current) return null;
  getDb().update(exploreTemplate).set({ visibility: parsed, updatedAt: new Date() })
    .where(and(eq(exploreTemplate.id, templateId), eq(exploreTemplate.ownerId, ownerId))).run();
  return getExploreTemplate(ownerId, templateId);
}

export function deleteExploreTemplate(ownerId: string, templateId: string): boolean {
  const deleted = getDb().delete(exploreTemplate)
    .where(and(eq(exploreTemplate.id, templateId), eq(exploreTemplate.ownerId, ownerId))).run();
  return deleted.changes > 0;
}

