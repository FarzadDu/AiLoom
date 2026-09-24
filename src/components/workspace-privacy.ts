import { views, type View } from "./workspace-data";

export type Drafts = Record<View, string>;

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const draftPrefix = "ailoom.drafts.";

export function emptyDrafts(): Drafts {
  return { chat: "", image: "", video: "", audio: "", explore: "", specialists: "" };
}

function userDraftKey(userId: string): string {
  return `${draftPrefix}${encodeURIComponent(userId)}`;
}

export function readUserDrafts(storage: Pick<DraftStorage, "getItem">, userId: string): Drafts {
  try {
    const saved = JSON.parse(storage.getItem(userDraftKey(userId)) ?? "{}") as Partial<Drafts>;
    return { ...emptyDrafts(), ...Object.fromEntries(views.map(view =>
      [view, typeof saved[view] === "string" ? saved[view] : ""])) };
  } catch {
    return emptyDrafts();
  }
}

export function writeUserDrafts(storage: Pick<DraftStorage, "setItem">, userId: string, drafts: Drafts): void {
  storage.setItem(userDraftKey(userId), JSON.stringify(drafts));
}

export function clearStoredDrafts(storage: DraftStorage): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key === "ailoom.drafts" || key?.startsWith(draftPrefix)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}
