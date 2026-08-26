export type DocKind = "csv" | "xlsx" | "docx";

export type XlsxCellKind = "text" | "number" | "bool" | "error";

export interface XlsxCellData {
  value: string;
  formula?: string;
  kind: XlsxCellKind;
}

export interface XlsxSheetData {
  name: string;
  rows: XlsxCellData[][];
}

export interface XlsxDocData {
  sheets: XlsxSheetData[];
  activeSheet: number;
}

export interface CsvDocData {
  rows: string[][];
  delimiter: string;
  hasBom: boolean;
  crlf: boolean;
  /** encoding label from the backend: utf-8 | utf-8-bom | windows-1252 | utf-16le … */
  encoding?: string;
}

export interface SelectionStats {
  count: number;
  numericCount: number;
  sum: number;
  min: number;
  max: number;
}

export interface DocxDocData {
  /** html snapshot from import / latest editor state */
  html: string;
  /** tiptap JSON of the latest editor state (null until editor mounts) */
  json: unknown | null;
}

export interface Tab {
  id: number;
  path: string | null;
  kind: DocKind;
  title: string;
  dirty: boolean;
  sizeBytes: number | null;
  freezeHeader: boolean;
  colWidths: Record<number, number>;
  csv?: CsvDocData;
  xlsx?: XlsxDocData;
  docx?: DocxDocData;
  /** history snapshots: csv → rows ref; xlsx → sheets ref */
  past: unknown[];
  future: unknown[];
}

export interface CellPos {
  row: number;
  col: number;
}

const NUMBER_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

export function sniffKind(value: string): XlsxCellKind {
  return NUMBER_RE.test(value.trim()) ? "number" : "text";
}

export function activeRows(tab: Tab): unknown[][] {
  if (tab.kind === "xlsx") {
    const s = tab.xlsx?.sheets[tab.xlsx.activeSheet];
    return s ? (s.rows as unknown[][]) : [];
  }
  return (tab.csv?.rows as unknown[][]) ?? [];
}

export function rowCount(tab: Tab): number {
  return activeRows(tab).length;
}

export function colCount(tab: Tab): number {
  let max = 1;
  for (const r of activeRows(tab)) max = Math.max(max, r.length);
  return max;
}
