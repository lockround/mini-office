//! Integration tests running the real Tauri command functions against
//! real fixture files on disk (see fixtures/ and the generators:
//! gen_csv_fixtures.py, examples/generate_complex_xlsx.rs,
//! scripts/generate_docx_fixture.cjs).

use mini_office_lib::csv::{parse_csv, write_csv, CsvWriteOptions};
use mini_office_lib::docx::{read_file_base64, write_docx, DocxWriteOptions};
use mini_office_lib::xlsx::{parse_xlsx, write_xlsx, CellKind, XlsxCellData, XlsxSheetData};
use std::fs;
use std::path::{Path, PathBuf};

fn fx(name: &str) -> String {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(name)
        .to_str()
        .unwrap()
        .to_string()
}

fn tmpdir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mo_it_{}_{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

// ------------------------------ CSV --------------------------------------

#[test]
fn csv_basic() {
    let doc = parse_csv(fx("basic.csv")).expect("parse");
    assert_eq!(doc.delimiter, ",");
    assert!(!doc.has_bom);
    assert_eq!(doc.rows.len(), 4);
    assert_eq!(doc.rows[0], vec!["name", "age", "city"]);
    assert_eq!(doc.rows[3], vec!["Mike", "41", "Pune"]);
}

#[test]
fn csv_nasty_quoting_round_trip() {
    let doc = parse_csv(fx("nasty.csv")).expect("parse");
    assert_eq!(doc.rows[1], vec!["Smith, John", "He said \"hello\" twice", "91"]);
    // embedded newline survives inside a quoted field
    assert_eq!(doc.rows[2], vec!["Ana María", "multi-line\nsecond line, with comma", "87.5"]);
    assert_eq!(doc.rows[3][0], "日本語 テスト");
    assert_eq!(doc.rows[3][1], "trailing spaces kept  ");
    assert_eq!(doc.rows[4], vec!["emoji ✓ row", "quote inside \"quoted\" text", "-12"]);

    // saving back through our writer must produce byte-identical output
    let opts = CsvWriteOptions {
        delimiter: ",".into(),
        has_bom: false,
        crlf: false,
        encoding: None,
    };
    let dir = tmpdir("nasty");
    let out = dir.join("nasty_out.csv");
    write_csv(out.to_str().unwrap().into(), doc.rows.clone(), opts).expect("write");
    let original = fs::read(fx("nasty.csv")).unwrap();
    let rewritten = fs::read(&out).unwrap();
    assert_eq!(original, rewritten, "round trip must be byte-identical");
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn csv_bom_detected_and_preserved() {
    let doc = parse_csv(fx("bom.csv")).expect("parse");
    assert!(doc.has_bom);
    assert_eq!(doc.rows[1][0], "Kaffee ☕");
    assert_eq!(doc.rows[1][1], "3,20"); // decimal comma must not become a delimiter

    let dir = tmpdir("bom");
    let out = dir.join("bom_out.csv");
    write_csv(
        out.to_str().unwrap().into(),
        doc.rows.clone(),
        CsvWriteOptions { delimiter: ",".into(), has_bom: true, crlf: false, encoding: None },
    )
    .expect("write");
    let bytes = fs::read(&out).unwrap();
    assert!(bytes.starts_with(&[0xEF, 0xBB, 0xBF]), "BOM must be written back");
    let reparsed = parse_csv(out.to_str().unwrap().into()).unwrap();
    assert!(reparsed.has_bom);
    assert_eq!(reparsed.rows[1][0], "Kaffee ☕");
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn csv_semicolon_sniffed() {
    let doc = parse_csv(fx("semi.csv")).expect("parse");
    assert_eq!(doc.delimiter, ";");
    assert_eq!(doc.rows[1], vec!["Müller", "München", "1200,50"]);
}

#[test]
fn csv_single_column_no_delimiter_opens() {
    // regression: used to fail with "could not detect delimiter"
    let doc = parse_csv(fx("onecol.csv")).expect("single-column file must open");
    assert_eq!(doc.delimiter, ",");
    assert_eq!(doc.rows, vec![
        vec!["alpha"],
        vec!["beta"],
        vec!["gamma"]
    ]);
}

#[test]
fn csv_crlf_handled_and_writable() {
    let doc = parse_csv(fx("crlf.csv")).expect("parse");
    assert_eq!(doc.rows[1], vec!["1", "2"]);

    let dir = tmpdir("crlf");
    let out = dir.join("crlf_out.csv");
    write_csv(
        out.to_str().unwrap().into(),
        doc.rows.clone(),
        CsvWriteOptions { delimiter: ",".into(), has_bom: false, crlf: true, encoding: None },
    )
    .expect("write");
    assert_eq!(fs::read(&out).unwrap(), b"a,b\r\n1,2\r\n3,4\r\n");
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn csv_empty_file_yields_no_rows() {
    let doc = parse_csv(fx("empty.csv")).expect("empty file parses");
    assert!(doc.rows.is_empty());
}

#[test]
fn csv_windows_1252_detected_and_round_trips() {
    let doc = parse_csv(fx("ansi.csv")).expect("ANSI file must open");
    assert_eq!(doc.encoding, "windows-1252");
    assert_eq!(doc.rows[1], vec!["Müller", "München", "1.200,50"]);
    assert_eq!(doc.rows[2][0], "Pérez");

    // re-saving with the same encoding keeps the bytes CP1252
    let dir = tmpdir("ansi");
    let out = dir.join("ansi_out.csv");
    write_csv(
        out.to_str().unwrap().into(),
        doc.rows.clone(),
        CsvWriteOptions {
            delimiter: ",".into(),
            has_bom: false,
            crlf: false,
            encoding: Some("windows-1252".into()),
        },
    )
    .expect("save as cp1252");
    let original = fs::read(fx("ansi.csv")).unwrap();
    let rewritten = fs::read(&out).unwrap();
    assert_eq!(original, rewritten, "cp1252 round trip must be byte-identical");

    // saving the same data as UTF-8 must produce valid UTF-8
    let utf8_out = dir.join("utf8_out.csv");
    write_csv(
        utf8_out.to_str().unwrap().into(),
        doc.rows.clone(),
        CsvWriteOptions {
            delimiter: ",".into(),
            has_bom: false,
            crlf: false,
            encoding: Some("utf-8".into()),
        },
    )
    .expect("save as utf-8");
    let text = fs::read_to_string(&utf8_out).unwrap();
    assert!(text.contains("Müller"));
    fs::remove_dir_all(&dir).ok();
}

// ------------------------------ XLSX -------------------------------------

/// (label row in Summary!, expected formula text, expected cached value)
fn expected_summary_formulas() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        ("total_qty", "SUM(Data!C2:C7)", "46"),
        ("avg_price", "AVERAGE(Data!D2:D7)", "4.641666666666667"),
        ("max_line", "MAX(Data!E2:E7)", "36"),
        ("widget_total_qty", "SUMIF(Data!A2:A7,\"widget\",Data!C2:C7)", "24"),
        ("north_value", "SUMIF(Data!B2:B7,\"north\",Data!E2:E7)", "54"),
        ("vlookup_gizmo", "VLOOKUP(\"gizmo\",Data!A2:E7,4,FALSE)", "7.25"),
        ("index_match_gadget", "INDEX(Data!C2:C7,MATCH(\"gadget\",Data!A2:A7,0))", "15"),
        (
            "nested_if",
            "IF(SUMIF(Data!B2:B7,\"north\",Data!C2:C7)>10,IF(AVERAGE(Data!D2:D7)>4,\"High N\",\"Med N\"),\"Low N\")",
            "High N",
        ),
        ("iferror_div", "IFERROR(1/0,\"div by zero\")", "div by zero"),
        ("concat_report", "CONCATENATE(\"rows: \",COUNTA(Data!A2:A7))", "rows: 6"),
        ("round_avg", "ROUND(AVERAGE(Data!E2:E7),2)", "23.58"),
        ("countif_widgets", "COUNTIF(Data!A2:A7,\"widget\")", "3"),
        (
            "and_or_check",
            "AND(COUNTA(Data!A2:A7)=6,OR(SUM(Data!C2:C7)>40,SUM(Data!C2:C7)<5))",
            "TRUE",
        ),
        ("cross_sheet_math", "Data!E2*2+Summary!B2", "96"),
    ]
}

fn cell_at<'a>(sheets: &'a [XlsxSheetData], sheet: &str, row: usize, col: usize) -> &'a XlsxCellData {
    sheets
        .iter()
        .find(|s| s.name == sheet)
        .unwrap_or_else(|| panic!("missing sheet {sheet}"))
        .rows
        .get(row)
        .and_then(|r| r.get(col))
        .unwrap_or_else(|| panic!("missing cell {sheet}!r{row}c{col}"))
}

