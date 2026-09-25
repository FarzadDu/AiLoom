const privateReferenceFields = new Set(["imageUrl", "imageUrls", "videoUrl", "firstFrameUrl", "lastFrameUrl"]);

/** Private signed URL tokens expire, while the underlying asset IDs stay fixed. */
export function generationRequestIdentity(
  endpoint: string, payload: Record<string, unknown>, sourceAssetIds: readonly string[] = []
): string {
  const stablePayload = Object.fromEntries(Object.entries(payload).map(([key, value]) => [
    key, privateReferenceFields.has(key)
      ? Array.isArray(value) ? `[private references: ${value.length}]` : "[private reference]"
      : value
  ]));
  return JSON.stringify([endpoint, sourceAssetIds, stablePayload]);
}

export function parsePendingGeneration(value: string | null, identity: string): { identity: string; key: string } | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && "identity" in parsed && "key" in parsed &&
      parsed.identity === identity && typeof parsed.key === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.key)) {
      return { identity, key: parsed.key };
    }
  } catch { /* Invalid storage cannot establish request identity. */ }
  return null;
}

/** An unknown provider outcome must not become another paid POST for the same input. */
export function uncertainGenerationMatches(
  job: { id: string; state: string; errorCode?: string | null } | null | undefined,
  pending: { identity: string; key: string } | null | undefined,
  identity?: string
): boolean {
  return Boolean(job?.state === "failed" && job.errorCode === "submission_uncertain" &&
    pending?.key === job.id && (identity === undefined || pending.identity === identity));
}
