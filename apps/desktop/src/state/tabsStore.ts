import { create } from "zustand";
import {
  activeRows,
  sniffKind,
  type CellPos,
  type CsvDocData,
  type DocxDocData,
  type SelectionStats,
  type Tab,
  type XlsxCellData,
  type XlsxDocData,
} from "../lib/types";

export type CloseChoice = "save" | "discard" | "cancel";

const HISTORY_LIMIT = 50;
const COALESCE_MS = 900;

let idCounter = 1;

function baseTitle(path: string | null): string {
  if (!path) return "";
  const norm = path.replace(/\\/g, "/");
  return norm.slice(norm.lastIndexOf("/") + 1);
}

function emptyCsv(): CsvDocData {
  return { rows: [["", ""]], delimiter: ",", hasBom: false, crlf: false };
}

function emptyCell(): XlsxCellData {
  return { value: "", kind: "text" };
}

interface TabsState {
  tabs: Tab[];
  activeId: number | null;
  status: string;
  searchOpen: boolean;
  searchQuery: string;
  searchCaseSensitive: boolean;
  searchMatches: CellPos[];
  searchIndex: number;
  docFindOpen: boolean;
  selectionStats: SelectionStats | null;

  setStatus: (s: string) => void;
  setSearchOpen: (open: boolean) => void;
  runSearch: (query: string) => void;
  setSearchCaseSensitive: (v: boolean) => void;
  stepSearch: (dir: 1 | -1) => void;
  closeSearch: () => void;
  setDocFindOpen: (open: boolean) => void;
  setSelectionStats: (stats: SelectionStats | null) => void;

  /** replaces every occurrence of query in the active tab's grid; returns count */
  replaceAllInGrid: (tabId: number, query: string, replacement: string, caseSensitive: boolean) => number;
  sortColumn: (tabId: number, col: number, dir: "asc" | "desc") => void;
  filterColumnKeepMatches: (tabId: number, col: number, query: string) => number;

  addCsvTab: (path: string | null, data: CsvDocData, sizeBytes: number | null) => void;
  addXlsxTab: (path: string, data: XlsxDocData, sizeBytes: number | null) => void;
  addDocxTab: (path: string, data: DocxDocData, sizeBytes: number | null) => void;
  setDocxContent: (tabId: number, html: string, json: unknown) => void;
  /** append a fully-formed tab (crash recovery) with a fresh id */
  addRawTab: (tab: Omit<Tab, "id">) => number;
  closeTab: (id: number) => void;
  setActive: (id: number) => void;
  cycleTab: (dir: 1 | -1) => void;
  newCsv: () => void;

  setCsvCell: (tabId: number, row: number, col: number, value: string) => void;
  setCellsBlock: (
    tabId: number,
    startRow: number,
    startCol: number,
    values: string[][],
    tag: string,
  ) => void;
  setXlsxCell: (tabId: number, row: number, col: number, value: string) => void;
  insertRow: (tabId: number, at: number) => void;
  deleteRow: (tabId: number, at: number) => void;
  insertCol: (tabId: number, at: number) => void;
  deleteCol: (tabId: number, at: number) => void;
  undo: (tabId: number) => void;
  redo: (tabId: number) => void;
  markSaved: (tabId: number, path: string, sizeBytes: number) => void;
  toggleFreezeHeader: (tabId: number) => void;
  setColWidth: (tabId: number, col: number, width: number) => void;

  setActiveSheet: (tabId: number, index: number) => void;
  addSheet: (tabId: number) => void;
  deleteSheet: (tabId: number, index: number) => void;
  renameSheet: (tabId: number, index: number, name: string) => void;
}

const lastTagRef: { tag: string | null; time: number } = { tag: null, time: 0 };

/** Immutable doc mutation with coalesced history snapshots. */
function applyMutation(
  tab: Tab,
  mutate: () => Partial<Pick<Tab, "csv" | "xlsx">>,
  tag?: string,
): Partial<Tab> {
  const snapshot =
    tab.kind === "xlsx" ? tab.xlsx!.sheets : tab.csv!.rows;
  const now = Date.now();
  const coalesce =
    tag !== undefined &&
    tag === lastTagRef.tag &&
    now - lastTagRef.time < COALESCE_MS &&
    // only rapid typing on the same cell may coalesce; every other op
    // (paste, delete, sheet ops …) must be its own undo step
    tag.startsWith("cell:");
  let past = tab.past;
  if (!coalesce) {
    past = [...tab.past, snapshot];
    if (past.length > HISTORY_LIMIT) past = past.slice(-HISTORY_LIMIT);
  }
  lastTagRef.tag = tag ?? null;
  lastTagRef.time = now;
  return {
    ...mutate(),
    dirty: true,
    past,
    future: [],
  };
}

