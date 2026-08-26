import { useCallback, useMemo, useRef } from "react";
import DataEditor, { GridCellKind } from "@glideapps/glide-data-grid";
import type {
  DataEditorRef,
  EditableGridCell,
  GridCell,
  GridColumn,
  GridKeyEventArgs,
  GridSelection,
  Highlight,
  Item,
  Rectangle,
} from "@glideapps/glide-data-grid";

export const SLACK_ROWS = 20;

const THEME = {
  accentColor: "#4c9aff",
  accentFg: "#10141b",
  accentLight: "#4c9aff22",
  textDark: "#d7dde6",
  textMedium: "#b8c0cc",
  textLight: "#9aa4b2",
  textBubble: "#d7dde6",
  bgIconHeader: "#1e2127",
  fgIconHeader: "#9aa4b2",
  textHeader: "#aab4c0",
  textHeaderSelected: "#ffffff",
  bgCell: "#16181d",
  bgCellMedium: "#191c22",
  bgHeader: "#1e2127",
  bgHeaderHasFocus: "#252a33",
  bgHeaderHovered: "#252a33",
  bgBubble: "#22262e",
  bgBubbleSelected: "#2a3040",
  bgSearchResult: "#f5a62344",
  borderColor: "#3a414d",
  drilldownBorder: "#3a414d",
  linkColor: "#4c9aff",
  cellHorizontalPadding: 8,
  cellVerticalPadding: 3,
  headerFontStyle: "600 12.5px",
  headerIconSize: 16,
  baseFontStyle: "13px",
  markerFontStyle: "11px",
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  editorFontSize: "13px",
  lineHeight: 20,
  horizontalBorderColor: "#262b34",
  headerBottomBorderColor: "#3a414d",
};

const THEME_LIGHT = {
  ...THEME,
  accentColor: "#2563eb",
  accentFg: "#ffffff",
  accentLight: "#2563eb18",
  textDark: "#1f2430",
  textMedium: "#3f4756",
  textLight: "#5b6472",
  textBubble: "#1f2430",
  bgIconHeader: "#eceef2",
  fgIconHeader: "#5b6472",
  textHeader: "#3f4756",
  textHeaderSelected: "#111111",
  bgCell: "#ffffff",
  bgCellMedium: "#f7f8fa",
  bgHeader: "#eceef2",
  bgHeaderHasFocus: "#e2e5ea",
  bgHeaderHovered: "#e2e5ea",
  bgBubble: "#f2f3f6",
  bgBubbleSelected: "#dbe4f5",
  bgSearchResult: "#f5a62355",
  borderColor: "#c9ced8",
  drilldownBorder: "#c9ced8",
  linkColor: "#2563eb",
  horizontalBorderColor: "#dde1e7",
  headerBottomBorderColor: "#c9ced8",
};

export function colName(index: number): string {
  let name = "";
  let n = index;
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

function rangesOf(sel: GridSelection | null): Rectangle[] {
  if (!sel?.current) return [];
  const rects: Rectangle[] = [];
  const cur = sel.current;
  if (cur.range) rects.push(cur.range);
  for (const r of cur.rangeStack ?? []) rects.push(r);
  if (rects.length === 0 && cur.cell) {
    rects.push({ x: cur.cell[0], y: cur.cell[1], width: 1, height: 1 });
  }
  return rects;
}

export function selectionTsv(
  rows: string[][],
  rects: Rectangle[],
): { text: string; cells: Array<[number, number]> } {
  const textParts: string[] = [];
  const cells: Array<[number, number]> = [];
  rects.forEach((rect) => {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      const line: string[] = [];
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        line.push(rows[y]?.[x] ?? "");
        cells.push([x, y]);
      }
      textParts.push(line.join("\t"));
    }
  });
  return { text: textParts.join("\n"), cells };
}

export interface SpreadsheetGridProps {
  /** display values, indexed [row][col] */
  rows: string[][];
  minCols?: number;
  boldFirstRow?: boolean;
  highlights?: Highlight[];
  /** when this cell changes, scroll it into view */
  scrollTo?: { row: number; col: number } | null;
  colWidths?: Record<number, number>;
  dark?: boolean;
  onColResize?: (col: number, width: number) => void;
  onCellEdit: (row: number, col: number, value: string) => void;
  onSetBlock: (
    startRow: number,
    startCol: number,
    values: string[][],
    tag: string,
  ) => void;
  onSelectionChange?: (row: number | null, col: number | null) => void;
}

