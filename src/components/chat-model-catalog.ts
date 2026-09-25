import type { ChatModel } from "./chat-api";

// These are real OpenRouter model IDs. Only models returned by the live catalog
// are promoted; the remaining catalog stays searchable.
const FEATURED_CHAT_IDS = [
  "openai/gpt-6-sol",
  "anthropic/claude-sonnet-5",
  "google/gemini-3.8-flash",
  "deepseek/deepseek-v4.1-flash",
  "x-ai/grok-4.7",
  "openai/gpt-6-astra",
  "anthropic/claude-opus-5.5",
  "google/gemini-3.1-pro-preview",
  "deepseek/deepseek-v4-pro-0813",
  "qwen/qwen3.5-plus-20260420"
] as const;

export function prepareChatModelCatalog(models: ChatModel[]): ChatModel[] {
  const available = new Map<string, ChatModel>();
  for (const model of models) {
    // Private aliases and batch endpoints are not ordinary interactive chat models.
    if (model.id.startsWith("~") || model.id.endsWith(":batch")) continue;
    if (!available.has(model.id)) available.set(model.id, model);
  }
  const ordered: ChatModel[] = [];
  const add = (id: string) => {
    const model = available.get(id);
    if (!model) return;
    ordered.push(model);
    available.delete(id);
  };
  add("openrouter/auto");
  for (const id of FEATURED_CHAT_IDS) add(id);
  // Keep major providers visible when their model IDs change in OpenRouter.
  for (const prefix of ["openai/", "anthropic/", "google/", "deepseek/", "x-ai/"]) {
    if (ordered.some(model => model.id.startsWith(prefix))) continue;
    const replacement = [...available.keys()].find(id => id.startsWith(prefix));
    if (replacement) add(replacement);
  }
  return [...ordered, ...available.values()];
}
