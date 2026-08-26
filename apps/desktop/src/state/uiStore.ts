import { create } from "zustand";

export type ThemeName = "dark" | "light";

const KEY = "mo-theme";

function loadTheme(): ThemeName {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark") return t;
  } catch {
    // no storage
  }
  return "dark";
}

interface UiState {
  theme: ThemeName;
  toggleTheme: () => void;
}

export const useUi = create<UiState>((set, get) => ({
  theme: loadTheme(),
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // best-effort
    }
    set({ theme: next });
  },
}));
