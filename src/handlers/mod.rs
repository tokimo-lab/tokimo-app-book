//! Book sidecar handlers.

#![allow(clippy::unused_async)]

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    ctx::AppCtx,
    db::{
        entities::items,
        repos::{containers_repo::ContainersRepo, items_repo::ItemsRepo},
    },
    error::AppError,
};

#[derive(Serialize)]
pub struct ApiResponse<T> {
    success: bool,
    data: T,
}

fn ok<T>(data: T) -> Json<ApiResponse<T>> {
    Json(ApiResponse { success: true, data })
}

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

#[derive(Debug, Deserialize)]
pub struct ListBooksQuery {
    user_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct ListItemsQuery {
    page: Option<u64>,
    page_size: Option<u64>,
    #[serde(rename = "pageSize")]
    page_size_camel: Option<u64>,
}

impl ListItemsQuery {
    fn page(&self) -> u64 {
        self.page.unwrap_or(1).max(1)
    }

    fn page_size(&self) -> u64 {
        self.page_size.or(self.page_size_camel).unwrap_or(20).clamp(1, 200)
    }
}

// ── Container CRUD ────────────────────────────────────────────────────────────

/// GET /
pub async fn list_books(
    State(ctx): State<Arc<AppCtx>>,
    Query(q): Query<ListBooksQuery>,
) -> Result<Json<ApiResponse<Vec<crate::db::entities::containers::Model>>>, AppError> {
    let user_id = q
        .user_id
        .ok_or_else(|| AppError::BadRequest("user_id is required".to_string()))?;
    let rows = ContainersRepo::list_by_user(&ctx.db, user_id).await?;
    Ok(ok(rows))
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
pub async fn list_book_items(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<Uuid>,
    Query(q): Query<ListItemsQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let page = q.page();
    let page_size = q.page_size();
    let (rows, total) = ItemsRepo::list_by_container(&ctx.db, id, page, page_size).await?;
    Ok(ok(serde_json::json!({
        "items": rows,
        "total": total,
        "page": page,
        "pageSize": page_size,
    })))
}

/// GET /item/{id}
pub async fn get_book_detail(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<items::Model>>, AppError> {
    let item = ItemsRepo::get_by_id(&ctx.db, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("book item {id} not found")))?;
    Ok(ok(item))
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
