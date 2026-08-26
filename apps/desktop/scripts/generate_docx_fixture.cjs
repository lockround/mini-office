// Generates fixtures/report.docx with headings, formatted runs, lists,
// a table, and a hyperlink — content typical of a real Word file.
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ExternalHyperlink,
} = require("docx");
const fs = require("fs");
const path = require("path");

const doc = new Document({
  sections: [
    {
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun("Quarterly Report")],
        }),
        new Paragraph({
          children: [
            new TextRun("Revenue grew "),
            new TextRun({ text: "18%", bold: true }),
            new TextRun(" while "),
            new TextRun({ text: "costs fell", italics: true }),
            new TextRun({ text: " across all regions.", underline: true }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun("See the "),
            new ExternalHyperlink({
              link: "https://example.com/data",
              children: [new TextRun({ text: "full dataset", underline: true })],
            }),
            // NOTE: must be a TextRun — a bare string child makes docx v9
            // silently drop every following child of the paragraph
            new TextRun("."),
          ],
        }),
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun("Highlights")],
        }),
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun("North region led growth")],
        }),
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: "South region", bold: true }), new TextRun(" recovered")],
        }),
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun("Next steps")],
        }),
        new Paragraph({
          numbering: { reference: "steps", level: 0 },
          children: [new TextRun("Audit pricing tiers")],
        }),
        new Paragraph({
          numbering: { reference: "steps", level: 0 },
          children: [new TextRun("Hire two engineers")],
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: ["Region", "Q1", "Q2"].map(
                (t) =>
                  new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: t, bold: true })] })],
                  }),
              ),
            }),
            new TableRow({
              children: ["North", "120", "142"].map(
                (t) => new TableCell({ children: [new Paragraph(t)] }),
              ),
            }),
            new TableRow({
              children: ["South", "98", "104"].map(
                (t) => new TableCell({ children: [new Paragraph(t)] }),
              ),
            }),
          ],
        }),
      ],
    },
  ],
  numbering: {
    config: [
      {
        reference: "steps",
        levels: [
          {
            level: 0,
            format: "decimal" === "decimal" ? require("docx").LevelFormat.DECIMAL : null,
            text: "%1.",
            alignment: require("docx").AlignmentType.START,
          },
        ],
      },
    ],
  },
});

const out = path.join(__dirname, "..", "src-tauri", "fixtures", "report.docx");
fs.mkdirSync(path.dirname(out), { recursive: true });
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(out, buf);
  console.log("wrote", out, buf.length, "bytes");
});
