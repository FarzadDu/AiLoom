const slugs = ["general-health", "skin-and-hair", "mental-wellbeing"] as const;
export type SpecialistSlug = typeof slugs[number];

const markerPrefix = "Ailoom specialist context v1: ";

export function specialistContextMarker(slug: SpecialistSlug): string {
  return markerPrefix + slug;
}

/** Only server-created system-role text is accepted by the caller of this function. */
export function specialistSlugFromSystemTexts(systemTexts: readonly string[]): SpecialistSlug | null {
  for (const text of systemTexts) {
    for (const slug of slugs) {
      if (text === specialistContextMarker(slug)) return slug;
    }
  }
  // Conversations created before explicit context markers stored the seeded
  // specialist's complete prompt as a system message. Match its fixed opening.
  const legacy: Record<SpecialistSlug, string> = {
    "general-health": "You are Ailoom's general health information specialist.",
    "skin-and-hair": "You are Ailoom's skin and hair information specialist.",
    "mental-wellbeing": "You are Ailoom's mental well-being information specialist."
  };
  for (const text of systemTexts) {
    for (const slug of slugs) {
      if (text.startsWith(legacy[slug])) return slug;
    }
  }
  return null;
}

export function resolveSpecialistForTurn(
  existingConversation: boolean,
  systemTexts: readonly string[],
  requestedSlug: SpecialistSlug | null
): { slug: SpecialistSlug | null; conflict: boolean } {
  if (!existingConversation) return { slug: requestedSlug, conflict: false };
  const stored = specialistSlugFromSystemTexts(systemTexts);
  return { slug: stored, conflict: requestedSlug !== null && requestedSlug !== stored };
}