function patchTab(
  s: { tabs: Tab[] },
  tabId: number,
  patch: (t: Tab) => Partial<Tab> | null,
): { tabs: Tab[] } {
  return {
    tabs: s.tabs.map((t) => {
      if (t.id !== tabId) return t;
      const p = patch(t);
      return p ? { ...t, ...p } : t;
    }),
  };
}

function restoreSnapshot(tab: Tab, snapshot: unknown): Partial<Tab> {
  if (tab.kind === "xlsx") {
    return {
      xlsx: { ...(tab.xlsx as XlsxDocData), sheets: snapshot as never },
      dirty: true,
    };
  }
  return { csv: { ...(tab.csv as CsvDocData), rows: snapshot as never }, dirty: true };
}

export const useTabs = create<TabsState>((set, get) => ({
  tabs: [],
  activeId: null,
  status: "Ready",
  searchOpen: false,
  searchQuery: "",
  searchCaseSensitive: false,
  searchMatches: [],
  searchIndex: 0,
  docFindOpen: false,
  selectionStats: null,

  setStatus: (status) => set({ status }),

  setSearchOpen: (searchOpen) =>
    set({
      searchOpen,
      searchMatches: [],
      searchIndex: 0,
      searchQuery: searchOpen ? get().searchQuery : "",
    }),

  runSearch: (query) => {
    const { tabs, activeId, searchCaseSensitive } = get();
    const tab = tabs.find((t) => t.id === activeId);
    const matches: CellPos[] = [];
    if (tab && query) {
      const q = searchCaseSensitive ? query : query.toLowerCase();
      const rows = activeRows(tab);
      outer: for (let r = 0; r < rows.length; r++) {
        const row = rows[r]!;
        for (let c = 0; c < row.length; c++) {
          const cellValue =
            typeof row[c] === "string"
              ? (row[c] as string)
              : ((row[c] as XlsxCellData)?.value ?? "");
          const hay = searchCaseSensitive ? cellValue : cellValue.toLowerCase();
          if (hay.includes(q)) {
            matches.push({ row: r, col: c });
            if (matches.length >= 5000) break outer;
          }
        }
      }
    }
    set({ searchQuery: query, searchMatches: matches, searchIndex: 0 });
  },

  setSearchCaseSensitive: (v) => set({ searchCaseSensitive: v }),

  stepSearch: (dir) => {
    const { searchMatches, searchIndex } = get();
    if (searchMatches.length === 0) return;
    const idx = (searchIndex + dir + searchMatches.length) % searchMatches.length;
    set({ searchIndex: idx });
  },

  closeSearch: () => set({ searchOpen: false, searchMatches: [] }),

  setDocFindOpen: (docFindOpen) => set({ docFindOpen }),

  setSelectionStats: (selectionStats) => set({ selectionStats }),

  replaceAllInGrid: (tabId, query, replacement, caseSensitive) => {
    if (!query) return 0;
    let count = 0;
    set((s) =>
      patchTab(s, tabId, (t) => {
        const apply = (v: string): string => {
          if (!v.includes(query)) return v;
          count += countOccurrences(v, query, caseSensitive);
          return replaceAllStrings(v, query, replacement, caseSensitive);
        };
        if (t.kind === "xlsx" && t.xlsx) {
          const sheets = t.xlsx.sheets.map((sh, i) =>
            i === t.xlsx!.activeSheet
              ? {
                  ...sh,
                  rows: sh.rows.map((row) =>
                    row.map((cell) => ({ ...cell, value: apply(cell.value) })),
                  ),
                }
              : sh,
          );
          return applyMutation(t, () => ({ xlsx: { ...t.xlsx!, sheets } }), `repl:${Date.now()}`);
        }
        if (!t.csv) return null;
        return applyMutation(
          t,
          () => ({
            csv: { ...t.csv!, rows: t.csv!.rows.map((row) => row.map(apply)) },
          }),
          `repl:${Date.now()}`,
        );
      }),
    );
    return count;
  },

  sortColumn: (tabId, col, dir) =>
    set((s) =>
      patchTab(s, tabId, (t) => {
        const numeric = columnIsNumeric(t, col);
        const cmp = (a: string, b: string): number => {
          if (numeric) {
            const na = parseFloat(a);
            const nb = parseFloat(b);
            const da = Number.isNaN(na) ? Infinity : na; // non-numbers sink
            const db = Number.isNaN(nb) ? Infinity : nb;
            return da - db || a.localeCompare(b);
          }
          return a.localeCompare(b, undefined, { numeric: true });
        };
        const skipHeader = t.freezeHeader && rowCountOf(t) > 1 ? 1 : 0;
        if (t.kind === "xlsx") {
          if (!t.xlsx) return null;
          return applyMutation(t, () => ({
            xlsx: mapActiveSheetRows(t.xlsx!, (rows) => {
              const head = rows.slice(0, skipHeader);
              const body = rows.slice(skipHeader).map((r) => r.slice());
              body.sort((ra, rb) =>
                dir === "asc"
                  ? cmp(cellText(ra[col]), cellText(rb[col]))
                  : cmp(cellText(rb[col]), cellText(ra[col])),
              );
              return [...head, ...body];
            }),
          }), `sort:${Date.now()}`);
        }
        if (!t.csv) return null;
        return applyMutation(t, () => ({
          csv: {
            ...t.csv!,
            rows: (() => {
              const head = t.csv!.rows.slice(0, skipHeader);
              const body = t.csv!.rows.slice(skipHeader).map((r) => r.slice());
              body.sort((ra, rb) =>
                dir === "asc"
                  ? cmp(ra[col] ?? "", rb[col] ?? "")
                  : cmp(rb[col] ?? "", ra[col] ?? ""),
              );
              return [...head, ...body];
            })(),
          },
        }), `sort:${Date.now()}`);
      }),
    ),

  filterColumnKeepMatches: (tabId, col, query) => {
    let kept = 0;
    set((s) =>
      patchTab(s, tabId, (t) => {
        const q = query.toLowerCase();
        const matches = (v: string) => v.toLowerCase().includes(q);
        const keep = (cellValue: string) =>
          query === "" || matches(cellValue);
        const skipHeader = t.freezeHeader && rowCountOf(t) > 1 ? 1 : 0;
        if (t.kind === "xlsx") {
          if (!t.xlsx) return null;
          return applyMutation(t, () => ({
            xlsx: mapActiveSheetRows(t.xlsx!, (rows) => {
              const head = rows.slice(0, skipHeader);
              const body = rows
                .slice(skipHeader)
                .filter((r) => keep(r[col]?.value ?? ""));
              kept = body.length;
              return [...head, ...body];
            }),
          }), `filter:${Date.now()}`);
        }
        if (!t.csv) return null;
        return applyMutation(t, () => ({
          csv: {
            ...t.csv!,
            rows: (() => {
              const head = t.csv!.rows.slice(0, skipHeader);
              const body = t.csv!
                .rows.slice(skipHeader)
                .filter((r) => keep(r[col] ?? ""));
              kept = body.length;
              return [...head, ...body];
            })(),
          },
        }), `filter:${Date.now()}`);
      }),
    );
    return kept;
  },

  addCsvTab: (path, data, sizeBytes) => {
    const existing = get().tabs.find((t) => t.path !== null && t.path === path);
    if (existing) {
      set({ activeId: existing.id });
      return;
    }
    const id = idCounter++;
    const tab: Tab = {
      id,
      path,
      kind: "csv",
      title: path ? baseTitle(path) : `untitled-${id}.csv`,
      dirty: false,
      sizeBytes,
      freezeHeader: false,
      colWidths: {},
      csv: data,
      past: [],
      future: [],
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: id }));
  },

  addXlsxTab: (path, data, sizeBytes) => {
    const existing = get().tabs.find((t) => t.path !== null && t.path === path);
    if (existing) {
      set({ activeId: existing.id });
      return;
    }
    const id = idCounter++;
    const tab: Tab = {
      id,
      path,
      kind: "xlsx",
      title: baseTitle(path),
      dirty: false,
      sizeBytes,
      freezeHeader: false,
      colWidths: {},
      xlsx: data,
      past: [],
      future: [],
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: id }));
  },

  addDocxTab: (path, data, sizeBytes) => {
    const existing = get().tabs.find((t) => t.path !== null && t.path === path);
    if (existing) {
      set({ activeId: existing.id });
      return;
    }
    const id = idCounter++;
    const tab: Tab = {
      id,
      path,
      kind: "docx",
      title: baseTitle(path),
      dirty: false,
      sizeBytes,
      freezeHeader: false,
      colWidths: {},
      docx: data,
      past: [],
      future: [],
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: id }));
  },

  setDocxContent: (tabId, html, json) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.docx
          ? { ...t, dirty: true, docx: { html, json } }
          : t,
      ),
    })),

  addRawTab: (raw) => {
    const id = idCounter++;
    set((s) => ({ tabs: [...s.tabs, { ...raw, id }], activeId: id }));
    return id;
  },

  closeTab: (id) => {
    const { tabs, activeId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const nextTabs = tabs.filter((t) => t.id !== id);
    let nextActive = activeId;
    if (activeId === id) {
      const neighbour = nextTabs[Math.min(idx, nextTabs.length - 1)];
      nextActive = neighbour ? neighbour.id : null;
    }
    set({ tabs: nextTabs, activeId: nextActive });
  },

  setActive: (id) => set({ activeId: id }),

  cycleTab: (dir) => {
    const { tabs, activeId } = get();
    if (tabs.length < 2) return;
    const idx = tabs.findIndex((t) => t.id === activeId);
    const next = (idx + dir + tabs.length) % tabs.length;
    set({ activeId: tabs[next].id });
  },

  newCsv: () => {
    get().addCsvTab(null, emptyCsv(), null);
  },

  setCsvCell: (tabId, row, col, value) =>
    set((s) =>
      patchTab(s, tabId, (t) => {
        if (!t.csv) return null;
        return applyMutation(t, () => ({
          csv: {
            ...t.csv!,
            rows: replaceInRows(t.csv!.rows, row, col, value),
          },
        }), `cell:${tabId}:${row}:${col}`);
      }),
    ),

  setXlsxCell: (tabId, row, col, value) =>
    set((s) =>
      patchTab(s, tabId, (t) => {
        if (!t.xlsx) return null;
        return applyMutation(t, () => ({
          xlsx: mapActiveSheetRows(t.xlsx!, (rows) =>
            replaceInXlsxRows(rows, row, col, value),
          ),
        }), `cell:${tabId}:${row}:${col}`);
      }),
    ),

  setCellsBlock: (tabId, startRow, startCol, values, tag) =>
    set((s) =>
      patchTab(s, tabId, (t) => {
        const width = values.reduce((m, r) => Math.max(m, r.length), 0);
        if (t.kind === "xlsx") {
          if (!t.xlsx) return null;
          return applyMutation(t, () => ({
            xlsx: mapActiveSheetRows(t.xlsx!, (rows) => {
              const next = cloneXlsxRows(rows, startRow + values.length, Math.max(widthOfXlsx(rows), startCol + width));
              values.forEach((line, dr) => {
                line.forEach((val, dc) => {
                  const target = next[startRow + dr]!;
                  while (target.length < startCol + width) target.push(emptyCell());
                  target[startCol + dc] = { value: val, kind: sniffKind(val) };
                });
              });
              return next;
            }),
          }), tag);
        }
        if (!t.csv) return null;
        return applyMutation(t, () => ({
          csv: {
            ...t.csv!,
            rows: (() => {
              const rows = t.csv!.rows.map((r) => r.slice());
              values.forEach((line, dr) => {
                const r = startRow + dr;
                while (rows.length <= r) rows.push([]);
                const target = rows[r]!;
                while (target.length < startCol + width) target.push("");
                line.forEach((val, dc) => {
                  target[startCol + dc] = val;
                });
              });
              return rows;
            })(),
          },
        }), tag);
      }),
    ),

  insertRow: (tabId, at) =>
    set((s) =>
      patchTab(s, tabId, (t) => {
        const width = colCountOf(t);
        if (t.kind === "xlsx") {
          if (!t.xlsx) return null;
          return applyMutation(t, () => ({
            xlsx: mapActiveSheetRows(t.xlsx!, (rows) => {
              const blank: XlsxCellData[] = Array.from({ length: width }, () => emptyCell());
              const next = rows.map((r) => r.slice());
              next.splice(at, 0, blank);
              return next;
            }),
          }));
        }
        if (!t.csv) return null;
        return applyMutation(t, () => ({
          csv: {
            ...t.csv!,
            rows: (() => {
              const blank: string[] = Array.from({ length: width }, () => "");
              const next = t.csv!.rows.map((r) => r.slice());
              next.splice(at, 0, blank);
              return next;
            })(),
          },
        }));
      }),
    ),

  deleteRow: (tabId, at) =>
    set((s) =>
      patchTab(s, tabId, (t) => {
        if (rowCountOf(t) === 0) return null;
        if (t.kind === "xlsx") {
          if (!t.xlsx) return null;
          return applyMutation(t, () => ({
            xlsx: mapActiveSheetRows(t.xlsx!, (rows) => {
              const next = rows.map((r) => r.slice());
              next.splice(at, 1);
              return next;
            }),
          }));
        }
        if (!t.csv) return null;
        return applyMutation(t, () => ({
          csv: { ...t.csv!, rows: spliceAt(t.csv!.rows, at) },
        }));
      }),
    ),

  insertCol: (tabId, at) =>
    set((s) =>
      patchTab(s, tabId, (t) => {
        if (t.kind === "xlsx") {
          if (!t.xlsx) return null;
          return applyMutation(t, () => ({
            xlsx: mapActiveSheetRows(t.xlsx!, (rows) =>
              rows.map((r) => {
                const copy = r.slice();
                copy.splice(at, 0, emptyCell());
                return copy;
              }),
            ),
          }));
        }
        if (!t.csv) return null;
        return applyMutation(t, () => ({
          csv: {
            ...t.csv!,
            rows: t.csv!.rows.map((r) => {
              const copy = r.slice();
              copy.splice(at, 0, "");
              return copy;
            }),
          },
        }));
      }),
    ),

  deleteCol: (tabId, at) =>
    set((s) =>
      patchTab(s, tabId, (t) => {
        if (t.kind === "xlsx") {
          if (!t.xlsx) return null;
          return applyMutation(t, () => ({
            xlsx: mapActiveSheetRows(t.xlsx!, (rows) =>
              rows.map((r) => {
                const copy = r.slice();
                if (at < copy.length) copy.splice(at, 1);
                return copy;
              }),
            ),
          }));
        }
        if (!t.csv) return null;
        return applyMutation(t, () => ({
          csv: {
            ...t.csv!,
            rows: t.csv!.rows.map((r) => {
              const copy = r.slice();
              if (at < copy.length) copy.splice(at, 1);
              return copy;
            }),
          },
        }));
      }),
    ),

  undo: (tabId) =>
    set((s) =>
      patchTab(s, tabId, (t) => {
        if (t.past.length === 0) return null;
        lastTagRef.tag = null;
        const prev = t.past[t.past.length - 1];
        return {
          ...restoreSnapshot(t, prev),
          past: t.past.slice(0, -1),
          future: [currentSnapshot(t), ...t.future].slice(0, HISTORY_LIMIT),
        };
      }),
    ),

  redo: (tabId) =>
    set((s) =>
      patchTab(s, tabId, (t) => {
        if (t.future.length === 0) return null;
        lastTagRef.tag = null;
        const nextSnap = t.future[0];
        return {
          ...restoreSnapshot(t, nextSnap),
          past: [...t.past, currentSnapshot(t)],
          future: t.future.slice(1),
        };
      }),
    ),

  markSaved: (tabId, path, sizeBytes) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? { ...t, path, title: baseTitle(path), dirty: false, sizeBytes, future: [] }
          : t,
      ),
    })),

  toggleFreezeHeader: (tabId) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, freezeHeader: !t.freezeHeader } : t,
      ),
    })),

  setColWidth: (tabId, col, width) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, colWidths: { ...t.colWidths, [col]: width } } : t,
      ),
    })),

  setActiveSheet: (tabId, index) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.xlsx
          ? { ...t, xlsx: { ...t.xlsx, activeSheet: index }, colWidths: {} }
          : t,
      ),
    })),

  addSheet: (tabId) =>
    set((s) =>
      patchTab(s, tabId, (t) => {
        if (!t.xlsx) return null;
        let n = t.xlsx.sheets.length + 1;
        let name = `Sheet${n}`;
        while (t.xlsx.sheets.some((sh) => sh.name === name)) {
          n += 1;
          name = `Sheet${n}`;
        }
        return applyMutation(t, () => ({
          xlsx: {
            ...t.xlsx!,
            sheets: [
              ...t.xlsx!.sheets.map((sh) => ({ ...sh })),
              { name, rows: [[emptyCell()]] },
            ],
            activeSheet: t.xlsx!.sheets.length,
          },
        }), `addsheet:${Date.now()}`);
      }),
    ),

  deleteSheet: (tabId, index) =>
    set((s) =>
      patchTab(s, tabId, (t) => {
        if (!t.xlsx || t.xlsx.sheets.length <= 1) return null;
        return applyMutation(t, () => {
          const sheets = t.xlsx!.sheets
            .filter((_, i) => i !== index)
            .map((sh) => ({ ...sh }));
          return {
            xlsx: {
              sheets,
              activeSheet: Math.max(0, Math.min(t.xlsx!.activeSheet, sheets.length - 1)),
            },
          };
        }, `delsheet:${Date.now()}`);
      }),
    ),

  renameSheet: (tabId, index, name) =>
    set((s) =>
      patchTab(s, tabId, (t) => {
        const clean = name.trim();
        if (!t.xlsx || !clean) return null;
        if (t.xlsx.sheets.some((sh, i) => i !== index && sh.name === clean)) return null;
        return applyMutation(t, () => ({
          xlsx: {
            ...t.xlsx!,
            sheets: t.xlsx!.sheets.map((sh, i) =>
              i === index ? { ...sh, name: clean } : sh,
            ),
          },
        }), `rensheet:${Date.now()}`);
      }),
    ),
}));

