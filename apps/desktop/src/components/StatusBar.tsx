import { useTabs, getActiveTab } from "../state/tabsStore";
import { activeRows } from "../lib/types";
import { formatSize } from "../lib/files";

function delimiterLabel(d: string): string {
  switch (d) {
    case ",":
      return "Comma";
    case ";":
      return "Semicolon";
    case "\t":
      return "Tab";
    case "|":
      return "Pipe";
    default:
      return d;
  }
}

function encodingLabel(enc: string, hasBom: boolean): string {
  switch (enc) {
    case "windows-1252":
      return "CP1252";
    case "utf-16le":
      return "UTF-16 LE";
    case "utf-16be":
      return "UTF-16 BE";
    case "utf-8-bom":
      return "UTF-8 BOM";
    default:
      return hasBom ? "UTF-8 BOM" : "UTF-8";
  }
}

function trimNum(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded);
}

export default function StatusBar() {
  const status = useTabs((s) => s.status);
  const active = useTabs((s) => getActiveTab(s));
  const stats = useTabs((s) =>
    s.activeId != null && s.tabs.some((t) => t.id === s.activeId)
      ? s.selectionStats
      : null,
  );

  const dims = active
    ? `${activeRows(active).length} rows × ${Math.max(
        1,
        activeRows(active).reduce((m, r) => Math.max(m, r.length), 1),
      )} cols`
    : null;
  const size = active?.sizeBytes != null ? formatSize(active.sizeBytes) : null;
  const delim =
    active?.kind === "csv" ? delimiterLabel(active.csv?.delimiter ?? ",") : null;
  const encoding = active
    ? active.kind === "csv"
      ? encodingLabel(active.csv?.encoding ?? "utf-8", active.csv?.hasBom ?? false)
      : active.kind === "docx"
        ? "DOCX"
        : "XLSX"
    : null;
  const crlf =
    active?.kind === "csv" ? (active.csv?.crlf ? "CRLF" : "LF") : null;
  const sheet =
    active?.kind === "xlsx"
      ? (active.xlsx?.sheets[active.xlsx.activeSheet]?.name ?? null)
      : null;

  const statsText =
    stats && stats.count > 0
      ? stats.numericCount > 0
        ? `Sum ${trimNum(stats.sum)} · Avg ${trimNum(stats.sum / stats.numericCount)} · Count ${stats.count}`
        : `Count ${stats.count}`
      : null;

  return (
    <div className="statusbar">
      <span className="status-msg">{status}</span>
      <span className="status-right">
        {statsText && <span className="status-stats">{statsText}</span>}
        {sheet && <span>{sheet}</span>}
        {dims && <span>{dims}</span>}
        {size && <span>{size}</span>}
        {delim && <span>{delim}</span>}
        {encoding && <span>{encoding}</span>}
        {crlf && <span>{crlf}</span>}
      </span>
    </div>
  );
}
