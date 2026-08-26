import { useTabs } from "../state/tabsStore";
import { closeTabWithConfirm } from "../lib/files";

export default function FileTabs() {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const setActive = useTabs((s) => s.setActive);
  const newCsv = useTabs((s) => s.newCsv);

  if (tabs.length === 0) return null;

  return (
    <div className="tabs">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={"tab" + (t.id === activeId ? " active" : "")}
          onClick={() => setActive(t.id)}
          onAuxClick={(e) => {
            if (e.button === 1) void closeTabWithConfirm(t.id);
          }}
          title={t.path ?? t.title}
        >
          <span className="tab-label">
            {t.title}
            {t.dirty ? " *" : ""}
          </span>
          <button
            className="tab-close"
            title="Close (Ctrl+W)"
            onClick={(e) => {
              e.stopPropagation();
              void closeTabWithConfirm(t.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-add" onClick={newCsv} title="New CSV">
        +
      </button>
    </div>
  );
}
