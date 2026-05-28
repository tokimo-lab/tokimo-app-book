//! Book sidecar handlers.

#![allow(clippy::unused_async)]

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    ctx::AppCtx,
    db::{
        entities::{containers, items},
        repos::{
            book_sync_status_repo::BookSyncStatusRepo,
            chapters_repo::ChaptersRepo,
            containers_repo::ContainersRepo,
            download_tasks_repo::DownloadTasksRepo,
            items_repo::{CreateItemParams, ItemsRepo, UpdateItemParams},
        },
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
) -> Result<Json<ApiResponse<Vec<containers::Model>>>, AppError> {
    let user_id = q
        .user_id
        .ok_or_else(|| AppError::BadRequest("user_id is required".to_string()))?;
    let rows = ContainersRepo::list_by_user(&ctx.db, user_id).await?;
    Ok(ok(rows))
}

/// GET /{id}
pub async fn get_book(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<containers::Model>>, AppError> {
    let container = ContainersRepo::get_by_id(&ctx.db, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("container {id} not found")))?;
    Ok(ok(container))
}

#[derive(Debug, Deserialize)]
pub struct CreateBookRequest {
    container_id: Uuid,
    title: String,
    author: Option<String>,
    file_path: Option<String>,
    format: Option<String>,
    size_bytes: Option<i64>,
    content: Option<String>,
    metadata: Option<serde_json::Value>,
}

/// POST /
pub async fn create_book(
    State(ctx): State<Arc<AppCtx>>,
    Json(req): Json<CreateBookRequest>,
) -> Result<Json<ApiResponse<items::Model>>, AppError> {
    let item = ItemsRepo::create(
        &ctx.db,
        CreateItemParams {
            container_id: req.container_id,
            title: req.title,
            author: req.author,
            file_path: req.file_path.unwrap_or_default(),
            format: req.format.unwrap_or_else(|| "txt".to_string()),
            size_bytes: req.size_bytes,
            content: req.content,
            metadata: req.metadata.unwrap_or_else(|| serde_json::json!({})),
        },
    )
    .await?;
    Ok(ok(item))
}

#[derive(Debug, Deserialize)]
pub struct UpdateBookRequest {
    title: Option<String>,
    author: Option<String>,
    file_path: Option<String>,
    format: Option<String>,
    size_bytes: Option<i64>,
    content: Option<String>,
    metadata: Option<serde_json::Value>,
}

/// PATCH /{id}
pub async fn update_book(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateBookRequest>,
) -> Result<Json<ApiResponse<items::Model>>, AppError> {
    let item = ItemsRepo::update(
        &ctx.db,
        id,
        UpdateItemParams {
            title: req.title,
            author: req.author,
            file_path: req.file_path,
            format: req.format,
            size_bytes: req.size_bytes,
            content: req.content,
            metadata: req.metadata,
        },
    )
    .await?;
    Ok(ok(item))
}

