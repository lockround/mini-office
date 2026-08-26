use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct CsvDoc {
    pub rows: Vec<Vec<String>>,
    pub delimiter: String,
    pub has_bom: bool,
    /// encoding label as saved/re-saved: "utf-8", "windows-1252", "utf-16le"
    pub encoding: String,
}

#[derive(Deserialize, Clone)]
pub struct CsvWriteOptions {
    pub delimiter: String,
    pub has_bom: bool,
    pub crlf: bool,
    /// target encoding for the output bytes; defaults to utf-8
    #[serde(default)]
    pub encoding: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct SaveResult {
    pub size_bytes: u64,
}

const SNIFF_SAMPLE_BYTES: usize = 64 * 1024;

fn detect_bom(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xEF, 0xBB, 0xBF])
}

const SNIFF_MAX_LINES: usize = 20;

/// Heuristic delimiter detection: counts candidate separators outside of
/// quoted regions over the first lines of the file.
fn sniff_delimiter(data: &[u8]) -> Result<u8, String> {
    const CANDIDATES: [u8; 4] = [b',', b';', b'\t', b'|'];
    let sample = &data[..data.len().min(SNIFF_SAMPLE_BYTES)];

    let mut counts = [0usize; 4];
    let mut in_quotes = false;
    let mut prev_quote = false;
    let mut lines = 0usize;

    for &b in sample {
        if b == b'"' && !prev_quote {
            in_quotes = !in_quotes;
        } else if b == b'\n' && !in_quotes {
            lines += 1;
            if lines >= SNIFF_MAX_LINES {
                break;
            }
        } else if !in_quotes {
            for (i, &c) in CANDIDATES.iter().enumerate() {
                if b == c {
                    counts[i] += 1;
                }
            }
        }
        prev_quote = b == b'"';
    }

    let best = counts
        .iter()
        .enumerate()
        .max_by_key(|(i, c)| (**c, std::cmp::Reverse(*i)))
        .map(|(i, c)| (i, *c));

    match best {
        Some((i, count)) if count > 0 => Ok(CANDIDATES[i]),
        // single-column files legitimately contain no delimiter characters
        _ => Ok(b','),
    }
}

fn delimiter_byte(delimiter: &str) -> Result<u8, String> {
    let b = delimiter.as_bytes().first().copied().unwrap_or(b',');
    if !delimiter.is_ascii() || delimiter.len() != 1 || b == b'"' || b == b'\r' || b == b'\n' {
        return Err(format!("invalid delimiter: {delimiter:?}"));
    }
    Ok(b)
}

fn io_error(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::NotFound => "file not found".into(),
        std::io::ErrorKind::PermissionDenied => "permission denied".into(),
        _ => e.to_string(),
    }
}

/// Decodes file bytes into text, detecting the encoding:
/// BOMs win; then strict UTF-8; otherwise assume Windows-1252 (the legacy
/// Windows "ANSI" codepage), which decodes every byte without error.
fn decode_bytes(bytes: &[u8]) -> Result<(String, bool, String), String> {
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let (text, _, had_errors) = encoding_rs::UTF_16LE.decode(bytes);
        if had_errors {
            return Err("file has an invalid UTF-16LE byte sequence".into());
        }
        // strip the BOM character itself
        let text = text.trim_start_matches('\u{FEFF}').to_string();
        return Ok((text, true, "utf-16le".into()));
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let (text, _, had_errors) = encoding_rs::UTF_16BE.decode(bytes);
        if had_errors {
            return Err("file has an invalid UTF-16BE byte sequence".into());
        }
        let text = text.trim_start_matches('\u{FEFF}').to_string();
        return Ok((text, true, "utf-16be".into()));
    }
    let has_bom = detect_bom(bytes);
    let body = if has_bom { &bytes[3..] } else { &bytes[..] };
    match std::str::from_utf8(body) {
        Ok(text) => {
            let enc = if has_bom { "utf-8-bom" } else { "utf-8" };
            Ok((text.to_string(), has_bom, enc.into()))
        }
        Err(_) => {
            let (text, _, had_errors) = encoding_rs::WINDOWS_1252.decode(bytes);
            if had_errors {
                return Err(
                    "file is not valid UTF-8 and not decodable as Windows-1252"
                        .into(),
                );
            }
            Ok((text.into_owned(), false, "windows-1252".into()))
        }
    }
}

