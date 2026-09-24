export type ExploreStep = {
  id: string;
  title: string;
  kind: "chat" | "image" | "video" | "audio";
  prompt: string;
  modelId?: string;
};

export type ExploreTemplate = {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  category: string;
  visibility: "public" | "private";
  definition: {
    version: 1;
    inputs: { key: string; label: string; type: "text" | "image" | "video" | "audio" | "file"; required: boolean }[];
    steps: ExploreStep[];
  };
};

export type SpecialistProfile = {
  id: string;
  slug: string;
  name: string;
  domain: string;
  description: string;
  sourceLinks: string[];
};

export function resolveTemplatePrompt(
  prompt: string,
  inputs: ExploreTemplate["definition"]["inputs"],
  values: Record<string, string>,
  files: Record<string, { name: string }>
): { text: string; hasUndefinedInput: boolean } {
  let text = prompt;
  for (const input of inputs) {
    const escapedKey = input.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const value = input.type === "text" ? values[input.key]?.trim() || ""
      : files[input.key] ? `[${files[input.key].name}]` : "";
    text = text.replace(new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, "g"), () => value);
  }
  return { text, hasUndefinedInput: /\{\{[^{}]+\}\}/.test(text) };
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function templateFromPayload(payload: unknown): ExploreTemplate | null {
  const item = record(payload);
  const definition = record(item?.definition);
  if (!item || !definition || typeof item.id !== "string" || typeof item.ownerId !== "string" ||
      typeof item.title !== "string" || typeof item.description !== "string" ||
      typeof item.category !== "string" || (item.visibility !== "public" && item.visibility !== "private") ||
      definition.version !== 1 || !Array.isArray(definition.inputs) || !Array.isArray(definition.steps)) return null;
  const steps: ExploreStep[] = [];
  for (const candidate of definition.steps) {
    const step = record(candidate);
    if (!step || typeof step.id !== "string" || typeof step.title !== "string" ||
        typeof step.prompt !== "string" || !["chat", "image", "video", "audio"].includes(String(step.kind))) return null;
    steps.push({ id: step.id, title: step.title, prompt: step.prompt,
      kind: step.kind as ExploreStep["kind"], modelId: typeof step.modelId === "string" ? step.modelId : undefined });
  }
  if (!steps.length) return null;
  const inputs: ExploreTemplate["definition"]["inputs"] = [];
  for (const candidate of definition.inputs) {
    const input = record(candidate);
    if (!input || typeof input.key !== "string" || typeof input.label !== "string" ||
        typeof input.required !== "boolean" || !["text", "image", "video", "audio", "file"].includes(String(input.type))) return null;
    inputs.push({ key: input.key, label: input.label, required: input.required,
      type: input.type as ExploreTemplate["definition"]["inputs"][number]["type"] });
  }
  return { id: item.id, ownerId: item.ownerId, title: item.title, description: item.description,
    category: item.category, visibility: item.visibility,
    definition: { version: 1, inputs, steps } };
}

export function templatesFromPayload(payload: unknown): ExploreTemplate[] {
  const entries = record(payload)?.templates;
  return Array.isArray(entries) ? entries.map(templateFromPayload).filter((item): item is ExploreTemplate => Boolean(item)) : [];
}

export function specialistsFromPayload(payload: unknown): SpecialistProfile[] {
  const entries = record(payload)?.specialists;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap(candidate => {
    const item = record(candidate);
    if (!item || typeof item.id !== "string" || typeof item.slug !== "string" || typeof item.name !== "string" ||
        typeof item.domain !== "string" || typeof item.description !== "string") return [];
    return [{ id: item.id, slug: item.slug, name: item.name, domain: item.domain,
      description: item.description, sourceLinks: Array.isArray(item.sourceLinks)
        ? item.sourceLinks.filter((link): link is string => typeof link === "string" && /^https:\/\//.test(link)) : [] }];
  });
}
