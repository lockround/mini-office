pub mod csv;
pub mod docx;
pub mod xlsx;

use std::sync::Mutex;

/// File paths passed on the command line, collected at startup so the
/// frontend can open them as tabs (myapp.exe a.csv b.xlsx).
#[tauri::command]
fn cli_open_paths(state: tauri::State<Mutex<Vec<String>>>) -> Vec<String> {
    state.lock().map(|v| v.clone()).unwrap_or_default()
}

fn collect_cli_paths() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|arg| {
            let p = std::path::Path::new(arg);
            p.is_file() && !arg.ends_with(".tmp")
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(Mutex::new(collect_cli_paths()))
        .invoke_handler(tauri::generate_handler![
            csv::parse_csv,
            csv::write_csv,
            csv::stat_file,
            xlsx::parse_xlsx,
            xlsx::write_xlsx,
            docx::read_file_base64,
            docx::write_docx,
            cli_open_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
