import { useEffect, useRef } from "react";
import { useTabs } from "../state/tabsStore";

export default function SearchOverlay() {
  const open = useTabs((s) => s.searchOpen);
  const query = useTabs((s) => s.searchQuery);
  const matches = useTabs((s) => s.searchMatches);
  const index = useTabs((s) => s.searchIndex);
  const caseSensitive = useTabs((s) => s.searchCaseSensitive);
  const runSearch = useTabs((s) => s.runSearch);
  const setSearchCaseSensitive = useTabs((s) => s.setSearchCaseSensitive);
  const stepSearch = useTabs((s) => s.stepSearch);
  const closeSearch = useTabs((s) => s.closeSearch);
  const replaceAllInGrid = useTabs((s) => s.replaceAllInGrid);
  const setStatus = useTabs((s) => s.setStatus);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  if (!open) return null;

  const doReplaceAll = () => {
    const replacement = replaceRef.current?.value ?? "";
    const activeId = useTabs.getState().activeId;
    if (activeId == null || !query) return;
    const n = replaceAllInGrid(activeId, query, replacement, caseSensitive);
    setStatus(
      n > 0
        ? `Replaced ${n} occurrence(s) of "${query}" — Ctrl+Z undoes`
        : `No occurrences of "${query}" to replace`,
    );
    runSearch(query); // refresh match list against updated data
  };

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
      <input
        className="search-replace"
        ref={replaceRef}
        placeholder="Replace with…"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            doReplaceAll();
          } else if (e.key === "Escape") {
            closeSearch();
          }
        }}
      />
      <label className="doc-find-case" title="Match case">
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(e) => {
            setSearchCaseSensitive(e.target.checked);
            runSearch(query);
          }}
        />
        Aa
      </label>
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
      <button
        className="tb-btn"
        disabled={!query || matches.length === 0}
        onClick={doReplaceAll}
        title="Replace all matches in this file"
      >
        Replace All
      </button>
      <button className="tb-btn" onClick={closeSearch}>
        ×
      </button>
    </div>
  );
}
