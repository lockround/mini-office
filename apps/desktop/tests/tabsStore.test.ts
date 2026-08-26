import { describe, it, expect, beforeEach } from "vitest";
import { useTabs } from "../src/state/tabsStore";
import type { CsvDocData } from "../src/lib/types";

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
    searchMatches: [],
    searchIndex: 0,
  });
});

describe("tabs store", () => {
  it("opens a csv tab and focuses it", () => {
    useTabs.getState().addCsvTab("/tmp/a.csv", csv([["1", "2"]]), 4);
    const tab = activeTab();
    expect(tab.title).toBe("a.csv");
    expect(tab.dirty).toBe(false);
    expect(tab.csv.rows).toEqual([["1", "2"]]);
  });

  it("focuses an existing tab for the same path", () => {
    const s = useTabs.getState();
    s.addCsvTab("/tmp/a.csv", csv([["1"]]), null);
    s.addCsvTab("/tmp/b.csv", csv([["2"]]), null);
    s.addCsvTab("/tmp/a.csv", csv([["dup"]]), null);
    expect(useTabs.getState().tabs.length).toBe(2);
    expect(activeTab().title).toBe("a.csv");
  });

  it("edits cells, pads rows, marks dirty", () => {
    const s = useTabs.getState();
    s.addCsvTab(null, csv([["x"]]), null);
    s.setCsvCell(activeTab().id, 3, 5, "deep");
    const rows = activeTab().csv.rows;
    expect(rows.length).toBe(4);
    expect(rows[3]!.length).toBe(6);
    expect(rows[3]![5]).toBe("deep");
    expect(activeTab().dirty).toBe(true);
  });

  it("undoes and redoes a cell edit", () => {
    const s = useTabs.getState();
    s.addCsvTab(null, csv([["a", "b"]]), null);
    const id = activeTab().id;
    s.setCsvCell(id, 0, 0, "z");
    expect(activeTab().csv.rows[0]![0]).toBe("z");
    s.undo(id);
    expect(activeTab().csv.rows[0]![0]).toBe("a");
    s.redo(id);
    expect(activeTab().csv.rows[0]![0]).toBe("z");
  });

  it("coalesces rapid edits to the same cell into one undo step", () => {
    const s = useTabs.getState();
    s.addCsvTab(null, csv([[""]]), null);
    const id = activeTab().id;
    s.setCsvCell(id, 0, 0, "h");
    s.setCsvCell(id, 0, 0, "he");
    s.setCsvCell(id, 0, 0, "hel");
    expect(activeTab().past.length).toBe(1);
    s.undo(id);
    expect(activeTab().csv.rows[0]![0]).toBe("");
  });

  it("inserts and deletes rows and columns", () => {
    const s = useTabs.getState();
    s.addCsvTab(null, csv([["a", "b"], ["c", "d"]]), null);
    const id = activeTab().id;
    s.insertRow(id, 1);
    expect(activeTab().csv.rows.map((r) => r.length)).toEqual([2, 2, 2]);
    s.deleteRow(id, 1);
    expect(activeTab().csv.rows).toEqual([["a", "b"], ["c", "d"]]);
    s.insertCol(id, 1);
    expect(activeTab().csv.rows[0]).toEqual(["a", "", "b"]);
    s.deleteCol(id, 1);
    expect(activeTab().csv.rows[0]).toEqual(["a", "b"]);
  });

  it("pastes a block of values", () => {
    const s = useTabs.getState();
    s.addCsvTab(null, csv([["", ""], ["", ""]]), null);
    s.setCellsBlock(
      activeTab().id,
      0,
      1,
      [["p", "q"], ["r"]],
      "paste:1",
    );
    expect(activeTab().csv.rows[0]).toEqual(["", "p", "q"]);
    expect(activeTab().csv.rows[1]).toEqual(["", "r", ""]);
  });

  it("closes the active tab and activates a neighbour", () => {
    const s = useTabs.getState();
    s.addCsvTab("/tmp/a.csv", csv([["1"]]), null);
    s.addCsvTab("/tmp/b.csv", csv([["2"]]), null);
    const bId = activeTab().id;
    s.closeTab(bId);
    expect(useTabs.getState().tabs.length).toBe(1);
    expect(activeTab().title).toBe("a.csv");
  });

  it("finds matches case-insensitively in order", () => {
    const s = useTabs.getState();
    s.addCsvTab(null, csv([["Alpha"], ["beta"], ["ALPHA x"]]), null);
    useTabs.getState().runSearch("alpha");
    expect(useTabs.getState().searchMatches).toEqual([
      { row: 0, col: 0 },
      { row: 2, col: 0 },
    ]);
    useTabs.getState().stepSearch(1);
    expect(useTabs.getState().searchIndex).toBe(1);
    s.stepSearch(1); // wraps
    expect(useTabs.getState().searchIndex).toBe(0);
  });

  it("caps undo history", () => {
    const s = useTabs.getState();
    s.addCsvTab(null, csv([[""]]), null);
    const id = activeTab().id;
    for (let i = 0; i < 60; i++) {
      s.setCellsBlock(id, 0, 0, [[String(i)]], `tag-${i}`);
    }
    expect(activeTab().past.length).toBe(50);
  });
});
