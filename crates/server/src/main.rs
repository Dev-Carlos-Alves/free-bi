//! Servidor local do Free BI: `freebi-web [porta] [pasta-do-frontend]`.
//! Abre em http://127.0.0.1:7878 — útil em qualquer sistema com navegador.

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use freebi_engine::Engine;
use serde::Deserialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tower_http::services::{ServeDir, ServeFile};

#[derive(Clone)]
struct AppState {
    engine: Arc<Mutex<Engine>>,
    uploads: PathBuf,
}

fn err(e: impl std::fmt::Display) -> Response {
    (StatusCode::BAD_REQUEST, e.to_string()).into_response()
}

async fn call(State(s): State<AppState>, Path(cmd): Path<String>, body: Bytes) -> Response {
    let args: Value = if body.is_empty() { Value::Null } else { serde_json::from_slice(&body).unwrap_or(Value::Null) };
    let engine = s.engine.clone();
    let r = tokio::task::spawn_blocking(move || engine.lock().unwrap().handle(&cmd, &args)).await;
    match r {
        Ok(Ok(v)) => Json(v).into_response(),
        Ok(Err(e)) => err(format!("{e:#}")),
        Err(e) => err(e),
    }
}

#[derive(Deserialize)]
struct NameQ {
    name: String,
}

fn safe_name(n: &str) -> String {
    let base = std::path::Path::new(n).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "arquivo".into());
    base.replace(['/', '\\'], "_")
}

async fn upload(State(s): State<AppState>, Query(q): Query<NameQ>, body: Bytes) -> Response {
    let path = s.uploads.join(safe_name(&q.name));
    match std::fs::write(&path, &body) {
        Ok(_) => Json(serde_json::json!({ "path": path.to_string_lossy() })).into_response(),
        Err(e) => err(e),
    }
}

async fn temp_path(State(s): State<AppState>, Query(q): Query<NameQ>) -> Response {
    Json(serde_json::json!({ "path": s.uploads.join(safe_name(&q.name)).to_string_lossy() })).into_response()
}

#[derive(Deserialize)]
struct PathQ {
    path: String,
}

async fn download(State(s): State<AppState>, Query(q): Query<PathQ>) -> Response {
    let p = PathBuf::from(&q.path);
    // Só entrega arquivos da pasta de trabalho do servidor.
    if p.parent() != Some(s.uploads.as_path()) {
        return (StatusCode::FORBIDDEN, "caminho não permitido").into_response();
    }
    match std::fs::read(&p) {
        Ok(b) => (
            [
                (header::CONTENT_TYPE, "application/octet-stream".to_string()),
                (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", safe_name(&q.path))),
            ],
            b,
        )
            .into_response(),
        Err(e) => err(e),
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let port: u16 = args.next().and_then(|p| p.parse().ok()).unwrap_or(7878);
    let dist = args.next().map(PathBuf::from).unwrap_or_else(|| PathBuf::from("dist"));
    let uploads = std::env::temp_dir().join("freebi-web");
    std::fs::create_dir_all(&uploads)?;
    let state = AppState { engine: Arc::new(Mutex::new(Engine::new())), uploads: uploads.canonicalize()? };
    let app = Router::new()
        .route("/api/upload", post(upload))
        .route("/api/temp_path", get(temp_path))
        .route("/api/download", get(download))
        .route("/api/{cmd}", post(call))
        .fallback_service(ServeDir::new(&dist).fallback(ServeFile::new(dist.join("index.html"))))
        .layer(axum::extract::DefaultBodyLimit::max(2 * 1024 * 1024 * 1024))
        .with_state(state);
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    println!("Free BI rodando em http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
