use axum::{
    extract::{Path, State},
    response::Json,
};
use std::sync::Arc;
use tracing::{error, info};
use uuid::Uuid;

use crate::AppState;
use crate::db::ApiDateTimeExt;
use crate::db::repos::book_repo::BookRepo;
use crate::error::AppError;
use crate::error::OptionExt;
use crate::handlers::user::AuthUser;
use crate::handlers::{ApiResponse, ok};
use crate::services::app_sync::AppSyncService;

use super::{BookSyncInput, parse_uuid};

/// POST /api/apps/book/{id}/sync
pub async fn sync_book(
    State(state): State<Arc<AppState>>,
    AuthUser(auth): AuthUser,
    Path(id): Path<String>,
    body: Option<Json<BookSyncInput>>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid: Uuid = id.parse().map_err(|_| AppError::BadRequest("invalid book id".into()))?;
    let auth_user_id: Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid user id in session".into()))?;

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
        match AppSyncService::execute_book_sync(&db, &sources, &storage, uid, Some(auth_user_id), false).await {
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
