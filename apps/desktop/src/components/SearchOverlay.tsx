import { useEffect, useRef } from "react";
import { useTabs } from "../state/tabsStore";

export default function SearchOverlay() {
  const open = useTabs((s) => s.searchOpen);
  const query = useTabs((s) => s.searchQuery);
  const matches = useTabs((s) => s.searchMatches);
  const index = useTabs((s) => s.searchIndex);
  const runSearch = useTabs((s) => s.runSearch);
  const stepSearch = useTabs((s) => s.stepSearch);
  const closeSearch = useTabs((s) => s.closeSearch);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="search-overlay">
      <input
        ref={inputRef}
        value={query}
        placeholder="Find…"
        onChange={(e) => runSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            stepSearch(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            closeSearch();
          }
        }}
      />
      <span className="search-count">
        {query
          ? matches.length > 0
            ? `${index + 1} / ${matches.length}`
            : "no matches"
          : ""}
      </span>
      <button
        className="tb-btn"
        disabled={matches.length === 0}
        onClick={() => stepSearch(-1)}
      >
        ↑
      </button>
      <button
        className="tb-btn"
        disabled={matches.length === 0}
        onClick={() => stepSearch(1)}
      >
        ↓
      </button>
      <button className="tb-btn" onClick={closeSearch}>
        ×
      </button>
    </div>
  );
}
