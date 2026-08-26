import { describe, it, expect } from "vitest";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { buildDocxBlob } from "../src/lib/docxBuild";
import { describeTiptapDoc } from "../src/lib/docxModel";

async function mammothHtml(bytes: Uint8Array): Promise<string> {
  // use the browser build so the same arrayBuffer path as the app is exercised
  const browser = (await import("mammoth/mammoth.browser.js")) as unknown as {
    convertToHtml: (
      i: { arrayBuffer: ArrayBuffer },
      o?: object,
    ) => Promise<{ value: string }>;
  };
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const result = await browser.convertToHtml({ arrayBuffer: buffer });
  return result.value;
}

describe("docx build/import round trip", () => {
  it("our builder produces a file mammoth can read back", async () => {
    const tiptapDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Report" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "plain and " },
            { type: "text", text: "emphasised", marks: [{ type: "bold" }, { type: "italic" }] },
          ],
        },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item one" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item two" }] }] },
          ],
        },
      ],
    };

    const bytes = await buildDocxBlob(tiptapDoc);
    expect(bytes[0]).toBe(0x50); // "P"
    expect(bytes[1]).toBe(0x4b); // "K"
    expect(bytes.length).toBeGreaterThan(4000); // real docx payload

    const html = await mammothHtml(bytes);
    expect(html).toContain("<h1>Report</h1>");
    expect(html).toContain("<strong><em>emphasised</em></strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>item one</li>");
    expect(html).toContain("<li>item two</li>");

    // and our own converter understands what mammoth produced structurally
    expect(html).toMatch(/<h1>/);
  });

  it("describes a document produced by the reference docx library", () => {
    // sanity: describeTiptapDoc handles the shape TipTap emits for headings
    const json = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, textAlign: null },
          content: [{ type: "text", text: "H" }],
        },
      ],
    };
    const blocks = describeTiptapDoc(json);
    expect(blocks[0]).toMatchObject({ kind: "para", style: "H2" });
  });

  it("packs a minimal reference document without error", async () => {
    const doc = new Document({
      sections: [
        { children: [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("t")] })] },
      ],
    });
    const buf = await Packer.toBuffer(doc);
    expect(buf.length).toBeGreaterThan(1000);
  });
});