/// Encodes text to the requested target encoding for saving.
pub fn encode_text(text: &str, encoding: &str, bom: bool) -> Result<Vec<u8>, String> {
    match encoding {
        "" | "utf-8" | "utf-8-bom" => {
            let mut out = Vec::with_capacity(text.len() + 3);
            if bom || encoding == "utf-8-bom" {
                out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            }
            out.extend_from_slice(text.as_bytes());
            Ok(out)
        }
        "windows-1252" | "cp1252" | "ansi" => {
            let (bytes, _, had_errors) = encoding_rs::WINDOWS_1252.encode(text);
            if had_errors {
                Err("text contains characters that cannot be represented in windows-1252".into())
            } else {
                Ok(bytes.into_owned())
            }
        }
        "utf-16le" => {
            let mut out = Vec::with_capacity(text.len() * 2 + 2);
            if bom {
                out.extend_from_slice(&[0xFF, 0xFE]);
            }
            for unit in text.encode_utf16() {
                out.extend_from_slice(&unit.to_le_bytes());
            }
            Ok(out)
        }
        other => Err(format!("unsupported save encoding: {other}")),
    }
}

#[tauri::command]
pub fn parse_csv(path: String) -> Result<CsvDoc, String> {
    let bytes =
        fs::read(&path).map_err(|e| format!("cannot read {path}: {}", io_error(&e)))?;
    let (text, has_bom, encoding) = decode_bytes(&bytes)?;
    let body = text.as_bytes();
    let delimiter = sniff_delimiter(body)?;

    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .has_headers(false)
        .flexible(true)
        .from_reader(body);

    let mut rows: Vec<Vec<String>> = Vec::new();
    for record in reader.records() {
        let record =
            record.map_err(|e| format!("parse error: {e}"))?;
        rows.push(record.iter().map(|f| f.to_string()).collect());
    }

    Ok(CsvDoc {
        rows,
        delimiter: (delimiter as char).to_string(),
        has_bom,
        encoding,
    })
}

fn rows_to_text(rows: &[Vec<String>], delim: u8, crlf: bool) -> Result<String, String> {
    let terminator = if crlf {
        csv::Terminator::CRLF
    } else {
        csv::Terminator::Any(b'\n')
    };
    let mut writer = csv::WriterBuilder::new()
        .delimiter(delim)
        .terminator(terminator)
        .flexible(true)
        .from_writer(Vec::new());
    for row in rows {
        writer.write_record(row).map_err(|e| e.to_string())?;
    }
    let bytes = writer.into_inner().map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "internal error: non-utf8 csv buffer".into())
}

