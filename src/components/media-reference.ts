type Reference = { mime: string; assetId?: string; file?: { type: string; size: number } } | null;

/** Local uploads need a valid file; an owned asset can be referenced by id. */
export function usableReference(reference: Reference, allowedTypes: readonly string[], maxBytes?: number): boolean {
  if (!reference) return false;
  if (reference.file) return allowedTypes.includes(reference.file.type) && reference.file.size > 0 &&
    (maxBytes === undefined || reference.file.size <= maxBytes);
  return Boolean(reference.assetId) && allowedTypes.includes(reference.mime);
}

export function retainImageReferenceOnModeChange(view: string, nextMode: number, reference: Reference): boolean {
  return (view === "image" && nextMode > 0 || view === "video" && (nextMode === 1 || nextMode === 3)) &&
    Boolean(reference?.mime.startsWith("image/"));
}
