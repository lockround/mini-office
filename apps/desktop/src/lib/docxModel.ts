/**
 * Converts a TipTap JSON document into a flat internal block model that can
 * be rendered into a .docx file. Kept dependency-free and pure for testing.
 */

export type Align = "left" | "center" | "right" | "justify";

export interface RunSpec {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  link?: string;
}

export interface ParaSpec {
  kind: "para";
  runs: RunSpec[];
  /** "H1".."H6" for headings; undefined = normal paragraph */
  style?: `H${number}`;
  align?: Align;
  /** bullet list nesting level (0-based); present when inside a bulletList */
  bullet?: number;
  /** present when inside an orderedList */
  numbered?: number;
}

export interface TableSpec {
  kind: "table";
  /** rows → cells → paragraphs */
  rows: ParaSpec[][][];
}

export type BlockSpec = ParaSpec | TableSpec;

interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
  content?: TiptapNode[];
  text?: string;
}

function alignOf(node: TiptapNode): Align | undefined {
  const a = node.attrs?.textAlign;
  if (
    a === "center" ||
    a === "right" ||
    a === "justify"
  )
    return a;
  return undefined;
}

function runsOf(nodes: TiptapNode[] | undefined, inherited: TiptapMark[]): RunSpec[] {
  if (!nodes) return [];
  const out: RunSpec[] = [];
  for (const n of nodes) {
    if (n.type === "text") {
      const marks = [...inherited, ...(n.marks ?? [])];
      const run: RunSpec = { text: n.text ?? "" };
      for (const m of marks) {
        if (m.type === "bold") run.bold = true;
        else if (m.type === "italic") run.italic = true;
        else if (m.type === "underline") run.underline = true;
        else if (m.type === "link")
          run.link = String(m.attrs?.href ?? "");
      }
      // merge with previous run when formatting is identical
      const prev = out[out.length - 1];
      if (
        prev &&
        prev.bold === run.bold &&
        prev.italic === run.italic &&
        prev.underline === run.underline &&
        prev.link === run.link
      ) {
        prev.text += run.text;
      } else {
        out.push(run);
      }
    } else if (n.content) {
      // inline wrappers we do not model (e.g. hardBreak) — flatten their text
      out.push(...runsOf(n.content, [...inherited, ...(n.marks ?? [])]));
    }
  }
  return out;
}

function paraFrom(
  node: TiptapNode,
  extra: Partial<ParaSpec> = {},
): ParaSpec {
  return {
    kind: "para",
    runs: runsOf(node.content, []),
    style: node.type === "heading" ? (`H${Number(node.attrs?.level ?? 1)}` as `H${number}`) : undefined,
    align: alignOf(node),
    ...extra,
  };
}

/** Walks the TipTap document and produces the flat block list. */
export function describeTiptapDoc(doc: TiptapNode): BlockSpec[] {
  const blocks: BlockSpec[] = [];

  const walkBlocks = (nodes: TiptapNode[] | undefined, depth: number): void => {
    if (!nodes) return;
    for (const node of nodes) {
      switch (node.type) {
        case "heading":
          blocks.push(paraFrom(node));
          break;
        case "paragraph":
          blocks.push(paraFrom(node));
          break;
        case "bulletList":
        case "orderedList": {
          const ordered = node.type === "orderedList";
          for (const item of node.content ?? []) {
            // listItem content: usually paragraphs; keep order, tag each
            for (const child of item.content ?? []) {
              if (child.type === "paragraph" || child.type === "heading") {
                const p = paraFrom(child);
                if (ordered) p.numbered = Math.max(depth, 0);
                else p.bullet = Math.max(depth, 0);
                blocks.push(p);
              } else if (
                child.type === "bulletList" ||
                child.type === "orderedList"
              ) {
                walkBlocks([child], depth + 1);
              }
            }
          }
          break;
        }
        case "blockquote":
          walkBlocks(node.content, depth);
          break;
        case "table": {
          const rows: ParaSpec[][][] = [];
          for (const row of node.content ?? []) {
            const cells: ParaSpec[][] = [];
            for (const cell of row.content ?? []) {
              const cellBlocks: BlockSpec[] = [];
              walkCellParagraphs(cell.content, cellBlocks, 0);
              cells.push(
                cellBlocks.filter((b): b is ParaSpec => b.kind === "para"),
              );
            }
            rows.push(cells);
          }
          blocks.push({ kind: "table", rows });
          break;
        }
        default:
          // unknown block: try to salvage inline content
          if (node.content) {
            const runs = runsOf(node.content, []);
            if (runs.some((r) => r.text.length > 0)) {
              blocks.push({ kind: "para", runs });
            }
          }
          break;
      }
    }
  };

  walkBlocks(doc.content, 0);
  return blocks;
}

function walkCellParagraphs(
  nodes: TiptapNode[] | undefined,
  out: BlockSpec[],
  depth: number,
): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (n.type === "paragraph" || n.type === "heading") {
      out.push(paraFrom(n));
    } else if (n.type === "bulletList" || n.type === "orderedList") {
      const ordered = n.type === "orderedList";
      for (const item of n.content ?? []) {
        for (const child of item.content ?? []) {
          if (child.type === "paragraph") {
            const p = paraFrom(child);
            if (ordered) p.numbered = depth;
            else p.bullet = depth;
            out.push(p);
          }
        }
      }
    } else if (n.content) {
      walkCellParagraphs(n.content, out, depth);
    }
  }
}

/** Word count helper for the status bar. */
export function countWords(blocks: BlockSpec[]): number {
  let words = 0;
  const countPara = (p: ParaSpec) => {
    const text = p.runs.map((r) => r.text).join(" ");
    words += text.split(/\s+/).filter(Boolean).length;
  };
  for (const b of blocks) {
    if (b.kind === "para") countPara(b);
    else for (const row of b.rows) for (const cell of row) cell.forEach(countPara);
  }
  return words;
}
