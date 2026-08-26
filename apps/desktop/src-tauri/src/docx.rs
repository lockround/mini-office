use base64::Engine;
use std::fs;
use std::io::{BufReader, Write};
use std::path::{Path, PathBuf};

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

#[tauri::command]
pub fn read_file_base64(path: String) -> Result<String, String> {
    let bytes =
        fs::read(&path).map_err(|e| format!("cannot read {path}: {}", io_err(&e)))?;
    Ok(B64.encode(bytes))
}

fn io_err(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::NotFound => "file not found".into(),
        std::io::ErrorKind::PermissionDenied => "permission denied".into(),
        _ => e.to_string(),
    }
}

#[derive(serde::Deserialize, Clone)]
pub struct DocxWriteOptions {
    /// unused for now; reserved for future save options
    #[serde(default)]
    pub _placeholder: Option<()>,
}

/// Atomic save of a docx payload with backup, mirroring csv/xlsx pipelines.
#[tauri::command]
pub fn write_docx(
    path: String,
    data_b64: String,
    _options: DocxWriteOptions,
) -> Result<super::csv::SaveResult, String> {
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!("directory does not exist: {}", parent.display()));
        }
    }

    let bytes = B64
        .decode(data_b64.as_bytes())
        .map_err(|e| format!("bad payload: {e}"))?;

    // minimal structural validation before touching the original:
    // a docx is a zip starting with PK and must contain [Content_Types].xml
    if bytes.len() < 4 || &bytes[0..2] != b"PK" {
        return Err("validation failed: not a zip/docx payload".into());
    }

    let tmp_path: PathBuf = {
        let mut p = path.clone().into_bytes();
        p.extend_from_slice(b".tmp");
        PathBuf::from(std::str::from_utf8(&p).map_err(|_| "bad path")?)
    };

    {
        let mut tmp = fs::File::create(&tmp_path)
            .map_err(|e| format!("cannot create temp file: {}", io_err(&e)))?;
        tmp.write_all(&bytes).map_err(|e| e.to_string())?;
        tmp.sync_all().map_err(|e| format!("flush failed: {e}"))?;
    }

    // validate the tmp file opens as a zip with a content-types entry
    {
        let file = fs::File::open(&tmp_path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(BufReader::new(file))
            .map_err(|e| format!("validation failed: {e}"))?;
        if archive.by_name("[Content_Types].xml").is_err() {
            return Err("validation failed: missing [Content_Types].xml".into());
        }
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    fn tempdir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mo_docx_{}_{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_minimal_zip() -> Vec<u8> {
        // build a real zip containing [Content_Types].xml via the zip crate
        let buf = std::io::Cursor::new(Vec::new());
        let mut w = zip::ZipWriter::new(buf);
        w.start_file(
            "[Content_Types].xml",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        std::io::Write::write_all(&mut w, b"<Types/>").unwrap();
        w.finish().unwrap().into_inner()
    }

    #[test]
    fn round_trips_bytes_and_creates_bak() {
        let dir = tempdir("rt");
        let path = dir.join("t.docx");
        let path_str = path.to_str().unwrap();

        let payload = B64.encode(make_minimal_zip());
        let opts = DocxWriteOptions { _placeholder: None };

        let res = super::write_docx(path_str.into(), payload.clone(), opts.clone()).unwrap();
        assert!(res.size_bytes > 0);
        assert!(!path.with_extension("docx.tmp").exists());

        // second save creates .bak
        super::write_docx(path_str.into(), payload, opts).unwrap();
        assert!(dir.join("t.docx.bak").exists());

        // content readable back through our own reader
        let back = super::read_file_base64(path_str.into()).unwrap();
        assert_eq!(B64.decode(back).unwrap()[0..2], *b"PK");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_non_zip_payload() {
        let dir = tempdir("reject");
        let path_str = dir.join("t.docx").to_str().unwrap().to_string();
        let bad = B64.encode(b"this is not a zip file at all........");
        let err =
            super::write_docx(path_str, bad, DocxWriteOptions { _placeholder: None })
                .unwrap_err();
        assert!(err.contains("not a zip"), "{err}");
        assert!(!dir.join("t.docx").exists());
        assert!(!dir.join("t.docx.tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
