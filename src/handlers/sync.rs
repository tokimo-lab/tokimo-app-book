use axum::{
    extract::{Path, State},
    response::Json,
};
use std::sync::Arc;
use tracing::{error, info};
use uuid::Uuid;

use crate::db::ApiDateTimeExt;
use crate::db::repos::novel_repo::NovelRepo;
use crate::error::AppError;
use crate::error::OptionExt;
use crate::handlers::{ok, ApiResponse};
use crate::services::media::app_sync::AppSyncService;
use crate::AppState;

use super::{NovelSyncInput, parse_uuid};

/// POST /api/apps/novel/{id}/sync
pub async fn sync_novel(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    body: Option<Json<NovelSyncInput>>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid novel id".into()))?;

    let _novel = NovelRepo::get_container_by_id(&state.db, uid)
        .await?
        .not_found(format!("novel library {id} not found"))?;

    let clear_data = body.and_then(|b| b.clear_data).unwrap_or(false);
    let db = state.db.clone();
    let sources = state.sources.clone();
    let storage = state.storage.clone();

    tokio::spawn(async move {
        match AppSyncService::execute_novel_sync(&db, &sources, &storage, uid, clear_data).await {
            Ok(result) => {
                info!(
                    "novel sync completed, {} jobs dispatched",
                    result.total_jobs
                );
            }
            Err(e) => {
                error!("novel sync failed: {e}");
            }
        }
    });

    Ok(ok(serde_json::json!({ "success": true })))
}

/// GET /api/apps/novel/{id}/sync-status
pub async fn get_novel_sync_status(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid = parse_uuid(&id)?;
    let novel = NovelRepo::get_container_by_id(&state.db, uid)
        .await?
        .not_found(format!("novel library {id} not found"))?;

    Ok(ok(serde_json::json!({
        "novelId": uid.to_string(),
        "status": novel.sync_status,
        "lastSyncAt": novel.last_sync_at.to_api_datetime(),
    })))
}

/// GET /api/apps/novel/sync-statuses
pub async fn get_all_novel_sync_statuses(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<Vec<serde_json::Value>>>, AppError> {
    let rows = NovelRepo::list_containers(&state.db).await?;
    let statuses: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|n| {
            serde_json::json!({
                "novelId": n.id.to_string(),
                "status": n.sync_status,
                "lastSyncAt": n.last_sync_at.to_api_datetime(),
            })
        })
        .collect();
    Ok(ok(statuses))
}
