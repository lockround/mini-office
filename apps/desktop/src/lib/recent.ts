import { load } from "@tauri-apps/plugin-store";

const KEY = "recents";
const LIMIT = 10;

let cachedStore: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!cachedStore) {
    cachedStore = await load("recents.json", { autoSave: true });
  }
  return cachedStore;
}

export async function getRecents(): Promise<string[]> {
  try {
    const store = await getStore();
    return (await store.get<string[]>(KEY)) ?? [];
  } catch {
    return [];
  }
}

export async function pushRecent(path: string): Promise<void> {
  try {
    const store = await getStore();
    const current = (await store.get<string[]>(KEY)) ?? [];
    const next = [path, ...current.filter((p) => p !== path)].slice(0, LIMIT);
    await store.set(KEY, next);
  } catch {
    // recents are best-effort
  }
}
