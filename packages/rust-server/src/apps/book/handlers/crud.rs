use axum::{
    extract::{Path, State},
    response::Json,
};
use std::sync::Arc;
use uuid::Uuid;

use crate::db::models::book::BookContainerOutput;
use crate::db::repos::book_repo::BookRepo;
use crate::error::AppError;
use crate::error::OptionExt;
use crate::handlers::{ok, ok_empty, ApiResponse};
use crate::services::media::source::normalize_source_path;
use crate::AppState;

use super::{
    parse_uuid, sources_to_json, to_book_container_output, to_book_container_outputs,
    CreateBookContainerInput, BookReorderInput, UpdateBookContainerInput,
};

/// GET /api/apps/book
pub async fn list_books(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<Vec<BookContainerOutput>>>, AppError> {
    let rows = BookRepo::list_containers(&state.db).await?;
    let outputs = to_book_container_outputs(&state.db, rows).await?;
    Ok(ok(outputs))
}

/// GET /api/apps/book/{id}
pub async fn get_book(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<BookContainerOutput>>, AppError> {
    let uid = parse_uuid(&id)?;
    let model = BookRepo::get_container_by_id(&state.db, uid)
        .await?
        .not_found(format!("book {id} not found"))?;
    let output = to_book_container_output(&state.db, model).await?;
    Ok(ok(output))
}

/// POST /api/apps/book
pub async fn create_book(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateBookContainerInput>,
) -> Result<Json<ApiResponse<BookContainerOutput>>, AppError> {
    let model =
        BookRepo::create_container(&state.db, body.name, body.r#type, body.settings).await?;
    let book_id = model.id;

    let mut needs_update = false;
    let mut update = crate::db::repos::book_repo::UpdateBookContainerFields {
        name: None,
        description: body.description.clone(),
        avatar: body.avatar.clone(),
        poster_path: None,
        scrape_enabled: body.scrape_enabled,
        scrape_agents: body.scrape_agents.clone(),
        settings: None,
        sources: None,
    };

    if body.avatar.is_some()
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
        BookRepo::update_container(&state.db, book_id, update).await?;
    }

    let model = BookRepo::get_container_by_id(&state.db, book_id)
        .await?
        .internal("failed to fetch created book")?;
    let output = to_book_container_output(&state.db, model).await?;
    Ok(ok(output))
}

/// PATCH /api/apps/book/{id}
pub async fn update_book(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<UpdateBookContainerInput>,
) -> Result<Json<ApiResponse<BookContainerOutput>>, AppError> {
    let uid = parse_uuid(&id)?;

    let _existing = BookRepo::get_container_by_id(&state.db, uid)
        .await?
        .not_found(format!("book {id} not found"))?;

    let mut update = crate::db::repos::book_repo::UpdateBookContainerFields {
        name: body.name,
        description: body.description,
        avatar: body.avatar,
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

    BookRepo::update_container(&state.db, uid, update).await?;

    let model = BookRepo::get_container_by_id(&state.db, uid)
        .await?
        .internal("failed to fetch updated book")?;
    let output = to_book_container_output(&state.db, model).await?;
    Ok(ok(output))
}

/// DELETE /api/apps/book/{id}
pub async fn delete_book(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let uid = parse_uuid(&id)?;
    BookRepo::delete_container(&state.db, uid).await?;
    Ok(ok_empty())
}

/// POST /api/apps/book/reorder
pub async fn reorder_books(
    State(state): State<Arc<AppState>>,
    Json(body): Json<BookReorderInput>,
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
    BookRepo::reorder_containers(&state.db, orders).await?;
    Ok(ok_empty())
}
