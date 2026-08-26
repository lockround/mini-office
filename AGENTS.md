# AGENTS.md — MiniOffice

Context for AI coding agents working on this repository. Read this fully
before making changes.

## What this is

**MiniOffice** — a tiny, fast, local-first Windows desktop app for opening
and making quick edits to Office files. Deliberately *not* an Office clone:
no accounts, cloud, telemetry, macros, pivot tables, or charts — ever.

Owner: `lockround/mini-office` on GitHub. Current version: 0.1.x (v0.2 data
features: encodings, sort/filter, grid replace-all, selection stats,
session restore).

## Stack (do not change without strong reason)

| Layer | Choice | Notes |
|---|---|---|
| Desktop shell | Tauri 2 | Rust backend, commands in `src-tauri/src/` |
| UI | React **18** + TypeScript + Vite | React must stay on 18 |
| Grid | `@glideapps/glide-data-grid` v6 | Canvas-based; see gotchas below |
| Doc editor | TipTap v3 (`@tiptap/react`) + StarterKit v3 | StarterKit includes Underline & Link |
| DOCX read | mammoth (browser build) | JS-side import per design decision |
| DOCX write | `docx` npm v9 | see bare-string gotcha below |
| XLSX read | calamine 0.36 (+ chrono feature) | values only, no formulas |
| CSV encodings | encoding_rs | BOM → strict UTF-8 → assume CP1252 |
| State | Zustand (`src/state/tabsStore.ts`, `uiStore.ts`) | |
| Tests | Vitest + cargo test | plus openpyxl external validation |

## Repository layout

```
apps/desktop/
├── src/
│   ├── App.tsx                  # layout, global shortcuts, drag-drop, CLI open
│   ├── components/
│   │   ├── SpreadsheetGrid.tsx  # shared grid (CsvEditor & XlsxEditor wrap it)
│   │   ├── CsvEditor.tsx        # CSV tab content (+ exports GridHint)
│   │   ├── XlsxEditor.tsx       # sheet strip + formula bar + shared grid
│   │   ├── DocEditor.tsx        # TipTap toolbar + editor for docx tabs
│   │   ├── DocFindReplace.tsx   # doc find & replace (store field: docFindOpen)
│   │   ├── FileTabs / Toolbar / StatusBar / EmptyState
│   │   ├── SearchOverlay.tsx    # grid search (store fields: searchOpen etc.)
│   │   ├── ConfirmDialog.tsx    # Save/Don't Save/Cancel close guard
│   │   └── RecoveryDialog.tsx   # crash-recovery prompt at launch
│   ├── state/tabsStore.ts       # THE core store: tabs, history, all mutations
│   ├── state/uiStore.ts         # theme (persisted localStorage "mo-theme")
│   └── lib/
│       ├── types.ts             # Tab/CsvDocData/XlsxDocData/DocxDocData + helpers
│       ├── files.ts             # open/save/save-as/close flows, confirm handler
│       ├── docxModel.ts         # PURE TipTap-JSON → BlockSpec converter (tested)
│       ├── docxBuild.ts         # BlockSpec → docx bytes
│       ├── recovery.ts          # crash snapshots in localStorage ("mo-recovery")
│       └── recent.ts            # recents via tauri-plugin-store
├── src-tauri/src/
│   ├── csv.rs                   # parse_csv/write_csv, sniffer, atomic save
│   ├── xlsx.rs                  # parse_xlsx/write_xlsx, formula XML extraction
│   ├── docx.rs                  # base64 byte transfer, validated atomic save
│   └── lib.rs                   # command registration, cli_open_paths
├── src-tauri/fixtures/          # real test files (committed) — see Testing
└── tests/                       # Vitest suites
```

## Commands

```sh
cd apps/desktop
npm install                 # first time
npm run tauri dev           # run the app
npm run typecheck           # tsc --noEmit  — ALWAYS pass before committing
npm test                    # vitest run  — ALWAYS pass before committing
npm run test:rust           # cargo test  — ALWAYS pass before committing
npm run build               # frontend production build
npm run tauri build         # release binary (+ installer bundle)
python3 src-tauri/validate_external.py   # needs openpyxl; third-party checks

# regenerate fixtures (committed to git — regenerate after format changes):
python3 src-tauri/gen_csv_fixtures.py
cargo run --example generate_complex_xlsx --manifest-path apps/desktop/src-tauri/Cargo.toml
node scripts/generate_docx_fixture.cjs
```

## Architecture rules

1. **Internal model is separate from format libraries.** CSV = `string[][]`;
   XLSX = `XlsxCellData { value, formula?, kind }`; DOCX = html + TipTap JSON.
   Format adapters live only in `lib/files.ts` (frontend) and one module per
   format (backend). New formats (ODS, TSV…) follow this pattern.
2. **Never corrupt user files.** All saves go through:
   write `<file>.tmp` → fsync → validate by re-parsing → copy original to
   `<file>.bak` → rename. Keep this pipeline for any new writer.
3. **Undo/redo**: snapshot-based, capped at 50, coalescing ONLY applies to
   tags starting with `"cell:"` within 900 ms (typing). Every other mutation
   must be its own undo step. Timestamped tags can collide in the same ms —
   that's why the `cell:` prefix check exists (regression, see xlsxStore tests).
