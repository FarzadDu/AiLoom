import { z } from "zod";

export const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(200_000) }).strict(),
  z.object({ type: z.literal("image"), assetId: z.uuid(), alt: z.string().max(1_000).optional() }).strict(),
  z.object({ type: z.literal("video"), assetId: z.uuid(), alt: z.string().max(1_000).optional() }).strict(),
  z.object({ type: z.literal("audio"), assetId: z.uuid(), alt: z.string().max(1_000).optional() }).strict(),
  z.object({ type: z.literal("file"), assetId: z.uuid(), alt: z.string().max(1_000).optional() }).strict(),
  z.object({ type: z.literal("sources"), sources: z.array(z.object({
    url: z.url().refine(value => value.startsWith("https://") || value.startsWith("http://")),
    title: z.string().min(1).max(240)
  }).strict()).min(1).max(25) }).strict()
]);

export const contentBlocksSchema = z.array(contentBlockSchema).min(1).max(32);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function encodeJson(value: JsonValue, maxBytes = 1_000_000): string {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== "string" || Buffer.byteLength(encoded, "utf8") > maxBytes) {
    throw new Error("JSON payload exceeds the allowed size");
  }
  // Catch values that JSON.stringify silently drops, such as undefined/functions.
  if (!isJsonValue(value)) throw new Error("Expected a JSON value");
  return encoded;
}

export function decodeJson(value: string): JsonValue {
  const parsed: unknown = JSON.parse(value);
  if (!isJsonValue(parsed)) throw new Error("Stored JSON value is invalid");
  return parsed;
}

export function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.entries(value).every(([key, entry]) => key !== "__proto__" && isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}