#[test]
fn xlsx_complex_formulas_extracted_with_cached_values() {
    let parsed = parse_xlsx(fx("complex.xlsx")).expect("parse complex.xlsx");
    assert_eq!(
        parsed.sheets.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
        vec!["Data", "Summary"]
    );

    for (label, formula, value) in expected_summary_formulas() {
        // find the row by its label in column A
        let sheet = parsed.sheets.iter().find(|s| s.name == "Summary").unwrap();
        let row_idx = sheet
            .rows
            .iter()
            .position(|r| r.first().map(|c| c.value.as_str()) == Some(label))
            .unwrap_or_else(|| panic!("label {label} not found"));
        let cell = &sheet.rows[row_idx][1];
        assert_eq!(
            cell.formula.as_deref(),
            Some(formula),
            "formula mismatch for {label}"
        );
        assert_eq!(cell.value, value, "cached value mismatch for {label}");
    }

    // per-row line_total formulas on Data
    let line2 = cell_at(&parsed.sheets, "Data", 1, 4);
    assert_eq!(line2.formula.as_deref(), Some("C2*D2"));
    assert_eq!(line2.value, "25");
    assert_eq!(line2.kind, CellKind::Number);
}

#[test]
fn xlsx_openpyxl_style_formulas_without_cache() {
    // openpyxl writes formulas with no cached result; we must still attach
    // the formula text and keep the value empty rather than dropping it
    let parsed = parse_xlsx(fx("formulas.xlsx")).expect("parse formulas.xlsx");
    assert_eq!(
        parsed.sheets.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
        vec!["Sales", "Summary"]
    );

    let f2 = cell_at(&parsed.sheets, "Sales", 1, 5); // F2
    assert_eq!(f2.formula.as_deref(), Some("SUM(C2:C6)"));

    let g2 = cell_at(&parsed.sheets, "Sales", 1, 6); // G2
    assert_eq!(g2.formula.as_deref(), Some("IF(D3*10>50,\"High\",\"Low\")"));

    let h2 = cell_at(&parsed.sheets, "Sales", 1, 7); // H2
    assert_eq!(
        h2.formula.as_deref(),
        Some("VLOOKUP(\"gizmo\",A2:D6,4,FALSE)")
    );

    // cross-sheet references survive too
    let b1 = cell_at(&parsed.sheets, "Summary", 0, 1);
    assert_eq!(
        b1.formula.as_deref(),
        Some("SUMIF(Sales!B2:B6,\"north\",Sales!C2:C6)")
    );
}

