import { describe, it, expect, beforeEach } from "vitest";
import { useTabs } from "../src/state/tabsStore";
import type { XlsxDocData } from "../src/lib/types";

function cell(value: string, formula?: string) {
  return {
    value,
    kind: (/^-?\d+(\.\d+)?$/.test(value) ? "number" : "text") as
      | "number"
      | "text",
    ...(formula ? { formula } : {}),
  };
}

function xlsx(sheets: Array<{ name: string; rows: ReturnType<typeof cell>[][] }>): XlsxDocData {
  return { sheets, activeSheet: 0 };
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

describe("xlsx store", () => {
  it("opens an xlsx tab with sheets", () => {
    useTabs.getState().addXlsxTab(
      "/tmp/book.xlsx",
      xlsx([
        { name: "A", rows: [[cell("1")]] },
        { name: "B", rows: [[cell("2")]] },
      ]),
      null,
    );
    const tab = activeTab();
    expect(tab.kind).toBe("xlsx");
    expect(tab.title).toBe("book.xlsx");
    expect(tab.xlsx!.sheets.map((s) => s.name)).toEqual(["A", "B"]);
  });

  it("edits cells on the active sheet and sniffs number kinds", () => {
    useTabs.getState().addXlsxTab(
      "/tmp/book.xlsx",
      xlsx([{ name: "S", rows: [[cell("x")]] }]),
      null,
    );
    const id = activeTab().id;
    useTabs.getState().setXlsxCell(id, 0, 0, "42");
    expect(activeTab().xlsx!.sheets[0]!.rows[0]![0]).toEqual({
      value: "42",
      kind: "number",
    });
  });

  it("switches sheets and mutates the right one", () => {
    useTabs.getState().addXlsxTab(
      "/tmp/b.xlsx",
      xlsx([
        { name: "One", rows: [[cell("a")]] },
        { name: "Two", rows: [[cell("b")]] },
      ]),
      null,
    );
    const id = activeTab().id;
    useTabs.getState().setActiveSheet(id, 1);
    useTabs.getState().setXlsxCell(id, 0, 0, "changed");
    const sheets = activeTab().xlsx!.sheets;
    expect(sheets[0]!.rows[0]![0].value).toBe("a");
    expect(sheets[1]!.rows[0]![0].value).toBe("changed");
  });

  it("adds, renames, and deletes sheets", () => {
    useTabs.getState().addXlsxTab(
      "/tmp/b.xlsx",
      xlsx([{ name: "Only", rows: [[cell("1")]] }]),
      null,
    );
    const id = activeTab().id;
    useTabs.getState().addSheet(id);
    expect(activeTab().xlsx!.sheets.map((s) => s.name)).toEqual(["Only", "Sheet2"]);
    expect(activeTab().xlsx!.activeSheet).toBe(1);

    useTabs.getState().renameSheet(id, 1, "Extra");
    expect(activeTab().xlsx!.sheets[1]!.name).toBe("Extra");

    // cannot rename onto an existing name
    useTabs.getState().renameSheet(id, 1, "Only");
    expect(activeTab().xlsx!.sheets[1]!.name).toBe("Extra");

    useTabs.getState().deleteSheet(id, 1);
    expect(activeTab().xlsx!.sheets.length).toBe(1);
    expect(activeTab().xlsx!.activeSheet).toBe(0);

    // last remaining sheet cannot be deleted
    useTabs.getState().deleteSheet(id, 0);
    expect(activeTab().xlsx!.sheets.length).toBe(1);
  });

  it("undoes a sheet deletion", () => {
    useTabs.getState().addXlsxTab(
      "/tmp/b.xlsx",
      xlsx([
        { name: "Keep", rows: [[cell("1")]] },
        { name: "Doomed", rows: [[cell("2")]] },
      ]),
      null,
    );
    const id = activeTab().id;
    useTabs.getState().deleteSheet(id, 1);
    expect(activeTab().xlsx!.sheets.length).toBe(1);
    useTabs.getState().undo(id);
    expect(activeTab().xlsx!.sheets.map((s) => s.name)).toEqual(["Keep", "Doomed"]);
  });

  it("searches values across the active sheet", () => {
    useTabs.getState().addXlsxTab(
      "/tmp/b.xlsx",
      xlsx([
        {
          name: "S",
          rows: [[cell("Alpha")], [cell("beta")], [cell("ALPHA!")]],
        },
      ]),
      null,
    );
    useTabs.getState().runSearch("alpha");
    expect(useTabs.getState().searchMatches).toEqual([
      { row: 0, col: 0 },
      { row: 2, col: 0 },
    ]);
  });

  it("row/col ops apply to the active sheet only", () => {
    useTabs.getState().addXlsxTab(
      "/tmp/b.xlsx",
      xlsx([
        { name: "One", rows: [[cell("a"), cell("b")]] },
        { name: "Two", rows: [[cell("c")]] },
      ]),
      null,
    );
    const id = activeTab().id;
    useTabs.getState().insertRow(id, 1);
    useTabs.getState().insertCol(id, 0);
    let sheets = activeTab().xlsx!.sheets;
    expect(sheets[0]!.rows.length).toBe(2);
    expect(sheets[0]!.rows[0]!.length).toBe(3);
    expect(sheets[1]!.rows).toEqual([[cell("c")]]);

    useTabs.getState().deleteRow(id, 1);
    useTabs.getState().deleteCol(id, 0);
    sheets = activeTab().xlsx!.sheets;
    expect(sheets[0]!.rows).toEqual([[cell("a"), cell("b")]]);
  });
});
