import { describe, it, expect, beforeEach } from "vitest";
import { useTabs } from "../src/state/tabsStore";
import type { CsvDocData } from "../src/lib/types";
import { computeStats } from "../src/lib/stats";

function csv(rows: string[][]): CsvDocData {
  return { rows, delimiter: ",", hasBom: false, crlf: false };
}

function activeTab() {
  const s = useTabs.getState();
  return s.tabs.find((t) => t.id === s.activeId)!;
}

beforeEach(() => {
  useTabs.setState({
    tabs: [],
    activeId: null,
    status: "Ready",
    searchOpen: false,
    searchQuery: "",
    searchCaseSensitive: false,
    searchMatches: [],
    searchIndex: 0,
    docFindOpen: false,
    selectionStats: null,
  });
});

describe("sort", () => {
  it("sorts numeric-aware ascending and descending", () => {
    useTabs.getState().addCsvTab(null, csv([["9"], ["10"], ["2"]]), null);
    const id = activeTab().id;
    useTabs.getState().sortColumn(id, 0, "asc");
    expect(activeTab().csv.rows.map((r) => r[0])).toEqual(["2", "9", "10"]);
    useTabs.getState().sortColumn(id, 0, "desc");
    expect(activeTab().csv.rows.map((r) => r[0])).toEqual(["10", "9", "2"]);
  });

  it("falls back to locale compare for text", () => {
    useTabs.getState().addCsvTab(null, csv([["banana"], ["Apple"], ["cherry"]]), null);
    const id = activeTab().id;
    useTabs.getState().sortColumn(id, 0, "asc");
    expect(activeTab().csv.rows.map((r) => r[0])).toEqual(["Apple", "banana", "cherry"]);
  });

  it("keeps the header row in place when freezeHeader is on", () => {
    useTabs
      .getState()
      .addCsvTab(null, csv([["name", "age"], ["bob", "30"], ["alice", "25"]]), null);
    const id = activeTab().id;
    useTabs.getState().toggleFreezeHeader(id);
    useTabs.getState().sortColumn(id, 0, "asc");
    const rows = activeTab().csv.rows;
    expect(rows[0]).toEqual(["name", "age"]); // untouched
    expect(rows[1]).toEqual(["alice", "25"]);
    expect(rows[2]).toEqual(["bob", "30"]);
  });

  it("sorts xlsx active sheet only and is undoable", () => {
    useTabs.getState().addXlsxTab(
      "/tmp/s.xlsx",
      {
        sheets: [
          { name: "A", rows: [[{ value: "3", kind: "number" as const }], [{ value: "1", kind: "number" as const }]] },
          { name: "B", rows: [[{ value: "z", kind: "text" as const }]] },
        ],
        activeSheet: 0,
      },
      null,
    );
    const id = activeTab().id;
    useTabs.getState().sortColumn(id, 0, "asc");
    expect(
      activeTab().xlsx!.sheets[0]!.rows.map((r) => r[0]!.value),
    ).toEqual(["1", "3"]);
    expect(activeTab().xlsx!.sheets[1]!.rows[0]![0]!.value).toBe("z"); // untouched
    useTabs.getState().undo(id);
    expect(activeTab().xlsx!.sheets[0]!.rows.map((r) => r[0]!.value)).toEqual(["3", "1"]);
  });
});

