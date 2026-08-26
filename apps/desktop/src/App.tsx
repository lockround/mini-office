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
import { saveSession, loadSession } from "./lib/session";
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

  // startup restore: CLI args first, then the last workspace session
  useEffect(() => {
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const cliPaths = await invoke<string[]>("cli_open_paths");
        for (const p of cliPaths) await openPath(p);
      } catch {
        // command unavailable (e.g. tests); ignore
      }
      const session = loadSession();
      if (session && session.paths.length > 0) {
        for (const p of session.paths) await openPath(p);
        if (session.activePath) {
          const s = useTabs.getState();
          const target = s.tabs.find((t) => t.path === session.activePath);
          if (target) s.setActive(target.id);
        }
      }
    })();
  }, []);

  // persist the workspace whenever the tab set changes
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  useEffect(() => {
    saveSession(tabs, activeId);
  }, [tabs, activeId]);
  useEffect(() => {
    useTabs.getState().setSelectionStats(null);
  }, [activeId]);

  // auto-save recovery snapshots for dirty tabs
  useEffect(() => {
    const timer = setInterval(() => {
      for (const t of useTabs.getState().tabs) {
        if (t.dirty) upsertRecovery(t);
      }
    }, 20_000);
    return () => clearInterval(timer);
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
