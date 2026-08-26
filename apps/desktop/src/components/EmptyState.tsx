import { useEffect, useState } from "react";
import { getRecents } from "../lib/recent";
import { openPath, openFileDialog } from "../lib/files";
import { useTabs } from "../state/tabsStore";

export default function EmptyState() {
  const [recents, setRecents] = useState<string[]>([]);
  const newCsv = useTabs((s) => s.newCsv);

  useEffect(() => {
    void getRecents().then(setRecents);
  }, []);

  return (
    <div className="empty-state">
      <h2>MiniOffice</h2>
      <p>A tiny, fast viewer and editor for Office files.</p>
      <div className="empty-actions">
        <button className="tb-btn primary" onClick={() => void openFileDialog()}>
          Open File…
        </button>
        <button className="tb-btn" onClick={newCsv}>
          New CSV
        </button>
      </div>
      <p className="empty-hint">
        …or drag a .csv file anywhere into this window.
      </p>
      {recents.length > 0 && (
        <div className="recents">
          <h3>Recent files</h3>
          {recents.map((p) => (
            <button key={p} className="recent-item" onClick={() => void openPath(p)}>
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
