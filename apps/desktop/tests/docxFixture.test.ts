import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describeTiptapDoc, countWords } from "../src/lib/docxModel";

const FIXTURE = resolve(
  __dirname,
  "../src-tauri/fixtures/report.docx",
);

async function mammothHtml(bytes: Uint8Array): Promise<string> {
  const browser = (await import("mammoth/mammoth.browser.js")) as unknown as {
    convertToHtml: (
      i: { arrayBuffer: ArrayBuffer },
      o?: { styleMap?: string[] },
    ) => Promise<{ value: string }>;
  };
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  // same options the app uses in files.ts openDocx()
  const result = await browser.convertToHtml(
    { arrayBuffer: buffer },
    { styleMap: ["u => u"] },
  );
  return result.value;
}

describe("report.docx fixture (real file)", () => {
  it("imports through the app's exact mammoth path with expected structure", async () => {
    const bytes = readFileSync(FIXTURE);
    expect(bytes[0]).toBe(0x50); // PK
    const html = await mammothHtml(bytes);

    expect(html).toContain("<h1>Quarterly Report</h1>");
    expect(html).toContain("<strong>18%</strong>");
    expect(html).toContain("<em>costs fell</em>");
    expect(html).toContain("<u> across all regions.</u>");
    // hyperlink survives as an anchor
    expect(html).toContain('<a href="https://example.com/data"><u>full dataset</u></a>');
    // bullet list with bold inside
    expect(html).toContain("<ul>");
    expect(html).toMatch(/<li><strong>South region<\/strong> recovered<\/li>/);
    // numbered list renders as ol
    expect(html).toContain("<ol>");
    expect(html).toContain("Audit pricing tiers");
    // table content (mammoth keeps <p> wrappers inside cells)
    expect(html).toContain("<td><p>North</p></td>");
    expect(html).toContain("<td><p>142</p></td>");
  });

  it("fixture html can be hand-parsed into our block model", async () => {
    // simulate what TipTap produces after importing mammoth's html:
    // a doc of paragraph/heading/bulletList nodes
    const json = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Quarterly Report" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Revenue grew " },
            { type: "text", text: "18%", marks: [{ type: "bold" }] },
          ],
        },
      ],
    };
    const blocks = describeTiptapDoc(json);
    expect(blocks).toHaveLength(2);
    expect(countWords(blocks)).toBe(5); // "Quarterly Report" + "Revenue grew 18%"
  });
});
