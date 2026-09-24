import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { project } from "../db/schema";

const projectInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).nullable().optional()
}).strict();

export function createProject(ownerId: string, input: { name: string; description?: string | null }) {
  const parsed = projectInput.parse(input);
  const now = new Date();
  const record = { id: randomUUID(), ownerId, name: parsed.name, description: parsed.description ?? null,
    createdAt: now, updatedAt: now };
  getDb().insert(project).values(record).run();
  return record;
}

export function getProject(ownerId: string, projectId: string) {
  return getDb().select().from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, ownerId))).get() ?? null;
}

export function listProjects(ownerId: string) {
  return getDb().select().from(project).where(eq(project.ownerId, ownerId))
    .orderBy(desc(project.updatedAt), desc(project.id)).all();
}

export function updateProject(ownerId: string, projectId: string, input: { name?: string; description?: string | null }) {
  const parsed = projectInput.partial().parse(input);
  if (!getProject(ownerId, projectId)) return null;
  getDb().update(project).set({ ...parsed, updatedAt: new Date() })
    .where(and(eq(project.id, projectId), eq(project.ownerId, ownerId))).run();
  return getProject(ownerId, projectId);
}

export function deleteProject(ownerId: string, projectId: string): boolean {
  const result = getDb().delete(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, ownerId))).run();
  return result.changes > 0;
}
