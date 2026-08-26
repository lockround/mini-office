import { useEffect, useState } from "react";
import {
  clearRecoveries,
  loadRecoveries,
  type RecoveryEntry,
} from "../lib/recovery";
import { useTabs } from "../state/tabsStore";

export default function RecoveryDialog() {
  const [entries, setEntries] = useState<RecoveryEntry[] | null>(null);

  useEffect(() => {
    const found = loadRecoveries();
    if (found.length > 0) setEntries(found);
  }, []);

  if (!entries || entries.length === 0) return null;

  const recover = () => {
    for (const e of entries) {
      useTabs.getState().addRawTab({
        path: e.path,
        kind: e.kind,
        title: e.title,
        dirty: true,
        sizeBytes: null,
        freezeHeader: false,
        colWidths: {},
        csv: e.csv,
        xlsx: e.xlsx,
        docx: e.docx,
        past: [],
        future: [],
      });
    }
    useTabs
      .getState()
      .setStatus(`Recovered ${entries.length} unsaved file(s) — review and save`);
    clearRecoveries();
    setEntries(null);
  };

  const discard = () => {
    clearRecoveries();
    setEntries(null);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <p>
          MiniOffice was closed unexpectedly with unsaved changes.
          Recover {entries.length === 1 ? "it" : "them"}?
        </p>
        <ul className="recovery-list">
          {entries.map((e) => (
            <li key={e.key}>
              <span className="recovery-title">{e.title}</span>
              <span className="recovery-meta">
                {new Date(e.savedAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button className="tb-btn primary" onClick={recover}>
            Recover
          </button>
          <button className="tb-btn" onClick={discard}>
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
