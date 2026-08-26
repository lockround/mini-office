import { useCallback, useMemo, useState } from "react";
import SpreadsheetGrid, { colName } from "./SpreadsheetGrid";
import type { Highlight } from "@glideapps/glide-data-grid";
import { useTabs } from "../state/tabsStore";
import { useUi } from "../state/uiStore";
import GridDataBar from "./GridDataBar";
import { computeStats } from "../lib/stats";

interface Props {
  tabId: number;
}

export default function CsvEditor({ tabId }: Props) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === tabId));
  const dark = useUi((s) => s.theme === "dark");
  const setSelectionStats = useTabs((s) => s.setSelectionStats);
  const [anchorCol, setAnchorCol] = useState<number | null>(null);
  const setCsvCell = useTabs((s) => s.setCsvCell);
  const setCellsBlock = useTabs((s) => s.setCellsBlock);
  const setColWidth = useTabs((s) => s.setColWidth);
  const searchOpen = useTabs((s) => s.searchOpen);
  const searchQuery = useTabs((s) => s.searchQuery);
  const searchMatches = useTabs((s) => (s.activeId === tabId ? s.searchMatches : []));
  const searchIndex = useTabs((s) => (s.activeId === tabId ? s.searchIndex : 0));

  const rows = useMemo(() => tab?.csv?.rows ?? [], [tab?.csv?.rows]);

  const highlights: Highlight[] = useMemo(() => {
    if (!searchOpen || !searchQuery || searchMatches.length === 0) return [];
    const active = searchMatches[searchIndex];
    return searchMatches.map((m) => ({
      color:
        active && m.row === active.row && m.col === active.col
          ? "#f5a623cc"
          : "#4c9aff55",
      range: { x: m.col, y: m.row, width: 1, height: 1 },
    }));
  }, [searchMatches, searchOpen, searchQuery, searchIndex]);

  const scrollTo = searchOpen && searchMatches.length > 0 ? searchMatches[searchIndex]! : null;

  const onCellEdit = useCallback(
    (row: number, col: number, value: string) => setCsvCell(tabId, row, col, value),
    [tabId, setCsvCell],
  );

  const onSetBlock = useCallback(
    (startRow: number, startCol: number, values: string[][], tag: string) =>
      setCellsBlock(tabId, startRow, startCol, values, tag),
    [tabId, setCellsBlock],
  );

  if (!tab) return null;

  return (
    <div className="grid-wrap">
      <GridDataBar tabId={tabId} col={anchorCol} />
      <SpreadsheetGrid
        rows={rows}
        boldFirstRow={tab.freezeHeader}
        highlights={highlights}
        scrollTo={scrollTo}
        colWidths={tab.colWidths}
        dark={dark}
        onColResize={(col, width) => setColWidth(tabId, col, width)}
        onCellEdit={onCellEdit}
        onSetBlock={onSetBlock}
        onSelectionChange={(_row: number | null, col, range) => {
          setAnchorCol(col);
          if (!range || !tab) {
            setSelectionStats(null);
            return;
          }
          // cap the scan so huge selections don't stall the UI
          if (range.width * range.height > 200_000) {
            setSelectionStats(null);
            return;
          }
          const values: string[] = [];
          for (let r = range.y; r < range.y + range.height; r++) {
            const row = rows[r];
            if (!row) continue;
            for (let c = range.x; c < range.x + range.width; c++) {
              values.push(row[c] ?? "");
            }
          }
          setSelectionStats(computeStats(values));
        }}
      />
      <GridHint />
    </div>
  );
}

export function GridHint() {
  return (
    <div className="grid-hint">
      Click a cell to edit · Ctrl+C/X/V clipboard · Delete clears · drag column
      edges to resize
    </div>
  );
}

// re-export for consumers that need column labels
export { colName };