/// Atomic save: target.bak <- old target, target.tmp <- new bytes, fsync, rename.
#[tauri::command]
pub fn write_csv(
    path: String,
    rows: Vec<Vec<String>>,
    options: CsvWriteOptions,
) -> Result<SaveResult, String> {
    let delim = delimiter_byte(&options.delimiter)?;
    let encoding = options.encoding.as_deref().unwrap_or("utf-8").to_string();
    let target = Path::new(&path);

    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!(
                "directory does not exist: {}",
                parent.display()
            ));
        }
    }

    let tmp_path: PathBuf = {
        let mut p = path.clone().into_bytes();
        p.extend_from_slice(b".tmp");
        PathBuf::from(std::str::from_utf8(&p).map_err(|_| "bad path")?)
    };

    // Write tmp
    {
        let text = rows_to_text(&rows, delim, options.crlf)?;
        // BOM handling: utf-8-bom label or explicit has_bom for utf-8;
        // cp1252 never gets a UTF-8 BOM (it would be undecodable)
        let want_bom = options.has_bom && (encoding == "utf-8" || encoding.is_empty());
        let bytes = encode_text(&text, &encoding, want_bom)?;
        let mut tmp = fs::File::create(&tmp_path)
            .map_err(|e| format!("cannot create temp file: {}", io_error(&e)))?;
        tmp.write_all(&bytes).map_err(|e| e.to_string())?;
        tmp.sync_all()
            .map_err(|e| format!("flush failed: {e}"))?;
    }

    // Validate round-trip before replacing the original
    {
        let written = fs::read(&tmp_path).map_err(|e| e.to_string())?;
        let (text, _, _) = decode_bytes(&written).map_err(|e| format!("validation failed: {e}"))?;
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(delim)
            .has_headers(false)
            .flexible(true)
            .from_reader(text.as_bytes());
        let mut back: Vec<Vec<String>> = Vec::new();
        for rec in reader.records() {
            back.push(
                rec.map_err(|e| format!("validation failed: {e}"))?
                    .iter()
                    .map(|f| f.to_string())
                    .collect(),
            );
        }
        if back.len() != rows.len() {
            return Err("validation failed: row count mismatch".into());
        }
    }

    // Backup previous version
    if target.exists() {
        let bak: PathBuf = {
            let mut p = path.clone().into_bytes();
            p.extend_from_slice(b".bak");
            PathBuf::from(std::str::from_utf8(&p).map_err(|_| "bad path")?)
        };
        fs::copy(target, &bak)
            .map_err(|e| format!("backup failed: {}", io_error(&e)))?;
    }

    // Atomic replace
    #[cfg(unix)]
    fs::rename(&tmp_path, target).map_err(|e| format!("save failed: {e}"))?;
    #[cfg(windows)]
    {
        // rename cannot overwrite on Windows; remove-then-rename narrows but does
        // not eliminate the window where the original is gone.
        fs::remove_file(target)
            .or_else(|e| if e.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(e) })
            .map_err(|e| format!("save failed: {e}"))?;
        fs::rename(&tmp_path, target).map_err(|e| format!("save failed: {e}"))?;
    }

    let size_bytes = fs::metadata(target)
        .map(|m| m.len())
        .map_err(|e| format!("stat failed: {e}"))?;

    Ok(SaveResult { size_bytes })
}

