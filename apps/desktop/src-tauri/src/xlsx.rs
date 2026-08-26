use calamine::{Data, Reader, Xlsx};
use rust_xlsxwriter::Workbook as XlsxWorkbook;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufReader, Cursor, Write};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum CellKind {
    Text,
    Number,
    Bool,
    Error,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct XlsxCellData {
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    pub kind: CellKind,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct XlsxSheetData {
    pub name: String,
    pub rows: Vec<Vec<XlsxCellData>>,
}

fn text_cell(v: String) -> XlsxCellData {
    XlsxCellData { value: v, formula: None, kind: CellKind::Text }
}
fn empty_cell() -> XlsxCellData {
    text_cell(String::new())
}

/// A1-style cell reference ("B3") to zero-based (row, col).
fn cell_ref_to_pos(r#ref: &str) -> Option<(u32, u32)> {
    let mut col = 0u32;
    let mut chars = r#ref.chars();
    let mut row_part = String::new();
    for c in chars.by_ref() {
        if c.is_ascii_alphabetic() {
            if row_part.is_empty() {
                col = col * 26 + (c.to_ascii_uppercase() as u32 - 'A' as u32 + 1);
            } else {
                return None;
            }
        } else if c.is_ascii_digit() {
            row_part.push(c);
        } else {
            return None;
        }
    }
    if col == 0 || row_part.is_empty() {
        return None;
    }
    let row = row_part.parse::<u32>().ok()?;
    Some((row.saturating_sub(1), col - 1))
}

/// Extracts formulas from the raw worksheet XML of an xlsx file.
/// Returns, per sheet (in workbook order), a map of "row:col" -> formula text.
/// Shared-formula slaves are skipped (their cached value is preserved instead).
fn extract_formulas(
    path: &str,
) -> Result<Vec<HashMap<(u32, u32), String>>, String> {
    let file = fs::File::open(path)
        .map_err(|e| format!("cannot reopen file for formulas: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(BufReader::new(file)).map_err(|e| e.to_string())?;

    // workbook.xml: sheet order and rIds
    let mut sheet_rids: Vec<String> = Vec::new();
    {
        let wb = archive
            .by_name("xl/workbook.xml")
            .map_err(|e| format!("bad xlsx (workbook.xml): {e}"))?;
        let mut reader = quick_xml::Reader::from_reader(BufReader::new(wb));
        let mut buf = Vec::new();
        loop {
            match reader.read_event_into(&mut buf) {
                Ok(quick_xml::events::Event::Start(e))
                | Ok(quick_xml::events::Event::Empty(e)) => {
                    if e.name().as_ref() == "sheet" {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == "r:id" {
                                sheet_rids.push(attr.value.into_owned());
                            }
                        }
                    }
                }
                Ok(quick_xml::events::Event::Eof) => break,
                Err(e) => return Err(format!("workbook.xml parse error: {e}")),
                _ => {}
            }
            buf.clear();
        }
    }

    // rels: rId -> target path
    let mut targets: HashMap<String, String> = HashMap::new();
    {
        let rels = archive
            .by_name("xl/_rels/workbook.xml.rels")
            .map_err(|e| format!("bad xlsx (rels): {e}"))?;
        let mut reader = quick_xml::Reader::from_reader(BufReader::new(rels));
        let mut buf = Vec::new();
        loop {
            match reader.read_event_into(&mut buf) {
                Ok(quick_xml::events::Event::Start(e))
                | Ok(quick_xml::events::Event::Empty(e)) => {
                    if e.name().local_name().as_ref() == "Relationship" {
                        let mut rid = String::new();
                        let mut target = String::new();
                        for attr in e.attributes().flatten() {
                            match attr.key.local_name().as_ref() {
                                "Id" => rid = attr.value.into_owned(),
                                "Target" => target = attr.value.into_owned(),
                                _ => {}
                            }
                        }
                        targets.insert(rid, target);
                    }
                }
                Ok(quick_xml::events::Event::Eof) => break,
                Err(e) => return Err(format!("rels parse error: {e}")),
                _ => {}
            }
            buf.clear();
        }
    }

    let mut result = Vec::new();
    for rid in &sheet_rids {
        let mut map = HashMap::new();
        if let Some(target) = targets.get(rid) {
            let norm = target.trim_start_matches('/');
            let full = if norm.starts_with("xl/") {
                norm.to_string()
            } else {
                format!("xl/{norm}")
            };
            if let Ok(xml) = archive.by_name(&full) {
                map = parse_sheet_formulas(xml)?;
            }
        }
        result.push(map);
    }
    Ok(result)
}

fn parse_sheet_formulas<R: std::io::Read>(
    xml: R,
) -> Result<HashMap<(u32, u32), String>, String> {
    use quick_xml::events::Event;

    let mut reader = quick_xml::Reader::from_reader(BufReader::new(xml));

    let mut formulas = HashMap::new();
    let mut current_ref: Option<String> = None;
    let mut in_f = false;
    let mut f_shared = false;
    let mut f_text = String::new();

    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let local = e.name().local_name();
                match local.as_ref() {
                    "c" => {
                        current_ref = None;
                        for attr in e.attributes().flatten() {
                            if attr.key.local_name().as_ref() == "r" {
                                current_ref = Some(attr.value.into_owned());
                            }
                        }
                    }
                    "f" => {
                        in_f = true;
                        f_shared = false;
                        f_text.clear();
                        for attr in e.attributes().flatten() {
                            if attr.key.local_name().as_ref() == "t"
                                && matches!(attr.value.as_ref(), "shared" | "array")
                            {
                                f_shared = true;
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) => {
                // <f t="shared"/> style tags carry no text; ignore them
                let _ = e;
            }
            Ok(Event::Text(t)) => {
                if in_f {
                    f_text.push_str(&t.xml10_content());
                }
            }
            // quick-xml 0.42 emits `&gt;`-style entity references as separate
            // events; dropping them silently corrupts extracted formulas
            Ok(Event::GeneralRef(r)) => {
                if in_f {
                    let name = r.as_ref();
                    let ch = match name {
                        "lt" => Some('<'),
                        "gt" => Some('>'),
                        "amp" => Some('&'),
                        "quot" => Some('"'),
                        "apos" => Some('\''),
                        _ => {
                            if let Some(hex) = name.strip_prefix("#x").or(name.strip_prefix("#X")) {
                                u32::from_str_radix(hex, 16).ok().and_then(char::from_u32)
                            } else if let Some(dec) = name.strip_prefix('#') {
                                dec.parse::<u32>().ok().and_then(char::from_u32)
                            } else {
                                None
                            }
                        }
                    };
                    match ch {
                        Some(c) => f_text.push(c),
                        None => {
                            return Err(format!(
                                "unsupported entity reference in formula: &{name};"
                            ))
                        }
                    }
                }
            }
            Ok(Event::End(e)) => match e.name().local_name().as_ref() {
                "f" => {
                    in_f = false;
                }
                "c" => {
                    if let Some(r#ref) = &current_ref {
                        let formula = f_text.trim();
                        // only plain formulas survive the round trip; shared /
                        // array formulas keep their cached values as text cells
                        if !f_shared && !formula.is_empty() && !formula.starts_with('{')
                        {
                            if let Some(pos) = cell_ref_to_pos(r#ref) {
                                formulas.insert(pos, formula.to_string());
                            }
                        }
                    }
                    current_ref = None;
                    f_text.clear();
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("sheet xml parse error: {e}")),
            _ => {}
        }
        buf.clear();
    }
    Ok(formulas)
}

fn data_to_cell(d: &Data) -> XlsxCellData {
    match d {
        Data::Empty => empty_cell(),
        Data::Int(i) => XlsxCellData {
            value: i.to_string(),
            formula: None,
            kind: CellKind::Number,
        },
        Data::Float(f) => XlsxCellData {
            value: fmt_float(*f),
            formula: None,
            kind: CellKind::Number,
        },
        Data::String(s) => text_cell(s.clone()),
        Data::Bool(b) => XlsxCellData {
            value: if *b { "TRUE" } else { "FALSE" }.to_string(),
            formula: None,
            kind: CellKind::Bool,
        },
        Data::DateTime(dt) => XlsxCellData {
            value: dt
                .as_datetime()
                .map(|ndt| ndt.format("%Y-%m-%d %H:%M:%S").to_string())
                .unwrap_or_default(),
            formula: None,
            kind: CellKind::Text,
        },
        Data::DateTimeIso(s) | Data::DurationIso(s) => text_cell(s.clone()),
        Data::Error(e) => XlsxCellData {
            value: e.to_string(),
            formula: None,
            kind: CellKind::Error,
        },
    }
}

fn fmt_float(f: f64) -> String {
    if f == f.trunc() && f.abs() < 1e15 {
        format!("{}", f as i64)
    } else {
        format!("{f}")
    }
}

#[derive(Serialize, Debug)]
pub struct ParsedXlsx {
    pub sheets: Vec<XlsxSheetData>,
}

#[tauri::command]
pub fn parse_xlsx(path: String) -> Result<ParsedXlsx, String> {
    let mut book: Xlsx<_> =
        calamine::open_workbook(path.as_str()).map_err(|e| format!("cannot open {path}: {e}"))?;

    let formulas = extract_formulas(&path)?;

    let mut sheets = Vec::new();
    for (idx, name) in book.sheet_names().into_iter().enumerate() {
        let range = book
            .worksheet_range_at(idx)
            .transpose()
            .map_err(|e| format!("cannot read sheet '{name}': {e}"))?
            .ok_or_else(|| format!("missing sheet '{name}'"))?;

        let sheet_formulas = formulas.get(idx);
        let width = range.width();
        let mut rows: Vec<Vec<XlsxCellData>> = Vec::with_capacity(range.height());

        for (r, row) in range.rows().enumerate() {
            let mut out_row: Vec<XlsxCellData> = Vec::with_capacity(width);
            for (c, cell) in row.iter().enumerate() {
                let mut cell_data = data_to_cell(cell);
                if cell_data.value.is_empty() {
                    if let Some(f) =
                        sheet_formulas.and_then(|m| m.get(&(r as u32, c as u32)))
                    {
                        cell_data.formula = Some(f.clone());
                    }
                } else {
                    cell_data.formula = sheet_formulas
                        .and_then(|m| m.get(&(r as u32, c as u32)))
                        .cloned();
                }
                out_row.push(cell_data);
            }
            // pad ragged trailing cells so the grid is rectangular
            while out_row.len() < width {
                out_row.push(empty_cell());
            }
            rows.push(out_row);
        }

        // calamine shrinks the used range past trailing cells whose only
        // content is a formula with an empty cached value (e.g. openpyxl
        // output). Merge those formula-only cells back in.
        if let Some(map) = sheet_formulas {
            for (&(r, c), f) in map {
                let (r, c) = (r as usize, c as usize);
                if rows.get(r).and_then(|row| row.get(c)).map(|cell| !cell.value.is_empty() || cell.formula.is_some()) == Some(true) {
                    continue;
                }
                while rows.len() <= r {
                    rows.push(Vec::new());
                }
                let row = &mut rows[r];
                while row.len() <= c {
                    row.push(empty_cell());
                }
                let cell = &mut row[c];
                cell.formula = Some(f.clone());
            }
        }

        sheets.push(XlsxSheetData { name, rows });
    }

    if sheets.is_empty() {
        sheets.push(XlsxSheetData {
            name: "Sheet1".to_string(),
            rows: vec![vec![empty_cell()]],
        });
    }

    Ok(ParsedXlsx { sheets })
}

fn write_cells(ws: &mut rust_xlsxwriter::Worksheet, rows: &[Vec<XlsxCellData>]) {
    for (r, row) in rows.iter().enumerate() {
        for (c, cell) in row.iter().enumerate() {
            if let Some(formula) = &cell.formula {
                let f = rust_xlsxwriter::Formula::new(formula.clone())
                    .set_result(cell.value.clone());
                let _ = ws.write_formula(r as u32, c as u16, f);
                continue;
            }
            match cell.kind {
                CellKind::Bool => {
                    if let Ok(b) = cell.value.trim().to_ascii_lowercase().parse::<bool>() {
                        let _ = ws.write_boolean(r as u32, c as u16, b);
                        continue;
                    }
                    let _ = ws.write_string(r as u32, c as u16, &cell.value);
                }
                CellKind::Number => {
                    if let Ok(n) = cell.value.trim().parse::<f64>() {
                        let _ = ws.write_number(r as u32, c as u16, n);
                    } else {
                        let _ = ws.write_string(r as u32, c as u16, &cell.value);
                    }
                }
                CellKind::Error | CellKind::Text => {
                    if cell.value.is_empty() {
                        continue;
                    }
                    let _ = ws.write_string(r as u32, c as u16, &cell.value);
                }
            }
        }
    }
}

/// Atomic save with backup, mirroring the CSV pipeline.
#[tauri::command]
pub fn write_xlsx(path: String, sheets: Vec<XlsxSheetData>) -> Result<super::csv::SaveResult, String> {
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!("directory does not exist: {}", parent.display()));
        }
    }

    let tmp_path: PathBuf = {
        let mut p = path.clone().into_bytes();
        p.extend_from_slice(b".tmp");
        PathBuf::from(std::str::from_utf8(&p).map_err(|_| "bad path")?)
    };

    {
        let mut book = XlsxWorkbook::new();
        for (_i, sheet) in sheets.iter().enumerate() {
            let ws = book.add_worksheet();
            ws.set_name(&sheet.name).map_err(|e| e.to_string())?;
            write_cells(ws, &sheet.rows);
        }
        let buf = book
            .save_to_buffer()
            .map_err(|e| format!("xlsx encode failed: {e}"))?;
        let mut tmp = fs::File::create(&tmp_path)
            .map_err(|e| format!("cannot create temp file: {e}"))?;
        tmp.write_all(&buf).map_err(|e| e.to_string())?;
        tmp.sync_all().map_err(|e| format!("flush failed: {e}"))?;
    }

    // Validate by re-opening what we wrote before touching the original
    validate_round_trip(&tmp_path.to_string_lossy(), sheets.len())?;

    if target.exists() {
        let bak: PathBuf = {
            let mut p = path.clone().into_bytes();
            p.extend_from_slice(b".bak");
            PathBuf::from(std::str::from_utf8(&p).map_err(|_| "bad path")?)
        };
        fs::copy(target, &bak).map_err(|e| format!("backup failed: {e}"))?;
    }

    #[cfg(unix)]
    fs::rename(&tmp_path, target).map_err(|e| format!("save failed: {e}"))?;
    #[cfg(windows)]
    {
        fs::remove_file(target).or_else(|e| {
            if e.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(e) }
        }).map_err(|e| format!("save failed: {e}"))?;
        fs::rename(&tmp_path, target).map_err(|e| format!("save failed: {e}"))?;
    }

    let size_bytes = fs::metadata(target).map(|m| m.len()).map_err(|e| e.to_string())?;
    Ok(super::csv::SaveResult { size_bytes })
}

fn validate_round_trip(tmp_path: &str, expected_sheets: usize) -> Result<(), String> {
    let bytes = fs::read(tmp_path).map_err(|e| e.to_string())?;
    let cursor = Cursor::new(bytes);
    let book: Xlsx<_> = calamine::open_workbook_from_rs(cursor)
        .map_err(|e| format!("validation failed: {e}"))?;
    if book.sheet_names().len() != expected_sheets {
        return Err("validation failed: sheet count mismatch".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk(value: &str, formula: Option<&str>, kind: CellKind) -> XlsxCellData {
        XlsxCellData {
            value: value.into(),
            formula: formula.map(Into::into),
            kind,
        }
    }

    fn sample_book() -> Vec<XlsxSheetData> {
        vec![
            XlsxSheetData {
                name: "Data".into(),
                rows: vec![
                    vec![mk("Name", None, CellKind::Text), mk("Score", None, CellKind::Text)],
                    vec![
                        mk("Alice", None, CellKind::Text),
                        mk("91", None, CellKind::Number),
                    ],
                    vec![
                        mk("TRUE", None, CellKind::Bool),
                        mk("42.5", None, CellKind::Number),
                    ],
                    vec![
                        mk("total", None, CellKind::Text),
                        mk("133.5", Some("SUM(B2:B3)"), CellKind::Number),
                    ],
                    vec![mk("#DIV/0!", None, CellKind::Error), empty_cell()],
                ],
            },
            XlsxSheetData {
                name: "Empty sheet".into(),
                rows: vec![],
            },
        ]
    }

    fn tempdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mo_xlsx_{}_{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn values_kinds_and_names_round_trip() {
        let dir = tempdir("rt");
        let path = dir.join("t.xlsx");
        let path_str = path.to_str().unwrap();
        write_xlsx(path_str.into(), sample_book()).expect("write");

        let parsed = parse_xlsx(path_str.into()).expect("re-open");
        assert_eq!(parsed.sheets.len(), 2);
        assert_eq!(parsed.sheets[0].name, "Data");
        assert_eq!(parsed.sheets[1].name, "Empty sheet");

        let rows = &parsed.sheets[0].rows;
        assert_eq!(rows[1][1].value, "91");
        assert_eq!(rows[1][1].kind, CellKind::Number);
        assert_eq!(rows[2][0].value, "TRUE");
        assert_eq!(rows[2][0].kind, CellKind::Bool);
        assert_eq!(rows[3][1].value, "133.5");
        assert_eq!(rows[4][0].value, "#DIV/0!");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn formulas_survive_save_when_untouched() {
        let dir = tempdir("formula");
        let path = dir.join("t.xlsx");
        let path_str = path.to_str().unwrap();
        write_xlsx(path_str.into(), sample_book()).expect("write");

        // The formula must come back from our own raw-XML extraction
        let parsed = parse_xlsx(path_str.into()).expect("re-open");
        let cell = &parsed.sheets[0].rows[3][1];
        assert_eq!(cell.formula.as_deref(), Some("SUM(B2:B3)"));
        assert_eq!(cell.value, "133.5");

        // Saving again without edits keeps it
        write_xlsx(path_str.into(), parsed.sheets.clone()).expect("rewrite");
        let again = parse_xlsx(path_str.into()).expect("re-open 2");
        assert_eq!(
            again.sheets[0].rows[3][1].formula.as_deref(),
            Some("SUM(B2:B3)")
        );

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn edited_cell_clears_formula() {
        let mut book = sample_book();
        book[0].rows[3][1] = XlsxCellData {
            value: "999".into(),
            formula: None,
            kind: CellKind::Number,
        };
        let dir = tempdir("edited");
        let path = dir.join("t.xlsx");
        let path_str = path.to_str().unwrap();
        write_xlsx(path_str.into(), book).expect("write");

        let parsed = parse_xlsx(path_str.into()).expect("re-open");
        assert!(parsed.sheets[0].rows[3][1].formula.is_none());
        assert_eq!(parsed.sheets[0].rows[3][1].value, "999");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn atomic_save_creates_bak_and_cleans_tmp() {
        let dir = tempdir("atomic");
        let path = dir.join("t.xlsx");
        let path_str = path.to_str().unwrap();

        write_xlsx(path_str.into(), sample_book()).expect("write 1");
        assert!(!path.with_extension("xlsx.tmp").exists());

        // second save creates .bak
        let mut book2 = sample_book();
        book2[0].name = "Renamed".into();
        write_xlsx(path_str.into(), book2).expect("write 2");

        assert!(dir.join("t.xlsx.bak").exists());
        let reopened = parse_xlsx(path_str.into()).unwrap();
        assert_eq!(reopened.sheets[0].name, "Renamed");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn formula_xml_extractor_maps_cell_refs() {
        let xml = r#"<?xml version="1.0"?>
        <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <sheetData>
            <row r="1"><c r="A1" t="n"><v>1</v></c></row>
            <row r="4"><c r="B4"><f>SUM(A1:A3)</f><v>6</v></c></row>
            <row r="5"><c r="A5"><f t="shared" ref="A5:A6" si="0">A1*2</f><v>2</v></c></row>
          </sheetData>
        </worksheet>"#;
        let map =
            parse_sheet_formulas(Cursor::new(xml.as_bytes())).expect("parse");
        assert_eq!(map.get(&(3, 1)).map(String::as_str), Some("SUM(A1:A3)"));
        // shared-formula slave is deliberately not captured
        assert!(!map.contains_key(&(4, 0)));
    }

    #[test]
    fn cell_ref_parsing() {
        assert_eq!(cell_ref_to_pos("A1"), Some((0, 0)));
        assert_eq!(cell_ref_to_pos("B3"), Some((2, 1)));
        assert_eq!(cell_ref_to_pos("AA10"), Some((9, 26)));
        assert_eq!(cell_ref_to_pos("garbage"), None);
    }
}