// --- pure helpers --------------------------------------------------------

function replaceInRows(rows: string[][], row: number, col: number, value: string): string[][] {
  const next = rows.map((r) => r.slice());
  while (next.length <= row) next.push([]);
  const target = next[row]!;
  while (target.length <= col) target.push("");
  target[col] = value;
  return next;
}

function replaceInXlsxRows(
  rows: XlsxCellData[][],
  row: number,
  col: number,
  value: string,
): XlsxCellData[][] {
  const next = rows.map((r) => r.slice());
  while (next.length <= row) next.push([]);
  const target = next[row]!;
  while (target.length <= col) target.push(emptyCell());
  target[col] = { value, kind: sniffKind(value) };
  return next;
}

function mapActiveSheetRows(
  doc: XlsxDocData,
  fn: (rows: XlsxCellData[][]) => XlsxCellData[][],
): XlsxDocData {
  return {
    ...doc,
    sheets: doc.sheets.map((sh, i) =>
      i === doc.activeSheet ? { ...sh, rows: fn(sh.rows) } : sh,
    ),
  };
}

function cloneXlsxRows(rows: XlsxCellData[][], minRows: number, minCols: number): XlsxCellData[][] {
  const next = rows.map((r) => r.slice());
  while (next.length < minRows) next.push([]);
  for (const r of next) {
    while (r.length < minCols) r.push(emptyCell());
  }
  return next;
}