4. **XLSX formulas are display-only.** We show cached values; editing a cell
   drops its formula and replaces it with the typed value; typing a new
   `=formula` into the formula bar is rejected with a status message.
5. **DOCX undo** is TipTap's own history; the global Ctrl+Z/Y handler in
   App.tsx deliberately skips docx tabs.
6. Tabs are discriminated by `kind: "csv" | "xlsx" | "docx"` with optional
   payload fields — when adding actions, dispatch on `tab.kind`.
7. **Grid filtering is destructive-but-undoable** ("Keep matches" removes
   non-matching rows; Ctrl+Z restores). We deliberately did NOT build a
   hidden-row view model — every feature (search, paste, stats) would need
   index remapping. If this ever changes, it is an architecture change.
8. **Sort is numeric-aware**: if every non-empty value in the column parses
   as a float, compare numerically (non-numbers sink to the bottom);
   otherwise locale-compare. freezeHeader keeps row 0 out of sort/filter.
9. **Selection stats** live in the store (`selectionStats`) and are set by
   the editors' onSelectionChange with a 200k-cell scan cap — don't compute
   them in StatusBar.

## Hard-won gotchas (these WILL bite again)

### Environment
- `/usr/local/bin/cc` on this dev box is a tmux shim, not a compiler.
  `src-tauri/.cargo/config.toml` pins `linker = "/usr/bin/gcc"` and
  `link-self-contained=no`. Don't delete it.
- No display server locally: smoke-launch with
  `xvfb-run -a ./target/release/mini-office <fixture args>`.

### glide-data-grid v6
- Peer dep caps React at 18 — never upgrade React without checking this.
- `freezeRows` prop was removed in v6; header styling is done via per-cell
  `themeOverride` in SpreadsheetGrid's getCellContent.
- Selection callback is `onGridSelectionChange` (no "d").
- Keydown args: `e.cancel()` is a function; there is no `gridSelection` on
  keydown args — track selection via ref.

### Rust / crates
- `csv` crate has NO Sniffer; we hand-roll delimiter detection in csv.rs
  (must fall back to `,` for single-column files — regression tested).
- **Encoding detection order** in csv.rs decode_bytes: UTF-16LE/BE BOM →
  UTF-16 decode → UTF-8 BOM → strict UTF-8 → Windows-1252 fallback. Saving
  re-encodes via `encode_text`; CP1252 rejects unrepresentable chars rather
  than mojibake-ing them.
- **quick-xml 0.42**: emits `&gt;`-style entities as separate
  `Event::GeneralRef` events — dropping them corrupts extracted formulas
  (regression-tested via nested_if in complex.xlsx). Self-closing tags
  (`<sheet/>`) come as `Event::Empty`, not `Start`. Names/keys are `str`,
  not bytes.
- **calamine shrinks its range** past trailing cells whose only content is a
  formula with empty cached value (openpyxl output). parse_xlsx merges the
  raw-XML formula map back over/behind the range — keep that code.
- Formula extraction reads `xl/workbook.xml` → rels → worksheets to map sheet
  order; shared/array formulas are skipped by design (their cached value is
  kept as text).
- rust_xlsxwriter 0.99: columns are `u16`, rows `u32`; `Workbook::new()`
  starts with ZERO worksheets (always `add_worksheet()`); use
  `Formula::set_result` to persist cached values.

### docx npm v9
- A bare string in `Paragraph.children` SILENTLY DROPS every following child.
  Always wrap text in `new TextRun(...)` (see docxBuild.ts).
- mammoth's node build wants a Buffer/file path; the browser build
  (`mammoth/mammoth.browser.js`) takes `{ arrayBuffer }` — the app uses the
  browser build so tests exercise the same path.

## Testing discipline

- Fixtures are REAL committed files in `src-tauri/fixtures/`: nasty quoting,
  BOM, semicolons, CRLF, single-column, empty CSVs; `complex.xlsx` (14
  formulas incl. VLOOKUP/INDEX+MATCH/nested IF/SUMIF/cross-sheet, each with
  cached values); `formulas.xlsx` (openpyxl, no cached values); `report.docx`
  (headings/lists/table/hyperlink).
- Integration tests call the actual command functions against these fixtures
  (`src-tauri/tests/integration.rs`). When changing parsers/writers, extend
  fixtures and integration tests first.
- Before any commit: `npm run typecheck && npm test && npm run test:rust`.
- CI (`.github/workflows/build.yml`) gates releases on the Linux test job;
  tagging `v*` publishes NSIS + MSI installers to GitHub Releases.

## Release process

1. Bump version in `apps/desktop/package.json` AND
   `apps/desktop/src-tauri/tauri.conf.json` (keep in sync).
2. Commit, tag `vX.Y.Z`, push the tag → CI builds installers (~10 min).
3. Artifacts appear on the GitHub Release page automatically.

## Deferred scope (agreed product decisions)

- XLSM/.xls/.doc/PDF: unsupported by design for now (clear error messages).
- Font sizes/colors/page layout from existing DOCX are not imported
  (mammoth is semantic-only); alignment/lists/headings/tables are.
- ODS/TSV/JSON export, auto-update mechanism, portable exe channel: ideas for later.
