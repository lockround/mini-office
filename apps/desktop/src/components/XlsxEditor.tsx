import { useCallback, useEffect, useMemo, useState } from "react";
import SpreadsheetGrid, { colName } from "./SpreadsheetGrid";
import { GridHint } from "./CsvEditor";
import type { Highlight } from "@glideapps/glide-data-grid";
import { useTabs } from "../state/tabsStore";
import { useUi } from "../state/uiStore";

interface Props {
  tabId: number;
}

export default function XlsxEditor({ tabId }: Props) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === tabId));
  const setXlsxCell = useTabs((s) => s.setXlsxCell);
  const setCellsBlock = useTabs((s) => s.setCellsBlock);
  const setColWidth = useTabs((s) => s.setColWidth);
  const setActiveSheet = useTabs((s) => s.setActiveSheet);
  const addSheet = useTabs((s) => s.addSheet);
  const deleteSheet = useTabs((s) => s.deleteSheet);
  const renameSheet = useTabs((s) => s.renameSheet);
  const searchOpen = useTabs((s) => s.searchOpen);
  const searchQuery = useTabs((s) => s.searchQuery);
  const searchMatches = useTabs((s) => (s.activeId === tabId ? s.searchMatches : []));
  const searchIndex = useTabs((s) => (s.activeId === tabId ? s.searchIndex : 0));

  // selected anchor cell for the formula bar
  const [anchor, setAnchor] = useState<{ row: number; col: number } | null>(null);
  const dark = useUi((s) => s.theme === "dark");

  const sheet =
    tab?.xlsx && tab.xlsx.sheets[tab.xlsx.activeSheet]
      ? tab.xlsx.sheets[tab.xlsx.activeSheet]!
      : null;

  const rows = useMemo(
    () =>
      (sheet?.rows ?? []).map((r) => r.map((c) => c?.value ?? "")),
    [sheet],
  );

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

  const scrollTo =
    searchOpen && searchMatches.length > 0 ? searchMatches[searchIndex]! : null;

  const onCellEdit = useCallback(
    (row: number, col: number, value: string) => setXlsxCell(tabId, row, col, value),
    [tabId, setXlsxCell],
  );

  const onSetBlock = useCallback(
    (startRow: number, startCol: number, values: string[][], tag: string) =>
      setCellsBlock(tabId, startRow, startCol, values, tag),
    [tabId, setCellsBlock],
  );

  // reset anchor when switching sheets/tabs
  useEffect(() => {
    setAnchor(null);
  }, [tab?.id, tab?.xlsx?.activeSheet]);

  if (!tab || !tab.xlsx || !sheet) return null;

  const selectedCell =
    anchor && sheet.rows[anchor.row]?.[anchor.col]
      ? sheet.rows[anchor.row]![anchor.col]!
      : undefined;
  const cellRefText =
    anchor && anchor.col >= 0 && anchor.row >= 0
      ? `${colName(anchor.col)}${anchor.row + 1}`
      : "";
  const formulaBarValue = selectedCell
    ? selectedCell.formula
      ? `=${selectedCell.formula}`
      : selectedCell.value
    : "";

  const commitFormulaBar = (text: string) => {
    if (!anchor || anchor.row < 0 || anchor.col < 0) return;
    const trimmed = text.trim();
    if (trimmed.startsWith("=")) {
      useTabs.getState().setStatus(
        "Formulas are display-only in this version — edit values only",
      );
      return;
    }
    // plain value replaces any stored formula
    setXlsxCell(tabId, anchor.row, anchor.col, trimmed);
  };

  return (
    <div className="grid-wrap">
      <div className="formula-bar">
        <span className="formula-ref">{cellRefText}</span>
        <span className="formula-fx">fx</span>
        <input
          key={`${cellRefText}:${selectedCell?.formula ?? ""}:${selectedCell?.value ?? ""}`}
          className="formula-input"
          defaultValue={formulaBarValue}
          placeholder={cellRefText ? "" : "Select a cell"}
          disabled={!cellRefText}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitFormulaBar((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            }
          }}
          onBlur={(e) => {
            if (e.target.value !== formulaBarValue) {
              commitFormulaBar(e.target.value);
            }
          }}
        />
      </div>
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
        onSelectionChange={(row, col) =>
          setAnchor(row != null && col != null ? { row, col } : null)
        }
      />
      <div className="sheet-strip">
        {tab.xlsx.sheets.map((sh, i) => (
          <button
            key={`${sh.name}-${i}`}
            className={
              "sheet-tab" + (i === tab.xlsx!.activeSheet ? " active" : "")
            }
            onClick={() => setActiveSheet(tabId, i)}
            onDoubleClick={() => {
              const name = window.prompt("Rename sheet", sh.name);
              if (name) renameSheet(tabId, i, name);
            }}
            title="Double-click to rename"
          >
            {sh.name}
          </button>
        ))}
        <button
          className="sheet-add"
          title="Add sheet"
          onClick={() => addSheet(tabId)}
        >
          +
        </button>
        {tab.xlsx.sheets.length > 1 && (
          <button
            className="sheet-del"
            title={`Delete "${sheet.name}"`}
            onClick={() => {
              if (
                window.confirm(`Delete sheet "${sheet.name}"? This cannot be undone by the file itself.`)
              ) {
                deleteSheet(tabId, tab.xlsx!.activeSheet);
              }
            }}
          >
            −
          </button>
        )}
      </div>
      <GridHint />
    </div>
  );
}