/// Re-reads the saved file to verify integrity (used after save).
#[tauri::command]
pub fn stat_file(path: String) -> Result<SaveResult, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("{}", io_error(&e)))?;
    Ok(SaveResult {
        size_bytes: meta.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(rows: &[Vec<String>], crlf: bool, bom: bool) -> Vec<u8> {
        let text = rows_to_text(rows, b',', crlf).unwrap();
        encode_text(&text, "utf-8", bom).unwrap()
    }

    fn parse_back(bytes: &[u8]) -> (Vec<Vec<String>>, bool) {
        let has_bom = detect_bom(bytes);
        let body = if has_bom { &bytes[3..] } else { &bytes[..] };
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b',')
            .has_headers(false)
            .flexible(true)
            .from_reader(body);
        let rows = reader
            .records()
            .map(|r| r.unwrap().iter().map(|f| f.to_string()).collect())
            .collect();
        (rows, has_bom)
    }

    #[test]
    fn round_trips_quoting() {
        let rows = vec![
            vec!["name".into(), "city".into()],
            vec!["Smith, John".into(), "say \"hi\"\nmulti".into()],
            vec![" leading and trailing ".into(), "".into()],
            vec!["héllo ✓".into(), "日本語".into()],
        ];
        let bytes = round_trip(&rows, false, false);
        let (back, _) = parse_back(&bytes);
        assert_eq!(back, rows);
    }

    #[test]
    fn preserves_empty_and_uneven_rows() {
        // note: a truly empty row cannot survive CSV round-trip; the writer
        // emits it as a single quoted empty field
        let rows: Vec<Vec<String>> = vec![
            vec![],
            vec!["a".into()],
            vec!["a".into(), "b".into(), "c".into()],
            vec!["".into(), "".into()],
        ];
        let bytes = round_trip(&rows, false, false);
        let (back, _) = parse_back(&bytes);
        assert_eq!(back[0], vec![""]);
        assert_eq!(back[1], vec!["a"]);
        assert_eq!(back[2], vec!["a", "b", "c"]);
        assert_eq!(back[3], vec!["", ""]);
    }

    #[test]
    fn bom_written_and_detected() {
        let rows = vec![vec!["x".into()]];
        let bytes = round_trip(&rows, false, true);
        assert!(detect_bom(&bytes));
        let (_, has_bom) = parse_back(&bytes);
        assert!(has_bom);
    }

    #[test]
    fn crlf_terminator_used_when_asked() {
        let rows = vec![vec!["a".into(), "b".into()], vec!["c".into(), "d".into()]];
        let bytes = round_trip(&rows, true, false);
        assert_eq!(bytes, b"a,b\r\nc,d\r\n");
    }

    #[test]
    fn delimiter_validation_rejects_bad_input() {
        assert!(delimiter_byte(",").is_ok());
        assert!(delimiter_byte(";").is_ok());
        assert!(delimiter_byte("\"").is_err());
        assert!(delimiter_byte("").is_err());
    }

    #[test]
    fn decodes_windows_1252_when_not_utf8() {
        // "Müller,München" encoded as CP1252 (ü = 0xFC)
        let bytes: Vec<u8> = b"M\xFCller,M\xFCnchen\n".to_vec();
        let (text, has_bom, enc) = decode_bytes(&bytes).unwrap();
        assert_eq!(enc, "windows-1252");
        assert!(!has_bom);
        assert!(text.contains("M\u{00fc}ller"));
    }

    #[test]
    fn decodes_utf16le_with_bom() {
        let text = "a,b\nc,d\n";
        let mut bytes = vec![0xFF, 0xFE];
        for unit in text.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        let (decoded, has_bom, enc) = decode_bytes(&bytes).unwrap();
        assert_eq!(enc, "utf-16le");
        assert!(has_bom);
        assert_eq!(decoded, text);
    }

    #[test]
    fn utf8_bom_still_wins_over_1252_interpretation() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("café\n".as_bytes());
        let (text, has_bom, enc) = decode_bytes(&bytes).unwrap();
        assert_eq!(enc, "utf-8-bom");
        assert!(has_bom);
        assert!(text.starts_with("caf\u{00e9}"));
    }

    #[test]
    fn encode_to_cp1252_round_trips_and_rejects_unrepresentable() {
        let bytes = encode_text("M\u{00fc}nchen", "windows-1252", false).unwrap();
        assert_eq!(bytes, vec![b'M', 0xFC, b'n', b'c', b'h', b'e', b'n']);
        assert!(encode_text("caf\u{00e9} ✓", "windows-1252", false).is_err());
        assert!(encode_text("plain", "klingon", false).is_err());
    }

    #[test]
    fn write_csv_to_cp1252_and_reparse() {
        let dir = std::env::temp_dir().join(format!("mo_enc_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("enc.csv");
        let rows = vec![
            vec!["name".into(), "stadt".into()],
            vec!["M\u{00fc}ller".into(), "M\u{00fc}nchen".into()],
        ];
        let opts = CsvWriteOptions {
            delimiter: ",".into(),
            has_bom: false,
            crlf: false,
            encoding: Some("windows-1252".into()),
        };
        super::write_csv(path.to_str().unwrap().into(), rows.clone(), opts.clone()).unwrap();
        let raw = fs::read(&path).unwrap();
        assert!(raw.contains(&0xFC), "must contain CP1252 ü byte");
        let doc = super::parse_csv(path.to_str().unwrap().into()).unwrap();
        assert_eq!(doc.encoding, "windows-1252");
        assert_eq!(doc.rows[1], rows[1]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn atomic_save_writes_and_validates() {
        let dir = std::env::temp_dir().join(format!("mo_test_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.csv");
        let path_str = path.to_str().unwrap();

        let opts = CsvWriteOptions {
            delimiter: ",".into(),
            has_bom: false,
            crlf: false,
            encoding: None,
        };
        let rows = vec![vec!["1".into(), "2".into()], vec!["3".into(), "4".into()]];
        let res = super::write_csv(path_str.into(), rows.clone(), opts.clone()).unwrap();
        assert_eq!(res.size_bytes, 8); // "1,2\n3,4\n"

        // second save creates .bak
        let rows2 = vec![vec!["9".into()]];
        super::write_csv(path_str.into(), rows2, opts).unwrap();
        let bak = fs::read_to_string(dir.join("t.csv.bak")).unwrap();
        assert_eq!(bak, "1,2\n3,4\n");
        let cur = fs::read_to_string(&path).unwrap();
        assert_eq!(cur, "9\n");
        assert!(!path.with_extension("csv.tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
