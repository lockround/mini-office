import { useTabs } from "../state/tabsStore";
import { getActiveTab } from "../state/tabsStore";
import { useUi } from "../state/uiStore";
import { colCount, rowCount } from "../lib/types";
import {
  openFileDialog,
  saveActive,
  saveActiveAs,
} from "../lib/files";

export default function Toolbar() {
  const active = useTabs((s) => getActiveTab(s));
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);
  const newCsv = useTabs((s) => s.newCsv);
  const insertRow = useTabs((s) => s.insertRow);
  const deleteRow = useTabs((s) => s.deleteRow);
  const insertCol = useTabs((s) => s.insertCol);
  const deleteCol = useTabs((s) => s.deleteCol);
  const toggleFreezeHeader = useTabs((s) => s.toggleFreezeHeader);
  const setSearchOpen = useTabs((s) => s.setSearchOpen);

  // toolbar row/col ops act on the end of the file; grid-contextual ops come later
  const rCount = active ? rowCount(active) : 0;
  const cCount = active ? colCount(active) : 1;

  return (
    <div className="toolbar">
      <button className="tb-btn primary" onClick={() => void openFileDialog()}>
        Open
      </button>
      <button
        className="tb-btn"
        disabled={!active}
        onClick={() => void saveActive()}
      >
        Save
      </button>
      <button
        className="tb-btn"
        disabled={!active}
        onClick={() => void saveActiveAs()}
      >
        Save As
      </button>
      <span className="tb-sep" />
      <button className="tb-btn" onClick={newCsv}>
        New CSV
      </button>
      <span className="tb-sep" />
      <button
        className="tb-btn"
        disabled={!active}
        onClick={() => active && insertRow(active.id, rCount)}
      >
        + Row
      </button>
      <button
        className="tb-btn"
        disabled={!active || rCount === 0}
        onClick={() => active && deleteRow(active.id, rCount - 1)}
      >
        − Row
      </button>
      <button
        className="tb-btn"
        disabled={!active}
        onClick={() => active && insertCol(active.id, cCount)}
      >
        + Col
      </button>
      <button
        className="tb-btn"
        disabled={!active}
        onClick={() => active && deleteCol(active.id, cCount - 1)}
      >
        − Col
      </button>
      <span className="tb-sep" />
      <button
        className={"tb-btn toggle" + (active?.freezeHeader ? " on" : "")}
        disabled={!active}
        onClick={() => active && toggleFreezeHeader(active.id)}
        title="Treat first row as a frozen header (display only)"
      >
        Header
      </button>
      <span className="tb-sep" />
      <button
        className="tb-btn"
        onClick={() => setSearchOpen(true)}
        title="Search in current file (Ctrl+F)"
      >
        Find
      </button>
      <span className="tb-flex" />
      <button
        className="tb-btn"
        onClick={toggleTheme}
        title="Toggle light/dark theme"
      >
        {theme === "dark" ? "Light mode" : "Dark mode"}
      </button>
    </div>
  );
}
