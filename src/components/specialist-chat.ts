export type SpecialistChatId = "general" | "skin" | "mental" |
  "general-health" | "skin-and-hair" | "mental-wellbeing";

const specialistIds = new Set<string>([
  "general", "skin", "mental", "general-health", "skin-and-hair", "mental-wellbeing"
]);

/** A specialist always starts a new text chat so its persona reaches the text API. */
export function specialistChatTransition(id: string): {
  mode: "text";
  conversationId: null;
  specialistId: SpecialistChatId | null;
} {
  return { mode: "text", conversationId: null,
    specialistId: specialistIds.has(id) ? id as SpecialistChatId : null };
}