#[test]
fn xlsx_edit_one_cell_save_other_formulas_survive() {
    let dir = tmpdir("editformula");
    let path = dir.join("edited.xlsx");
    fs::copy(fx("complex.xlsx"), &path).unwrap();

    let mut parsed = parse_xlsx(path.to_str().unwrap().into()).expect("open copy");

    // user edits B4 of Summary (index_match_gadget's cached value):
    // formula is dropped and replaced by a plain number
    {
        let summary = parsed.sheets.iter_mut().find(|s| s.name == "Summary").unwrap();
        let row = summary
            .rows
            .iter_mut()
            .find(|r| r.first().map(|c| c.value.as_str()) == Some("index_match_gadget"))
            .unwrap();
        row[1] = XlsxCellData { value: "999".into(), formula: None, kind: CellKind::Number };
    }
    write_xlsx(path.to_str().unwrap().into(), parsed.sheets.clone()).expect("save");

    let reopened = parse_xlsx(path.to_str().unwrap().into()).expect("reopen");
    for (label, formula, _) in expected_summary_formulas() {
        if label == "index_match_gadget" {
            continue; // this one was edited away
        }
        let sheet = reopened.sheets.iter().find(|s| s.name == "Summary").unwrap();
        let row_idx = sheet
            .rows
            .iter()
            .position(|r| r.first().map(|c| c.value.as_str()) == Some(label))
            .unwrap();
        assert_eq!(
            sheet.rows[row_idx][1].formula.as_deref(),
            Some(formula),
            "{label} lost its formula after an unrelated edit"
        );
    }
    let sheet = reopened.sheets.iter().find(|s| s.name == "Summary").unwrap();
    let row_idx = sheet
        .rows
        .iter()
        .position(|r| r.first().map(|c| c.value.as_str()) == Some("index_match_gadget"))
        .unwrap();
    let edited = &sheet.rows[row_idx][1];
    assert!(edited.formula.is_none());
    assert_eq!(edited.value, "999");

    // Data sheet untouched formulas still intact
    let line3 = cell_at(&reopened.sheets, "Data", 2, 4);
    assert_eq!(line3.formula.as_deref(), Some("C3*D3"));

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn xlsx_atomic_save_creates_bak_of_real_workbook() {
    let dir = tmpdir("bak");
    let path = dir.join("book.xlsx");
    fs::copy(fx("complex.xlsx"), &path).unwrap();

    let parsed = parse_xlsx(path.to_str().unwrap().into()).unwrap();
    let mut modified = parsed.sheets.clone();
    modified[0].name = "RenamedData".into();
    write_xlsx(path.to_str().unwrap().into(), modified).expect("save");

    assert!(dir.join("book.xlsx.bak").exists());
    assert!(!path.with_extension("xlsx.tmp").exists());

    let bak = parse_xlsx(dir.join("book.xlsx.bak").to_str().unwrap().into()).unwrap();
    assert_eq!(bak.sheets[0].name, "Data", ".bak must hold the previous version");

    let cur = parse_xlsx(path.to_str().unwrap().into()).unwrap();
    assert_eq!(cur.sheets[0].name, "RenamedData");

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn xlsx_rejects_non_zip_garbage() {
    let dir = tmpdir("garbage");
    let path = dir.join("fake.xlsx");
    fs::write(&path, b"definitely not a zip file").unwrap();
    let err: String = parse_xlsx(path.to_str().unwrap().into()).unwrap_err();
    assert!(!err.is_empty());
    fs::remove_dir_all(&dir).ok();
}

// ------------------------------ DOCX -------------------------------------

#[test]
fn docx_fixture_round_trips_through_our_writer_with_backup() {
    let dir = tmpdir("docxrt");
    let path = dir.join("report.docx");

    let b64_in = read_file_base64(fx("report.docx")).expect("read fixture");
    let opts = DocxWriteOptions { _placeholder: None };

    // save under new name (no .bak first time)
    write_docx(path.to_str().unwrap().into(), b64_in.clone(), opts.clone()).expect("save 1");
    assert!(!dir.join("report.docx.bak").exists());

    // second save creates .bak with previous content
    let other = read_file_base64(fx("complex.xlsx")).expect("other payload is also a zip");
    write_docx(path.to_str().unwrap().into(), other.clone(), opts).expect("save 2");
    let bak_path = dir.join("report.docx.bak");
    assert!(bak_path.exists());
    { let got = read_file_base64(bak_path.to_str().unwrap().to_string()).unwrap(); assert_eq!(got, b64_in); }
    { let got = read_file_base64(path.to_str().unwrap().to_string()).unwrap(); assert_eq!(got, other); }

    // tmp cleaned up
    assert!(!path.with_extension("docx.tmp").exists());
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn docx_rejects_payload_without_content_types() {
    use base64::Engine;
    let dir = tmpdir("docxbad");
    // a valid zip that is NOT a docx: no [Content_Types].xml
    let buf = std::io::Cursor::new(Vec::new());
    let mut w = zip::ZipWriter::new(buf);
    w.start_file("random.txt", zip::write::SimpleFileOptions::default()).unwrap();
    std::io::Write::write_all(&mut w, b"hi").unwrap();
    let bytes = w.finish().unwrap().into_inner();
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);

    let err = write_docx(
        dir.join("t.docx").to_str().unwrap().into(),
        b64,
        DocxWriteOptions { _placeholder: None },
    )
    .unwrap_err();
    assert!(err.contains("[Content_Types].xml"), "{err}");
    assert!(!dir.join("t.docx").exists());
    fs::remove_dir_all(&dir).ok();
}
