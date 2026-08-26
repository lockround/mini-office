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

export default function StatusBar() {
  const status = useTabs((s) => s.status);
  const active = useTabs((s) => getActiveTab(s));

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
      ? active.csv?.hasBom
        ? "UTF-8 BOM"
        : "UTF-8"
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

  return (
    <div className="statusbar">
      <span className="status-msg">{status}</span>
      <span className="status-right">
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
