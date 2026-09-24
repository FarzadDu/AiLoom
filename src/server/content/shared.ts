import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { project } from "../db/schema";

export class ContentAccessError extends Error {
  constructor(message = "Resource is unavailable") {
    super(message);
    this.name = "ContentAccessError";
  }
}

export function ownedProjectExists(ownerId: string, projectId: string): boolean {
  return !!getDb().select({ id: project.id }).from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, ownerId))).get();
}

export function requireOwnedProject(ownerId: string, projectId?: string | null): void {
  if (projectId && !ownedProjectExists(ownerId, projectId)) throw new ContentAccessError();
}
