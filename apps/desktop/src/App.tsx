import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import Toolbar from "./components/Toolbar";
import FileTabs from "./components/FileTabs";
import StatusBar from "./components/StatusBar";
import EmptyState from "./components/EmptyState";
import SearchOverlay from "./components/SearchOverlay";
import ConfirmDialog from "./components/ConfirmDialog";
import CsvEditor from "./components/CsvEditor";
import XlsxEditor from "./components/XlsxEditor";
import DocEditor from "./components/DocEditor";
import RecoveryDialog from "./components/RecoveryDialog";
import { useTabs, getActiveTab } from "./state/tabsStore";
import { useUi } from "./state/uiStore";
import { upsertRecovery } from "./lib/recovery";
import {
  openFileDialog,
  openPath,
  saveActive,
  saveActiveAs,
  closeTabWithConfirm,
} from "./lib/files";

function isTypingTarget(el: EventTarget | null): boolean {
  return (
    el instanceof HTMLElement &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.isContentEditable)
  );
}

export default function App() {
  const active = useTabs((s) => getActiveTab(s));
  const theme = useUi((s) => s.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // auto-save recovery snapshots for dirty tabs
  useEffect(() => {
    const timer = setInterval(() => {
      for (const t of useTabs.getState().tabs) {
        if (t.dirty) upsertRecovery(t);
      }
    }, 20_000);
    return () => clearInterval(timer);
  }, []);

  // CLI-argument file open (myapp.exe a.csv b.xlsx)
  useEffect(() => {
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const paths = await invoke<string[]>("cli_open_paths");
        for (const p of paths) await openPath(p);
      } catch {
        // command unavailable (e.g. tests); ignore
      }
    })();
  }, []);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    getCurrentWebview()
      .onDragDropEvent((ev) => {
        if (ev.payload.type === "drop") {
          for (const p of ev.payload.paths) void openPath(p);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else cleanup = fn;
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      const state = useTabs.getState();

      switch (key) {
        case "o":
          e.preventDefault();
          void openFileDialog();
          break;
        case "s":
          e.preventDefault();
          void (e.shiftKey ? saveActiveAs() : saveActive());
          break;
        case "w":
          e.preventDefault();
          if (state.activeId != null) void closeTabWithConfirm(state.activeId);
          break;
        case "f":
          if (!isTypingTarget(e.target)) {
            e.preventDefault();
            if (state.tabs.find((t) => t.id === state.activeId)?.kind === "docx") {
              state.setDocFindOpen(true);
            } else {
              state.setSearchOpen(true);
            }
          }
          break;
        case "z":
          // docx tabs: let TipTap's own history handle undo while focused
          if (active?.kind !== "docx" && !isTypingTarget(e.target) && state.activeId != null && !e.shiftKey) {
            e.preventDefault();
            state.undo(state.activeId);
          }
          break;
        case "y":
          if (active?.kind !== "docx" && !isTypingTarget(e.target) && state.activeId != null) {
            e.preventDefault();
            state.redo(state.activeId);
          }
          break;
        case "tab":
          e.preventDefault();
          state.cycleTab(e.shiftKey ? -1 : 1);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <FileTabs />
      <div className="content">
        {active ? (
          active.kind === "csv" ? (
            <CsvEditor tabId={active.id} />
          ) : active.kind === "xlsx" ? (
            <XlsxEditor tabId={active.id} />
          ) : active.kind === "docx" ? (
            <DocEditor tabId={active.id} />
          ) : null
        ) : (
          <EmptyState />
        )}
      </div>
      <SearchOverlay />
      <StatusBar />
      <ConfirmDialog />
      <RecoveryDialog />
    </div>
  );
}
