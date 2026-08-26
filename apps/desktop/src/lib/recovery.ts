import type { Tab } from "./types";

/**
 * Crash-recovery snapshots: dirty tabs are periodically persisted to
 * localStorage so an unexpected exit can be recovered on next launch.
 */

const KEY = "mo-recovery";
const SCHEMA = 1;

export interface RecoveryEntry {
  key: string;
  path: string | null;
  title: string;
  kind: Tab["kind"];
  savedAt: number;
  csv?: Tab["csv"];
  xlsx?: Tab["xlsx"];
  docx?: { html: string; json: unknown };
}

export function entryKey(tab: Pick<Tab, "path" | "title">): string {
  return tab.path ?? `untitled:${tab.title}`;
}

function loadAll(): RecoveryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { schema: number; entries: RecoveryEntry[] };
    if (parsed.schema !== SCHEMA || !Array.isArray(parsed.entries)) return [];
    return parsed.entries;
  } catch {
    return [];
  }
}

function saveAll(entries: RecoveryEntry[]): void {
  try {
    if (entries.length === 0) {
      localStorage.removeItem(KEY);
    } else {
      localStorage.setItem(
        KEY,
        JSON.stringify({ schema: SCHEMA, entries }),
      );
    }
  } catch {
    // quota exceeded or unavailable; recovery is best-effort
  }
}

export function upsertRecovery(tab: Tab): void {
  if (!tab.dirty) {
    removeRecovery(tab);
    return;
  }
  const entries = loadAll().filter((e) => e.key !== entryKey(tab));
  entries.push({
    key: entryKey(tab),
    path: tab.path,
    title: tab.title,
    kind: tab.kind,
    savedAt: Date.now(),
    csv: tab.csv,
    xlsx: tab.xlsx,
    docx: tab.docx ? { html: tab.docx.html, json: tab.docx.json } : undefined,
  });
  // cap at 25 entries to bound storage use
  saveAll(entries.slice(-25));
}

export function removeRecovery(tab: Pick<Tab, "path" | "title">): void {
  const key = entryKey(tab);
  saveAll(loadAll().filter((e) => e.key !== key));
}

export function loadRecoveries(): RecoveryEntry[] {
  return loadAll();
}

export function clearRecoveries(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