/// DELETE /{id}
pub async fn delete_book(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    ItemsRepo::delete(&ctx.db, id).await?;
    Ok(ok(()))
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum ReorderBooksRequest {
    Array(#[allow(dead_code)] Vec<Uuid>),
    Object {
        #[allow(dead_code)]
        #[serde(alias = "ids", alias = "books", alias = "order")]
        ids: Vec<Uuid>,
    },
}

/// POST /reorder
pub async fn reorder_books(Json(_req): Json<ReorderBooksRequest>) -> Result<Json<ApiResponse<()>>, AppError> {
    Ok(ok(()))
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

#[derive(Serialize)]
pub struct ChapterContentResponse {
    id: Uuid,
    title: String,
    idx: i32,
    content: String,
    #[serde(rename = "itemId")]
    item_id: Uuid,
}

/// GET /item/{book_id}/chapters/{chapter_id}/content
pub async fn get_chapter_content(
    State(ctx): State<Arc<AppCtx>>,
    Path((book_id, chapter_id)): Path<(Uuid, i32)>,
) -> Result<Json<ApiResponse<ChapterContentResponse>>, AppError> {
    let chapter = ChaptersRepo::get_by_item_and_idx(&ctx.db, book_id, chapter_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("chapter {chapter_id} in item {book_id} not found")))?;
    Ok(ok(ChapterContentResponse {
        id: chapter.id,
        title: chapter.title,
        idx: chapter.idx,
        content: chapter.content,
        item_id: chapter.item_id,
    }))
}

// ── Sync ──────────────────────────────────────────────────────────────────────

/// POST /{id}/sync
pub async fn sync_book(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let _container = ContainersRepo::get_by_id(&ctx.db, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("container {id} not found")))?;
    // TODO: real scan task in worker queue
    BookSyncStatusRepo::upsert(
        &ctx.db,
        id,
        "completed".to_string(),
        Some(chrono::Utc::now().into()),
        None,
        Some(serde_json::json!({"completed": true})),
    )
    .await?;
    Ok(ok(()))
}

#[derive(Serialize)]
pub struct BookSyncStatusResponse {
    #[serde(rename = "bookId")]
    book_id: Uuid,
    #[serde(rename = "containerId")]
    container_id: Uuid,
    status: String,
    #[serde(rename = "lastSyncAt")]
    last_sync_at: Option<String>,
    #[serde(rename = "lastError")]
    last_error: Option<String>,
    progress: Option<serde_json::Value>,
    #[serde(rename = "updatedAt")]
    updated_at: String,
}

/// GET /{id}/sync-status
pub async fn get_book_sync_status(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<BookSyncStatusResponse>>, AppError> {
    let status = BookSyncStatusRepo::get_by_container(&ctx.db, id).await?;
    let response = if let Some(s) = status {
        BookSyncStatusResponse {
            book_id: s.container_id,
            container_id: s.container_id,
            status: s.status,
            last_sync_at: s.last_sync_at.map(|t| t.to_string()),
            last_error: s.last_error,
            progress: s.progress,
            updated_at: s.updated_at.to_string(),
        }
    } else {
        BookSyncStatusResponse {
            book_id: id,
            container_id: id,
            status: "none".to_string(),
            last_sync_at: None,
            last_error: None,
            progress: None,
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    };
    Ok(ok(response))
}

/// GET /sync-statuses
pub async fn get_all_book_sync_statuses(
    State(ctx): State<Arc<AppCtx>>,
) -> Result<Json<ApiResponse<Vec<BookSyncStatusResponse>>>, AppError> {
    let statuses = BookSyncStatusRepo::list_all(&ctx.db).await?;
    let response: Vec<BookSyncStatusResponse> = statuses
        .into_iter()
        .map(|s| BookSyncStatusResponse {
            book_id: s.container_id,
            container_id: s.container_id,
            status: s.status,
            last_sync_at: s.last_sync_at.map(|t| t.to_string()),
            last_error: s.last_error,
            progress: s.progress,
            updated_at: s.updated_at.to_string(),
        })
        .collect();
    Ok(ok(response))
}

// ── Download / Search ────────────────────────────────────────────────────────

/// GET /providers
pub async fn list_providers() -> Result<Json<ApiResponse<Vec<String>>>, AppError> {
    // TODO: integrate `bookfinder` crate for real provider search（独立 ticket）
    Ok(ok(vec!["libgen".to_string(), "z-library".to_string()]))
}

#[derive(Debug, Deserialize)]
pub struct SearchBooksRequest {
    provider: String,
    query: String,
}

/// POST /search
pub async fn search_books(
    Json(req): Json<SearchBooksRequest>,
) -> Result<Json<ApiResponse<Vec<serde_json::Value>>>, AppError> {
    if req.provider.is_empty() || req.query.is_empty() {
        return Err(AppError::BadRequest("provider and query are required".to_string()));
    }
    // TODO: integrate `bookfinder` crate for real provider search（独立 ticket）
    Ok(ok(vec![]))
}

#[derive(Debug, Deserialize)]
pub struct GetBookInfoRequest {
    provider: String,
    external_id: String,
}

#[derive(Serialize)]
pub struct BookInfoResponse {
    title: String,
    author: Option<String>,
}

/// POST /book-info
pub async fn get_book_info(
    Json(req): Json<GetBookInfoRequest>,
) -> Result<Json<ApiResponse<BookInfoResponse>>, AppError> {
    if req.provider.is_empty() || req.external_id.is_empty() {
        return Err(AppError::BadRequest(
            "provider and external_id are required".to_string(),
        ));
    }
    // TODO: integrate `bookfinder` crate for real provider search（独立 ticket）
    Ok(ok(BookInfoResponse {
        title: "(stub)".to_string(),
        author: None,
    }))
}

#[derive(Debug, Deserialize)]
pub struct DownloadBookRequest {
    provider: String,
    external_id: String,
    #[allow(dead_code)]
    container_id: Uuid,
    user_id: Option<Uuid>,
}

#[derive(Serialize)]
pub struct DownloadBookResponse {
    #[serde(rename = "taskId")]
    task_id: String,
}

/// POST /download
pub async fn download_book(
    State(ctx): State<Arc<AppCtx>>,
    Json(req): Json<DownloadBookRequest>,
) -> Result<Json<ApiResponse<DownloadBookResponse>>, AppError> {
    // TODO: integrate `bookfinder` crate for real provider search（独立 ticket）
    let task = DownloadTasksRepo::insert(
        &ctx.db,
        req.user_id,
        req.provider.clone(),
        req.external_id.clone(),
        Some(req.external_id),
        "completed".to_string(),
        None,
        None,
    )
    .await?;
    Ok(ok(DownloadBookResponse {
        task_id: task.id.to_string(),
    }))
}
