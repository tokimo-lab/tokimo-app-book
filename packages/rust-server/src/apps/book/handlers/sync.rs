use axum::{
    extract::{Path, State},
    response::Json,
};
use std::sync::Arc;
use tracing::{error, info};
use uuid::Uuid;

use crate::AppState;
use crate::db::ApiDateTimeExt;
use crate::db::models::book::{BookSyncProgressOutput, BookTaskProgress};
use crate::db::repos::book_repo::BookRepo;
use crate::db::repos::job_repo::JobRepo;
use crate::error::AppError;
use crate::error::OptionExt;
use crate::handlers::{ApiResponse, ok};
use crate::services::app_sync::AppSyncService;

use super::{BookSyncInput, parse_uuid};

/// POST /api/apps/book/{id}/sync
pub async fn sync_book(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    body: Option<Json<BookSyncInput>>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid: Uuid = id.parse().map_err(|_| AppError::BadRequest("invalid book id".into()))?;

    let book = BookRepo::get_container_by_id(&state.db, uid)
        .await?
        .not_found(format!("book library {id} not found"))?;

    let clear_data = body.and_then(|b| b.clear_data).unwrap_or(false);

    if book.sync_status == "syncing" && !clear_data {
        return Err(AppError::Conflict("Book library is already syncing".into()));
    }

    // Clear data synchronously so frontend sees empty state immediately
    if clear_data {
        AppSyncService::clear_library_data(&state.db, uid, &book.r#type).await?;
    }

    BookRepo::update_sync_status(&state.db, uid, "syncing", None).await?;

    let db = state.db.clone();
    let sources = state.sources.clone();
    let storage = state.storage.clone();

    tokio::spawn(async move {
        match AppSyncService::execute_book_sync(&db, &sources, &storage, uid, false).await {
            Ok(result) => {
                info!("book sync completed, {} jobs dispatched", result.total_jobs);
            }
            Err(e) => {
                error!("book sync failed: {e}");
            }
        }
    });

    Ok(ok(serde_json::json!({ "success": true })))
}

/// GET /api/apps/book/{id}/sync-status
pub async fn get_book_sync_status(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid = parse_uuid(&id)?;
    let book = BookRepo::get_container_by_id(&state.db, uid)
        .await?
        .not_found(format!("book library {id} not found"))?;

    Ok(ok(serde_json::json!({
        "bookId": uid.to_string(),
        "status": book.sync_status,
        "lastSyncAt": book.last_sync_at.to_api_datetime(),
    })))
}

/// GET /api/apps/book/{id}/sync-progress
pub async fn get_book_sync_progress(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<BookSyncProgressOutput>>, AppError> {
    let uid = parse_uuid(&id)?;
    let book = BookRepo::get_container_by_id(&state.db, uid)
        .await?
        .not_found(format!("book library {id} not found"))?;

    let job_types = &["book_scrape"];
    let (total, completed, running, pending, failed) = JobRepo::count_jobs_by_app(&state.db, uid, job_types).await?;

    let rows = JobRepo::get_task_progress_by_app(&state.db, uid, job_types).await?;
    let tasks: Vec<BookTaskProgress> = rows
        .into_iter()
        .map(|row| {
            let status = if row.running > 0 {
                "running"
            } else if row.pending > 0 {
                "pending"
            } else if row.failed > 0 && row.completed == 0 {
                "failed"
            } else {
                "completed"
            };

            let (total_items, processed_items) = {
                let t = row.completed + row.running + row.pending + row.failed;
                (t, row.completed)
            };

            BookTaskProgress {
                task_type: row.job_type,
                status: status.to_string(),
                total_items,
                processed_items,
            }
        })
        .collect();

    Ok(ok(BookSyncProgressOutput {
        book_id: uid.to_string(),
        status: book.sync_status,
        total,
        completed,
        running,
        pending,
        failed,
        tasks,
    }))
}

/// GET /api/apps/book/sync-statuses
pub async fn get_all_book_sync_statuses(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<Vec<serde_json::Value>>>, AppError> {
    let rows = BookRepo::list_containers(&state.db).await?;
    let statuses: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|n| {
            serde_json::json!({
                "bookId": n.id.to_string(),
                "status": n.sync_status,
                "lastSyncAt": n.last_sync_at.to_api_datetime(),
            })
        })
        .collect();
    Ok(ok(statuses))
}
