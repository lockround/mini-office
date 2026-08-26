import type { Tab } from "./types";

/**
 * Workspace session: which files were open (and their order) so a normal
 * app close reopens the same tabs next launch. Dirty content is handled by
 * recovery.ts; this only tracks paths.
 */

const KEY = "mo-session";

export interface SessionData {
  paths: string[];
  activePath: string | null;
}

export function saveSession(tabs: Tab[], activeId: number | null): void {
  try {
    const withPaths = tabs.filter((t) => t.path);
    if (withPaths.length === 0) {
      localStorage.removeItem(KEY);
      return;
    }
    const data: SessionData = {
      paths: withPaths.map((t) => t.path!),
      activePath:
        withPaths.find((t) => t.id === activeId)?.path ?? withPaths[0]!.path!,
    };
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // best-effort
  }
}

export function loadSession(): SessionData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionData;
    if (!Array.isArray(parsed.paths)) return null;
    return { paths: parsed.paths, activePath: parsed.activePath ?? null };
  } catch {
    return null;
  }
}
