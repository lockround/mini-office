import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useTabs } from "../state/tabsStore";
import type {
  CsvDocData,
  DocxDocData,
  Tab,
  XlsxCellData,
  XlsxDocData,
} from "./types";
import { pushRecent } from "./recent";
import { removeRecovery } from "./recovery";
import { buildDocxBlob } from "./docxBuild";

function b64encode(data: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

interface ParsedCsv {
  rows: string[][];
  delimiter: string;
  has_bom: boolean;
}
interface ParsedXlsx {
  sheets: Array<{ name: string; rows: never[][] }>;
}
interface SaveResult {
  size_bytes: number;
}

const CSV_FILTERS = [
  { name: "CSV files", extensions: ["csv", "tsv"] },
  { name: "All files", extensions: ["*"] },
];

const SPREADSHEET_FILTERS = [
  { name: "Spreadsheets", extensions: ["csv", "tsv", "xlsx"] },
  { name: "All files", extensions: ["*"] },
];

const UNSUPPORTED: Record<string, string> = {
  xlsm: "XLSM is not supported yet",
  xls: "legacy .xls is not supported",
  doc: "legacy .doc is not supported",
  pdf: "PDF is not supported",
};

async function openDocx(path: string): Promise<void> {
  const b64 = await invoke<string>("read_file_base64", { path });
  const bytes = b64decode(b64);
  // copy into a fresh ArrayBuffer so mammoth's arrayBuffer view is safe
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const mammoth = await import("mammoth");
  const result = await (mammoth as unknown as {
    convertToHtml: (
      input: { arrayBuffer: ArrayBuffer },
      options?: { styleMap?: string[] },
    ) => Promise<{ value: string; messages: Array<{ message: string }> }>;
  }).convertToHtml(
    { arrayBuffer: buffer },
    { styleMap: ["u => u"] },
  );
  const data: DocxDocData = {
    html: result.value || "<p></p>",
    json: null,
  };
  useTabs.getState().addDocxTab(path, data, null);
  if (result.messages.length > 0) {
    useTabs
      .getState()
      .setStatus(`Opened ${path} (${result.messages.length} import notes)`);
  } else {
    useTabs.getState().setStatus(`Opened ${path}`);
  }
  void pushRecent(path);
}

export function extOf(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function defaultCrlfFor(path: string | null): boolean {
  if (!path) return false;
  try {
    const raw = localStorage.getItem(`crlf:${path}`);
    return raw === "1";
  } catch {
    return false;
  }
}

export async function openPath(path: string): Promise<void> {
  const store = useTabs.getState();
  const ext = extOf(path);
  if (UNSUPPORTED[ext]) {
    store.setStatus(`${ext.toUpperCase()}: ${UNSUPPORTED[ext]}`);
    return;
  }
  if (ext === "csv" || ext === "tsv") {
    try {
      const parsed = await invoke<ParsedCsv>("parse_csv", { path });
      const data: CsvDocData = {
        rows: parsed.rows.length > 0 ? parsed.rows : [[""]],
        delimiter: ext === "tsv" ? "\t" : parsed.delimiter,
        hasBom: parsed.has_bom,
        crlf: defaultCrlfFor(path),
      };
      useTabs.getState().addCsvTab(path, data, null);
      useTabs.getState().setStatus(`Opened ${path}`);
      void pushRecent(path);
    } catch (e) {
      store.setStatus(`Error opening ${path}: ${String(e)}`);
    }
    return;
  }
  if (ext === "xlsx") {
    try {
      const parsed = await invoke<ParsedXlsx>("parse_xlsx", { path });
      const sheets = parsed.sheets.map((s) => ({
        name: s.name,
        rows: s.rows as never as XlsxCellData[][],
      }));
      const data: XlsxDocData = {
        sheets:
          sheets.length > 0
            ? sheets
            : [{ name: "Sheet1", rows: [[{ value: "", kind: "text" }]] }],
        activeSheet: 0,
      };
      useTabs.getState().addXlsxTab(path, data, null);
      useTabs.getState().setStatus(`Opened ${path}`);
      void pushRecent(path);
    } catch (e) {
      store.setStatus(`Error opening ${path}: ${String(e)}`);
    }
    return;
  }
  if (ext === "docx") {
    try {
      await openDocx(path);
    } catch (e) {
      store.setStatus(`Error opening ${path}: ${String(e)}`);
    }
    return;
  }
  store.setStatus(`Cannot open ${ext || "file"}: unsupported format`);
}

export async function openFileDialog(): Promise<void> {
  const selection = await open({
    multiple: true,
    filters: SPREADSHEET_FILTERS,
  });
  if (!selection) return;
  const paths = Array.isArray(selection) ? selection : [selection];
  for (const p of paths) await openPath(p);
}

async function writeTab(
  tabId: number,
  path: string,
): Promise<void> {
  const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return;
  try {
    let result: SaveResult;
    if (tab.kind === "xlsx") {
      result = await invoke<SaveResult>("write_xlsx", {
        path,
        sheets: tab.xlsx!.sheets,
      });
    } else if (tab.kind === "docx") {
      if (!tab.docx?.json) {
        useTabs
          .getState()
          .setStatus("Nothing to save yet — click into the document first");
        return;
      }
      const bytes = await buildDocxBlob(tab.docx.json);
      result = await invoke<SaveResult>("write_docx", {
        path,
        dataB64: b64encode(bytes),
        options: {},
      });
    } else {
      result = await invoke<SaveResult>("write_csv", {
        path,
        rows: tab.csv!.rows,
        options: {
          delimiter: tab.csv!.delimiter,
          hasBom: tab.csv!.hasBom,
          crlf: tab.csv!.crlf,
          encoding: tab.csv!.encoding ?? "utf-8",
        },
      });
      try {
        localStorage.setItem(`crlf:${path}`, tab.csv!.crlf ? "1" : "0");
      } catch {
        // storage unavailable; non-fatal
      }
    }
    useTabs.getState().markSaved(tabId, path, result.size_bytes);
    removeRecovery({ ...tab, path });
    useTabs.getState().setStatus(
      `Saved ${path} (${formatSize(result.size_bytes)})`,
    );
    void pushRecent(path);
  } catch (e) {
    useTabs.getState().setStatus(`Error saving: ${String(e)}`);
  }
}

export async function saveActive(): Promise<void> {
  const { activeId, tabs } = useTabs.getState();
  const tab = tabs.find((t) => t.id === activeId);
  if (!tab) return;
  if (!tab.path) {
    await saveActiveAs();
    return;
  }
  await writeTab(tab.id, tab.path);
}

const DOCX_FILTERS = [
  { name: "Word documents", extensions: ["docx"] },
  { name: "All files", extensions: ["*"] },
];

function filtersFor(tab: Tab): typeof CSV_FILTERS {
  if (tab.kind === "xlsx") return SPREADSHEET_FILTERS;
  if (tab.kind === "docx") return DOCX_FILTERS;
  return CSV_FILTERS;
}

export async function saveActiveAs(): Promise<void> {
  const { activeId, tabs } = useTabs.getState();
  const tab = tabs.find((t) => t.id === activeId);
  if (!tab) return;
  const target = await save({
    defaultPath: tab.title,
    filters: filtersFor(tab),
  });
  if (!target) return;
  await writeTab(tab.id, target);
}

export async function closeTabWithConfirm(tabId: number): Promise<void> {
  const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return;

  let choice: "save" | "discard" | "cancel" = "discard";
  if (tab.dirty) {
    choice = await confirmCloseDialog(tab.title);
    if (choice === "cancel") return;
    if (choice === "save") {
      if (!tab.path) {
        const target = await save({
          defaultPath: tab.title,
          filters: filtersFor(tab),
        });
        if (!target) return;
        await writeTab(tabId, target);
      } else {
        await writeTab(tabId, tab.path);
      }
    }
  }
  useTabs.getState().closeTab(tabId);
  removeRecovery(tab);
  useTabs.getState().setStatus("Ready");
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// --- unsaved-changes modal plumbing -------------------------------------

export type CloseChoice = "save" | "discard" | "cancel";

let confirmHandler:
  | ((title: string) => Promise<CloseChoice>)
  | null = null;

export function registerConfirmHandler(
  fn: (title: string) => Promise<CloseChoice>,
): () => void {
  confirmHandler = fn;
  return () => {
    if (confirmHandler === fn) confirmHandler = null;
  };
}

function confirmCloseDialog(title: string): Promise<CloseChoice> {
  if (confirmHandler) return confirmHandler(title);
  return window.confirm(`Close ${title} without saving?`)
    ? Promise.resolve("discard")
    : Promise.resolve("cancel");
}
