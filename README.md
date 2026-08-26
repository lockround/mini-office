# MiniOffice

A tiny, fast, local-first viewer and basic editor for Office files.
Not an Office replacement — Notepad-plus-a-grid.

**Current status: v0.1 feature-complete (Phases 1–5). Shell + CSV + XLSX + DOCX editors with polish.**

## Stack

- Tauri 2 · React 18 · TypeScript · Vite
- Zustand (state) · Glide Data Grid (virtualized grid)
- Rust `csv` crate behind Tauri commands
- Vitest (frontend) · `cargo test` (backend)

## Features (v0.1)

- Tabs with dirty tracking (`*`), close guard with Save/Don't Save/Cancel
- Open dialog, drag-and-drop from Explorer, recent files
- CSV: delimiter sniffing (`,` `;` tab `|`), UTF-8 + BOM handling,
  cell editing, multi-cell copy/cut/paste (TSV), delete-to-clear,
  undo/redo (coalesced typing), find with highlights,
  add/delete rows & columns, header-row styling toggle, column resize
- XLSX: multi-sheet workbooks (add/rename/delete/switch sheets), formula bar
  (display-only: shows stored formulas with cached values; editing a cell
  replaces its formula with the typed value), number/bool/error kinds
  preserved on save. Formulas are extracted from raw sheet XML and written
  back via `Formula::set_result` so untouched formulas survive saves.
  Shared/array formulas keep their cached values as text.
- DOCX: opens via mammoth (headings, bold/italic/underline, lists, tables,
  links), edited in TipTap with a formatting toolbar (B/I/U, H1/H2/body,
  bullet & numbered lists, alignment, links, insert/edit tables),
  saved via the `docx` library. Undo/redo handled inside the document.
- Polish: light/dark theme toggle (persisted), auto-save crash-recovery
  snapshots every 20s with a recover-or-discard prompt on next launch,
  find & replace in documents (Ctrl+F), CLI multi-file open
  (`MiniOffice.exe a.csv b.xlsx`), Windows file associations for
  .csv/.xlsx/.docx, NSIS installer config, GitHub Actions CI
- Atomic saves for all formats: write `.tmp` → fsync → validate by
  re-opening → backup `.bak` → rename

## Layout

```
apps/desktop/
├── src/            # React UI (components/, state/, lib/)
├── src-tauri/      # Rust backend (csv.rs: parse/write/atomic save)
└── tests/          # Vitest store tests
```

## Commands

```sh
cd apps/desktop
npm install
npm run tauri dev     # run the app
npm run tauri build   # release binary (+ installer bundle)
npm test              # frontend unit tests
npm run test:rust     # backend CSV round-trip / atomic-save tests
npm run typecheck
```

## Testing

```sh
cd apps/desktop
npm test                      # 29 frontend tests (unit + real-file integration)
npm run test:rust             # 28 Rust tests (14 unit + 14 integration)
python3 src-tauri/validate_external.py   # third-party validation via openpyxl
```

Real-file fixtures live in `apps/desktop/src-tauri/fixtures/` — CSVs
(quoting/BOM/CRLF/single-column edge cases), `complex.xlsx` (14 formulas
incl. nested IF, VLOOKUP, INDEX/MATCH, SUMIF, COUNTIF, cross-sheet math,
each with cached values), `formulas.xlsx` (openpyxl-style formulas without
cached values), and `report.docx` (headings/lists/table/hyperlink).
Regenerate with:

```sh
python3 src-tauri/gen_csv_fixtures.py
cargo run --example generate_complex_xlsx --manifest-path apps/desktop/src-tauri/Cargo.toml
node scripts/generate_docx_fixture.cjs
```

Note: `src-tauri/.cargo/config.toml` pins the real system GCC because
`/usr/local/bin/cc` is a tmux shim in this environment.

## Roadmap

| Milestone | Status |
|---|---|
| Desktop shell (tabs, dialogs, dnd, shortcuts, recents) | done |
| CSV editor | done |
| XLSX (calamine read / rust_xlsxwriter write, display-only formulas) | done |
| DOCX (TipTap editor + mammoth import + docx export) | done |
| Polish (theme, auto-save/recovery, find & replace, installer/CI) | done |

DOCX known limits: font sizes/colors and page layout from existing files are
not imported (mammoth focuses on semantic content); typing a new formula into
XLSX cells is not supported (values only).

Windows installers are built by CI on version tags (`v*`) — see
`.github/workflows/build.yml`.

Deliberately out of scope: cloud sync, accounts, telemetry, macros, pivot
tables, charts.
