import { colName } from "./SpreadsheetGrid";
import { useTabs } from "../state/tabsStore";

interface Props {
  tabId: number;
  /** selected column index, or null when nothing is selected */
  col: number | null;
}

/**
 * Sort / filter controls that act on the column of the current selection.
 * Filtering is destructive-but-undoable: non-matching rows are removed and
 * Ctrl+Z brings them back.
 */
export default function GridDataBar({ tabId, col }: Props) {
  const sortColumn = useTabs((s) => s.sortColumn);
  const filterColumnKeepMatches = useTabs((s) => s.filterColumnKeepMatches);
  const setStatus = useTabs((s) => s.setStatus);
  const hasCol = col != null && col >= 0;

  return (
    <div className="data-bar">
      <span className="data-bar-col">
        {hasCol ? `Column ${colName(col!)}` : "No column selected"}
      </span>
      <button
        className="tb-btn"
        disabled={!hasCol}
        title={`Sort by ${hasCol ? colName(col!) : ""} ascending`}
        onClick={() => hasCol && sortColumn(tabId, col!, "asc")}
      >
        Sort ↑
      </button>
      <button
        className="tb-btn"
        disabled={!hasCol}
        title={`Sort by ${hasCol ? colName(col!) : ""} descending`}
        onClick={() => hasCol && sortColumn(tabId, col!, "desc")}
      >
        Sort ↓
      </button>
      <button
        className="tb-btn"
        disabled={!hasCol}
        title="Remove rows that do not contain the given text in this column (Ctrl+Z restores)"
        onClick={() => {
          if (!hasCol) return;
          const q = window.prompt(
            `Keep only rows where column ${colName(col!)} contains:`,
          );
          if (q === null) return;
          const kept = filterColumnKeepMatches(tabId, col!, q);
          setStatus(
            q === ""
              ? "Filter cleared (all rows kept)"
              : `Kept ${kept} matching row(s) — Ctrl+Z restores the rest`,
          );
        }}
      >
        Keep matches…
      </button>
    </div>
  );
}
