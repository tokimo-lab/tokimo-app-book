use axum::{
    extract::{Path, State},
    response::Json,
};
use std::sync::Arc;
use uuid::Uuid;

use crate::db::models::novel::NovelContainerOutput;
use crate::db::repos::novel_repo::NovelRepo;
use crate::error::AppError;
use crate::error::OptionExt;
use crate::handlers::{ok, ok_empty, ApiResponse};
use crate::services::media::source::normalize_source_path;
use crate::AppState;

use super::{
    parse_uuid, sources_to_json, to_novel_container_output, to_novel_container_outputs,
    CreateNovelContainerInput, NovelReorderInput, UpdateNovelContainerInput,
};

/// GET /api/apps/novel
pub async fn list_novels(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<Vec<NovelContainerOutput>>>, AppError> {
    let rows = NovelRepo::list_containers(&state.db).await?;
    let outputs = to_novel_container_outputs(&state.db, rows).await?;
    Ok(ok(outputs))
}

/// GET /api/apps/novel/{id}
pub async fn get_novel(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<NovelContainerOutput>>, AppError> {
    let uid = parse_uuid(&id)?;
    let model = NovelRepo::get_container_by_id(&state.db, uid)
        .await?
        .not_found(format!("novel {id} not found"))?;
    let output = to_novel_container_output(&state.db, model).await?;
    Ok(ok(output))
}

/// POST /api/apps/novel
pub async fn create_novel(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateNovelContainerInput>,
) -> Result<Json<ApiResponse<NovelContainerOutput>>, AppError> {
    let model =
        NovelRepo::create_container(&state.db, body.name, body.r#type, body.settings).await?;
    let novel_id = model.id;

    let mut needs_update = false;
    let mut update = crate::db::repos::novel_repo::UpdateNovelContainerFields {
        name: None,
        description: body.description.clone(),
        icon: body.icon.clone(),
        color: body
            .color
            .as_ref()
            .map(|c| if c.is_empty() { None } else { Some(c.clone()) }),
        poster_path: None,
        scrape_enabled: body.scrape_enabled,
        scrape_agents: body.scrape_agents.clone(),
        settings: None,
        sources: None,
    };

    if body.icon.is_some()
        || body.color.is_some()
        || body.description.is_some()
        || body.scrape_enabled.is_some()
        || body.scrape_agents.is_some()
    {
        needs_update = true;
    }

    if let Some(ref sources) = body.sources {
        for s in sources {
            let _: Uuid = s
                .source_id
                .parse()
                .map_err(|_| AppError::BadRequest("invalid source_id".into()))?;
            normalize_source_path(&s.root_path).map_err(AppError::BadRequest)?;
        }
        update.sources = Some(sources_to_json(sources));
        needs_update = true;
    }

    if needs_update {
        NovelRepo::update_container(&state.db, novel_id, update).await?;
    }

    let model = NovelRepo::get_container_by_id(&state.db, novel_id)
        .await?
        .internal("failed to fetch created novel")?;
    let output = to_novel_container_output(&state.db, model).await?;
    Ok(ok(output))
}

/// PATCH /api/apps/novel/{id}
pub async fn update_novel(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<UpdateNovelContainerInput>,
) -> Result<Json<ApiResponse<NovelContainerOutput>>, AppError> {
    let uid = parse_uuid(&id)?;

    let _existing = NovelRepo::get_container_by_id(&state.db, uid)
        .await?
        .not_found(format!("novel {id} not found"))?;

    let mut update = crate::db::repos::novel_repo::UpdateNovelContainerFields {
        name: body.name,
        description: body.description,
        icon: body.icon,
        color: body
            .color
            .map(|c| if c.is_empty() { None } else { Some(c) }),
        poster_path: None,
        scrape_enabled: body.scrape_enabled,
        scrape_agents: body.scrape_agents,
        settings: body.settings,
        sources: None,
    };

    if let Some(ref sources) = body.sources {
        for s in sources {
            let _: Uuid = s
                .source_id
                .parse()
                .map_err(|_| AppError::BadRequest("invalid source_id".into()))?;
            normalize_source_path(&s.root_path).map_err(AppError::BadRequest)?;
        }
        update.sources = Some(sources_to_json(sources));
    }

    NovelRepo::update_container(&state.db, uid, update).await?;

    let model = NovelRepo::get_container_by_id(&state.db, uid)
        .await?
        .internal("failed to fetch updated novel")?;
    let output = to_novel_container_output(&state.db, model).await?;
    Ok(ok(output))
}

/// DELETE /api/apps/novel/{id}
pub async fn delete_novel(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let uid = parse_uuid(&id)?;
    NovelRepo::delete_container(&state.db, uid).await?;
    Ok(ok_empty())
}

/// POST /api/apps/novel/reorder
pub async fn reorder_novels(
    State(state): State<Arc<AppState>>,
    Json(body): Json<NovelReorderInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let orders: Vec<(Uuid, i32)> = body
        .orders
        .into_iter()
        .filter_map(|item| {
            item.id
                .parse::<Uuid>()
                .ok()
                .map(|uid| (uid, item.sort_order))
        })
        .collect();
    NovelRepo::reorder_containers(&state.db, orders).await?;
    Ok(ok_empty())
}