describe("filter (keep matches)", () => {
  it("keeps only matching rows, case-insensitively, undoable", () => {
    useTabs
      .getState()
      .addCsvTab(null, csv([["apple pie"], ["Banana split"], ["pineapple juice"]]), null);
    const id = activeTab().id;
    const kept = useTabs.getState().filterColumnKeepMatches(id, 0, "APPLE");
    expect(kept).toBe(2);
    expect(activeTab().csv.rows.map((r) => r[0])).toEqual([
      "apple pie",
      "pineapple juice",
    ]);
    useTabs.getState().undo(id);
    expect(activeTab().csv.rows).toHaveLength(3);
  });

  it("respects the header row when freezing", () => {
    useTabs
      .getState()
      .addCsvTab(null, csv([["fruit"], ["apple"], ["banana"]]), null);
    const id = activeTab().id;
    useTabs.getState().toggleFreezeHeader(id);
    useTabs.getState().filterColumnKeepMatches(id, 0, "banana");
    const rows = activeTab().csv.rows;
    expect(rows).toEqual([["fruit"], ["banana"]]); // header survives even though it doesn't match
  });

  it("filters xlsx by cell values", () => {
    useTabs.getState().addXlsxTab(
      "/tmp/f.xlsx",
      {
        sheets: [
          {
            name: "S",
            rows: [
              [{ value: "keep me", kind: "text" }],
              [{ value: "drop me", kind: "text" }],
            ],
          },
        ],
        activeSheet: 0,
      },
      null,
    );
    const id = activeTab().id;
    useTabs.getState().filterColumnKeepMatches(id, 0, "keep");
    expect(activeTab().xlsx!.sheets[0]!.rows).toHaveLength(1);
    expect(activeTab().xlsx!.sheets[0]!.rows[0]![0]!.value).toBe("keep me");
  });
});

describe("replaceAllInGrid", () => {
  it("replaces all occurrences case-insensitively by default and counts them", () => {
    useTabs.getState().addCsvTab(null, csv([["Foo foo FOO"]]), null);
    const id = activeTab().id;
    const n = useTabs.getState().replaceAllInGrid(id, "foo", "bar", false);
    expect(n).toBe(3);
    expect(activeTab().csv.rows[0]).toEqual(["bar bar bar"]);
  });

  it("respects match-case and treats the query literally", () => {
    useTabs.getState().addCsvTab(null, csv([["a.b axb a.b"]]), null);
    const id = activeTab().id;
    const n = useTabs.getState().replaceAllInGrid(id, "a.b", "-", true);
    expect(n).toBe(2);
    expect(activeTab().csv.rows[0]).toEqual(["- axb -"]);
  });

  it("works on xlsx cell values", () => {
    useTabs.getState().addXlsxTab(
      "/tmp/r.xlsx",
      {
        sheets: [
          { name: "S", rows: [[{ value: "old old", kind: "text" }], [{ value: "fresh", kind: "text" }]] },
        ],
        activeSheet: 0,
      },
      null,
    );
    const id = activeTab().id;
    const n = useTabs.getState().replaceAllInGrid(id, "old", "new", false);
    expect(n).toBe(2);
    expect(activeTab().xlsx!.sheets[0]!.rows[0]![0]!.value).toBe("new new");
    useTabs.getState().undo(id);
    expect(activeTab().xlsx!.sheets[0]!.rows[0]![0]!.value).toBe("old old");
  });
});

describe("search case sensitivity", () => {
  it("finds case-sensitively when enabled", () => {
    useTabs.getState().addCsvTab(null, csv([["Alpha"], ["alpha"]]), null);
    useTabs.getState().setSearchCaseSensitive(true);
    useTabs.getState().runSearch("Alpha");
    expect(useTabs.getState().searchMatches).toEqual([{ row: 0, col: 0 }]);
    useTabs.getState().setSearchCaseSensitive(false);
    useTabs.getState().runSearch("alpha");
    expect(useTabs.getState().searchMatches.length).toBe(2);
  });
});

describe("selection stats", () => {
  it("computes numeric stats and ignores blanks", () => {
    const s = computeStats(["10", "2.5", "", "-4", "abc", "  "]);
    expect(s.count).toBe(4); // includes "abc" as a non-empty non-numeric
    expect(s.numericCount).toBe(3);
    expect(s.sum).toBeCloseTo(8.5);
    expect(s.min).toBe(-4);
    expect(s.max).toBe(10);
  });

  it("store round-trips setSelectionStats", () => {
    useTabs.getState().addCsvTab(null, csv([["1"]]), null);
    useTabs.getState().setSelectionStats({ count: 3, numericCount: 3, sum: 6, min: 1, max: 3 });
    expect(useTabs.getState().selectionStats?.sum).toBe(6);
    useTabs.getState().setSelectionStats(null);
    expect(useTabs.getState().selectionStats).toBeNull();
  });
});
