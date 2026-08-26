import { describe, it, expect } from "vitest";
import { describeTiptapDoc, countWords } from "../src/lib/docxModel";

const text = (t: string, marks?: Array<Record<string, unknown>>) => ({
  type: "text",
  text: t,
  ...(marks ? { marks } : {}),
});

describe("describeTiptapDoc", () => {
  it("maps headings and paragraphs", () => {
    const blocks = describeTiptapDoc({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
        { type: "paragraph", content: [text("Body")] },
        { type: "heading", attrs: { level: 3 }, content: [text("Sub")] },
      ],
    });
    expect(blocks).toEqual([
      { kind: "para", runs: [{ text: "Title" }], style: "H1", align: undefined },
      { kind: "para", runs: [{ text: "Body" }] },
      { kind: "para", runs: [{ text: "Sub" }], style: "H3", align: undefined },
    ]);
  });

  it("captures bold/italic/underline/link marks and merges adjacent runs", () => {
    const blocks = describeTiptapDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            text("plain "),
            text("bold", [{ type: "bold" }]),
            text(" and more bold", [{ type: "bold" }]),
            text(" linked", [
              { type: "link", attrs: { href: "https://x.example" } },
            ]),
          ],
        },
      ],
    });
    const para = blocks[0]!;
    if (para.kind !== "para") throw new Error("expected para");
    expect(para.runs).toEqual([
      { text: "plain " },
      { text: "bold and more bold", bold: true },
      { text: " linked", link: "https://x.example" },
    ]);
  });

  it("flattens bullet and ordered lists with levels", () => {
    const blocks = describeTiptapDoc({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [text("one")] },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [{ type: "paragraph", content: [text("nested")] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [text("first")] }] },
          ],
        },
      ],
    });
    expect(
      blocks.map((b) =>
        b.kind === "para"
          ? {
              text: b.runs.map((r) => r.text).join(""),
              bullet: b.bullet,
              numbered: b.numbered,
            }
          : b,
      ),
    ).toEqual([
      { text: "one", bullet: 0, numbered: undefined },
      { text: "nested", bullet: 1, numbered: undefined },
      { text: "first", bullet: undefined, numbered: 0 },
    ]);
  });

  it("converts tables with cell paragraphs", () => {
    const blocks = describeTiptapDoc({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [text("A")] }],
                },
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [text("B")] }],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    { type: "paragraph", content: [text("a", [{ type: "bold" }])] },
                    { type: "paragraph", content: [text("b")] },
                  ],
                },
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [text("c")] }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(blocks).toHaveLength(1);
    const table = blocks[0]!;
    if (table.kind !== "table") throw new Error("expected table");
    expect(table.rows[0]![0]![0]!.runs).toEqual([{ text: "A" }]);
    // second row first cell has two paragraphs
    expect(table.rows[1]![0]).toHaveLength(2);
    expect(table.rows[1]![0]![0]!.runs[0]!.bold).toBe(true);
  });

  it("keeps alignment attributes", () => {
    const blocks = describeTiptapDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "center" },
          content: [text("mid")],
        },
      ],
    });
    expect(blocks[0]).toMatchObject({ align: "center" });
  });

  it("handles an empty document", () => {
    expect(describeTiptapDoc({ type: "doc", content: [] })).toEqual([]);
  });

  it("counts words across paragraphs and tables", () => {
    const blocks = describeTiptapDoc({
      type: "doc",
      content: [
        { type: "paragraph", content: [text("one two three")] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [text("four five")] }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(countWords(blocks)).toBe(5);
  });
});