function widthOfXlsx(rows: XlsxCellData[][]): number {
  let max = 1;
  for (const r of rows) max = Math.max(max, r.length);
  return max;
}

function spliceAt<T>(rows: T[][], at: number): T[][] {
  const next = rows.map((r) => r.slice());
  next.splice(at, 1);
  return next;
}

function colCountOf(t: Tab): number {
  let max = 1;
  for (const r of activeRows(t)) max = Math.max(max, r.length);
  return max;
}

function rowCountOf(t: Tab): number {
  return activeRows(t).length;
}

function currentSnapshot(t: Tab): unknown {
  return t.kind === "xlsx" ? t.xlsx!.sheets : t.csv!.rows;
}

function countOccurrences(haystack: string, needle: string, caseSensitive: boolean): number {
  const h = caseSensitive ? haystack : haystack.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  let count = 0;
  let idx = h.indexOf(n);
  while (idx !== -1) {
    count++;
    idx = h.indexOf(n, idx + n.length);
  }
  return count;
}

function replaceAllStrings(
  haystack: string,
  needle: string,
  replacement: string,
  caseSensitive: boolean,
): string {
  // escape regex metacharacters so the query is treated literally
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return haystack.replace(new RegExp(esc, caseSensitive ? "g" : "gi"), () => replacement);
}

function cellText(cell: XlsxCellData | undefined): string {
  return cell?.value ?? "";
}

function columnIsNumeric(t: Tab, col: number): boolean {
  const rows = activeRows(t);
  const skipHeader = t.freezeHeader && rows.length > 1 ? 1 : 0;
  let seen = 0;
  let numeric = 0;
  for (let r = skipHeader; r < rows.length; r++) {
    const v =
      typeof rows[r]![col] === "string"
        ? (rows[r]![col] as string)
        : ((rows[r]![col] as XlsxCellData | undefined)?.value ?? "");
    if (v.trim() === "") continue;
    seen++;
    if (!Number.isNaN(parseFloat(v))) numeric++;
  }
  return seen > 0 && numeric === seen;
}

export function getActiveTab(state: TabsState): Tab | undefined {
  return state.tabs.find((t) => t.id === state.activeId);
}
