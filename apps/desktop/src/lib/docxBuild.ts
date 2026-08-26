/**
 * Renders the internal block model (see docxModel.ts) into a real .docx
 * payload using the `docx` library. Returns raw bytes for the Rust writer.
 */
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { ISectionOptions } from "docx";
import { describeTiptapDoc, type ParaSpec, type RunSpec } from "./docxModel";

const HEADING_MAP: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  H1: HeadingLevel.HEADING_1,
  H2: HeadingLevel.HEADING_2,
  H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4,
  H5: HeadingLevel.HEADING_5,
  H6: HeadingLevel.HEADING_6,
};

const ALIGN_MAP = {
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

function runsToDocx(runs: RunSpec[]) {
  return runs.map((r) => {
    const run = new TextRun({
      text: r.text,
      bold: r.bold || undefined,
      italics: r.italic || undefined,
      underline: r.underline ? {} : undefined,
    });
    if (r.link) {
      return new ExternalHyperlink({
        children: [run],
        link: r.link,
      });
    }
    return run;
  });
}

function paraToDocx(p: ParaSpec) {
  return new Paragraph({
    children: runsToDocx(p.runs),
    ...(p.style && HEADING_MAP[p.style] ? { heading: HEADING_MAP[p.style] } : {}),
    ...(p.align && p.align !== "left" && ALIGN_MAP[p.align]
      ? { alignment: ALIGN_MAP[p.align] }
      : {}),
    ...(p.bullet !== undefined ? { bullet: { level: p.bullet } } : {}),
    ...(p.numbered !== undefined
      ? { numbering: { reference: "minioffice-ordered", level: p.numbered } }
      : {}),
  });
}

export function buildDocxDocument(tiptapJson: unknown): Document {
  const blocks = describeTiptapDoc(tiptapJson as never);

  const usesOrdered = blocks.some(
    (b) => b.kind === "para" && b.numbered !== undefined,
  );

  const children = blocks.map((b) => {
    if (b.kind === "para") return paraToDocx(b);
    const rows = b.rows.map(
      (cells) =>
        new TableRow({
          children:
            cells.length > 0
              ? cells.map(
                  (paras) =>
                    new TableCell({
                      children:
                        paras.length > 0
                          ? paras.map(paraToDocx)
                          : [new Paragraph("")],
                    }),
                )
              : [new TableCell({ children: [new Paragraph("")] })],
        }),
    );
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows,
    });
  });

  return new Document({
    numbering: usesOrdered
      ? {
          config: [
            {
              reference: "minioffice-ordered",
              levels: [
                {
                  level: 0,
                  format: LevelFormat.DECIMAL,
                  text: "%1.",
                  alignment: AlignmentType.START,
                },
                {
                  level: 1,
                  format: LevelFormat.LOWER_LETTER,
                  text: "%2.",
                  alignment: AlignmentType.START,
                },
              ],
            },
          ],
        }
      : undefined,
    sections: [
      {
        children: children.length > 0 ? children : [new Paragraph("")],
      } satisfies ISectionOptions,
    ],
  });
}

/** Builds the final .docx bytes from a TipTap JSON document. */
export async function buildDocxBlob(tiptapJson: unknown): Promise<Uint8Array> {
  const doc = buildDocxDocument(tiptapJson);
  return Packer.toBuffer(doc);
}

// re-exports used by tests
export { describeTiptapDoc };
