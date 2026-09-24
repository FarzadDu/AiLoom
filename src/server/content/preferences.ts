import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { userPreference } from "../db/schema";

export function getSavedModel(userId: string): string | null {
  return getDb().select({ modelId: userPreference.savedModelId }).from(userPreference)
    .where(eq(userPreference.userId, userId)).get()?.modelId ?? null;
}

export function saveModel(userId: string, modelId: string): void {
  const validated = z.string().trim().min(1).max(200).parse(modelId);
  getDb().insert(userPreference)
    .values({ userId, savedModelId: validated, updatedAt: new Date() })
    .onConflictDoUpdate({ target: userPreference.userId, set: { savedModelId: validated, updatedAt: new Date() } }).run();
}
