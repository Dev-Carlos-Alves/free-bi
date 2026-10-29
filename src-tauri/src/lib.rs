//! App desktop: a interface web chama o motor pelo comando `call`.

use freebi_engine::Engine;
use serde_json::Value;
use std::sync::{Arc, Mutex};

struct AppState(Arc<Mutex<Engine>>);

#[tauri::command]
async fn call(state: tauri::State<'_, AppState>, cmd: String, args: Value) -> Result<Value, String> {
    // Consultas pesadas rodam numa thread separada para não travar a interface.
    let engine = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut e = engine.lock().map_err(|e| e.to_string())?;
        e.handle(&cmd, &args).map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState(Arc::new(Mutex::new(Engine::new()))))
        .invoke_handler(tauri::generate_handler![call])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Free BI");
}
