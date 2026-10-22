//! Bounded blocking execution keeps synchronous SQLite transactions off the
//! async I/O workers without moving or splitting their authority boundaries.
use crate::{internal, AppState};
use axum::{
    extract::Request,
    http::{Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

pub(crate) async fn request(state: AppState, request: Request, next: Next) -> Response {
    // Shutdown must remain reachable when ordinary request capacity is full.
    if request.uri().path() == "/api/v1/shutdown" {
        return next.run(request).await;
    }
    let Ok(permit) = state.request_slots.clone().try_acquire_owned() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error":"runtime request capacity is busy; retry shortly"})),
        )
            .into_response();
    };
    let runtime = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || runtime.block_on(async move {
        // The permit and admission guard belong to the executing operation,
        // even if its HTTP client disconnects while a transaction is running.
        let _permit = permit;
        if request.method() != Method::GET {
            let _admission = state.admission.read().await;
            if state.shutting_down() {
                return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error":"runtime is shutting down; restart it before starting new work"}))).into_response();
            }
            next.run(request).await
        } else { next.run(request).await }
    })).await.unwrap_or_else(|error| internal(error).into_response())
}

/// Call only after scheduling admission. The shared active-run guard limits
/// these long-lived workers to four, plus at most four baseline output relays.
pub(crate) fn worker(
    future: impl std::future::Future<Output = ()> + Send + 'static,
) -> tokio::task::JoinHandle<()> {
    let runtime = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || runtime.block_on(future))
}
