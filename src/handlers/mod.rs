//! Stub handlers — all return 501 Not Implemented.
//!
//! TODO: migrate full implementation from packages/rust-server/src/apps/book/
//! once book DB entities and repos are ported to the sidecar schema.

#![allow(clippy::unused_async)]

use axum::Json;
use axum::http::StatusCode;

type StubResult = (StatusCode, Json<serde_json::Value>);

fn not_implemented(name: &str) -> StubResult {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(serde_json::json!({
            "success": false,
            "error": format!("book sidecar: TODO migrate {name}")
        })),
    )
}

// ── Container CRUD ────────────────────────────────────────────────────────────

/// GET /
pub async fn list_books() -> StubResult {
    not_implemented("list_books")
}

/// GET /{id}
pub async fn get_book() -> StubResult {
    not_implemented("get_book")
}

/// POST /
pub async fn create_book() -> StubResult {
    not_implemented("create_book")
}

/// PATCH /{id}
pub async fn update_book() -> StubResult {
    not_implemented("update_book")
}

/// DELETE /{id}
pub async fn delete_book() -> StubResult {
    not_implemented("delete_book")
}

/// POST /reorder
pub async fn reorder_books() -> StubResult {
    not_implemented("reorder_books")
}

// ── Book items ────────────────────────────────────────────────────────────────

/// GET /{id}/items
pub async fn list_book_items() -> StubResult {
    not_implemented("list_book_items")
}

/// GET /item/{id}
pub async fn get_book_detail() -> StubResult {
    not_implemented("get_book_detail")
}

/// GET /item/{book_id}/chapters/{chapter_id}/content
pub async fn get_chapter_content() -> StubResult {
    not_implemented("get_chapter_content")
}

// ── Sync ──────────────────────────────────────────────────────────────────────

/// POST /{id}/sync
pub async fn sync_book() -> StubResult {
    not_implemented("sync_book")
}

/// GET /{id}/sync-status
pub async fn get_book_sync_status() -> StubResult {
    not_implemented("get_book_sync_status")
}

/// GET /sync-statuses
pub async fn get_all_book_sync_statuses() -> StubResult {
    not_implemented("get_all_book_sync_statuses")
}

// ── Download / Search ────────────────────────────────────────────────────────

/// GET /providers
pub async fn list_providers() -> StubResult {
    not_implemented("list_providers")
}

/// POST /search
/// Original: SSE stream — TODO: migrate to SSE once novel_downloader is wired.
pub async fn search_books() -> StubResult {
    not_implemented("search_books")
}

/// POST /book-info
pub async fn get_book_info() -> StubResult {
    not_implemented("get_book_info")
}

/// POST /download
/// Original: SSE stream — TODO: migrate to SSE once download infra is wired.
pub async fn download_book() -> StubResult {
    not_implemented("download_book")
}