export default function SpreadsheetGrid({
  rows,
  minCols = 8,
  boldFirstRow = false,
  highlights = [],
  scrollTo = null,
  colWidths = {},
  dark = true,
  onColResize,
  onCellEdit,
  onSetBlock,
  onSelectionChange,
}: SpreadsheetGridProps) {
  const gridRef = useRef<DataEditorRef>(null);
  const selectionRef = useRef<GridSelection | null>(null);

  const numCols = useMemo(() => {
    let max = minCols;
    for (const r of rows) max = Math.max(max, r.length);
    return max;
  }, [rows, minCols]);
  const numRows = rows.length + SLACK_ROWS;

  const columns: GridColumn[] = useMemo(() => {
    return Array.from({ length: numCols }, (_, i) => ({
      title: colName(i),
      width: colWidths[i] ?? 140,
    }));
  }, [numCols, colWidths]);

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, row] = cell;
      const value = rows[row]?.[col] ?? "";
      const gcell: GridCell = {
        kind: GridCellKind.Text,
        allowOverlay: true,
        displayData: value,
        data: value,
        ...(boldFirstRow && row === 0 && value !== ""
          ? {
              themeOverride: dark
                ? {
                    baseFontStyle: "600 13px",
                    bgCell: "#1e2127",
                    textDark: "#e8edf4",
                  }
                : {
                    baseFontStyle: "600 13px",
                    bgCell: "#eceef2",
                    textDark: "#111111",
                  },
            }
          : {}),
      };
      return gcell;
    },
    [rows, boldFirstRow],
  );

  // scroll to the requested cell whenever it changes identity
  const lastScrollKey = useRef("");
  const scrollKey = scrollTo ? `${scrollTo.row}:${scrollTo.col}` : "";
  if (scrollKey !== lastScrollKey.current) {
    lastScrollKey.current = scrollKey;
    if (scrollKey && scrollTo) {
      const target = scrollTo;
      queueMicrotask(() =>
        gridRef.current?.scrollTo(target.col, target.row, "both", 12, 12),
      );
    }
  }

  const handlePaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]) => {
      onSetBlock(target[1], target[0], values.map((r) => [...r]), `paste:${Date.now()}`);
      return true;
    },
    [onSetBlock],
  );

  const handleKeyDown = useCallback(
    (e: GridKeyEventArgs) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
        const rects = rangesOf(selectionRef.current);
        if (rects.length > 0) {
          const { text, cells } = selectionTsv(rows, rects);
          void navigator.clipboard.writeText(text).catch(() => {});
          for (const [cx, cy] of cells) {
            onCellEdit(cy, cx, "");
          }
          e.cancel();
        }
      }
    },
    [rows, onCellEdit],
  );

  const handleDelete = useCallback(
    (selection: GridSelection): boolean => {
      const rects = rangesOf(selection);
      for (const rect of rects) {
        const values = Array.from({ length: rect.height }, () =>
          Array.from({ length: rect.width }, () => ""),
        );
        onSetBlock(rect.y, rect.x, values, `del:${Date.now()}`);
      }
      return false;
    },
    [onSetBlock],
  );

  return (
    <div
      className="grid-area"
      style={{ flex: 1, minHeight: 0, minWidth: 0 }}
    >
      <DataEditor
      ref={gridRef}
      columns={columns}
      rows={numRows}
      getCellContent={getCellContent}
      onCellEdited={(cell: Item, newValue: EditableGridCell) => {
        if (newValue.kind !== GridCellKind.Text) return;
        onCellEdit(cell[1], cell[0], String(newValue.data ?? ""));
      }}
      onGridSelectionChange={(sel) => {
        selectionRef.current = sel;
        if (onSelectionChange) {
          const anchor = sel.current?.cell ?? null;
          onSelectionChange(anchor ? anchor[1] : null, anchor ? anchor[0] : null);
        }
      }}
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
      onDelete={handleDelete}
      getCellsForSelection={true}
      rowMarkers="both"
      highlightRegions={highlights.length > 0 ? highlights : undefined}
      smoothScrollX
      smoothScrollY
      width="100%"
      height="100%"
      theme={dark ? THEME : THEME_LIGHT}
        onColumnResize={(column, newSize) => {
          const idx = columns.findIndex((c) => c.title === column.title);
          if (idx >= 0 && onColResize) onColResize(idx, newSize);
        }}
      />
    </div>
  );
}
