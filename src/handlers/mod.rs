pub mod browse;
pub mod crud;
pub mod download;
pub mod sync;

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::db::entities::vfs;
use crate::db::models::novel::{NovelContainerOutput, NovelSourceOutput};
use crate::db::repos::novel_repo::NovelRepo;
use crate::db::{ApiDateTimeExt, OptionalApiDateTimeExt};
use crate::error::AppError;

pub use browse::*;
pub use crud::*;
pub use download::*;
pub use sync::*;

// ── Container input DTOs ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNovelContainerInput {
    pub name: String,
    pub r#type: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub description: Option<String>,
    pub scrape_enabled: Option<bool>,
    pub scrape_agents: Option<Vec<String>>,
    pub settings: Option<serde_json::Value>,
    pub sources: Option<Vec<NovelSourceInput>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNovelContainerInput {
    pub name: Option<String>,
    pub r#type: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub description: Option<String>,
    pub scrape_enabled: Option<bool>,
    pub scrape_agents: Option<Vec<String>>,
    pub settings: Option<serde_json::Value>,
    pub sources: Option<Vec<NovelSourceInput>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelSourceInput {
    pub source_id: String,
    pub root_path: String,
    pub sort_order: i32,
    pub is_default_download: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelReorderInput {
    pub orders: Vec<NovelReorderItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelReorderItem {
    pub id: String,
    pub sort_order: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelSyncInput {
    pub clear_data: Option<bool>,
}

// ── Item-level DTOs (ts-rs exported) ──

#[derive(Debug, Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NovelOutput {
    pub id: String,
    pub novel_id: String,
    pub title: String,
    pub author: Option<String>,
    pub overview: Option<String>,
    pub cover_path: Option<String>,
    pub serial_status: Option<String>,
    #[ts(type = "number | null")]
    pub word_count: Option<i32>,
    #[ts(type = "number | null")]
    pub year: Option<i32>,
    pub source_provider: Option<String>,
    pub is_favorite: bool,
    #[ts(type = "number | null")]
    pub chapter_count: Option<i64>,
    #[ts(type = "number | null")]
    pub volume_count: Option<i64>,
    pub scraped_at: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NovelDetailOutput {
    pub id: String,
    pub novel_id: String,
    pub title: String,
    pub author: Option<String>,
    pub original_title: Option<String>,
    pub overview: Option<String>,
    pub cover_path: Option<String>,
    pub serial_status: Option<String>,
    #[ts(type = "number | null")]
    pub word_count: Option<i32>,
    #[ts(type = "number | null")]
    pub year: Option<i32>,
    pub source_provider: Option<String>,
    pub source_book_id: Option<String>,
    pub source_url: Option<String>,
    pub is_adult: bool,
    pub is_favorite: bool,
    pub isbn: Option<String>,
    pub publisher: Option<String>,
    #[ts(type = "number | null")]
    pub douban_rating: Option<f64>,
    #[ts(type = "number | null")]
    pub bangumi_rating: Option<f64>,
    pub volumes: Vec<NovelVolumeOutput>,
    pub orphan_chapters: Vec<NovelChapterOutput>,
    pub files: Vec<NovelFileOutput>,
    #[ts(type = "number")]
    pub total_chapters: usize,
    pub scraped_at: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NovelVolumeOutput {
    pub id: String,
    #[ts(type = "number")]
    pub volume_number: i32,
    pub title: Option<String>,
    #[ts(type = "number | null")]
    pub word_count: Option<i32>,
    #[ts(type = "number | null")]
    pub chapter_count: Option<i32>,
    pub chapters: Vec<NovelChapterOutput>,
}

#[derive(Debug, Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NovelChapterOutput {
    pub id: String,
    #[ts(type = "number")]
    pub chapter_number: i32,
    pub title: Option<String>,
    #[ts(type = "number | null")]
    pub word_count: Option<i32>,
    pub volume_id: Option<String>,
    pub is_vip: bool,
}

#[derive(Debug, Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NovelFileOutput {
    pub id: String,
    pub path: String,
    pub filename: String,
    #[ts(type = "number | null")]
    pub size: Option<i64>,
    pub mime_type: Option<String>,
}

#[derive(Debug, Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NovelChapterContentOutput {
    pub id: String,
    pub title: Option<String>,
    #[ts(type = "number")]
    pub chapter_number: i32,
    pub content: String,
    pub prev_chapter_id: Option<String>,
    pub next_chapter_id: Option<String>,
    pub novel_title: String,
    pub volume_title: Option<String>,
}

#[derive(Debug, Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NovelProviderOutput {
    pub name: String,
    pub url: String,
    pub supports_search: bool,
}

#[derive(Debug, Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NovelSearchResultOutput {
    pub site: String,
    pub book_id: String,
    pub title: String,
    pub author: String,
    pub latest_chapter: String,
    pub update_date: String,
    pub word_count: String,
}

// ── Item-level request types ──

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelSearchInput {
    pub keyword: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelBookInfoInput {
    pub provider: String,
    pub book_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelDownloadInput {
    pub provider: String,
    pub book_id: String,
    pub novel_id: String,
    pub title: Option<String>,
    pub year: Option<i32>,
}

#[derive(Deserialize)]
pub struct ListNovelItemsQuery {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub sort_by: Option<String>,
    pub sort_dir: Option<String>,
    pub search: Option<String>,
}

// ── Shared helpers ──

pub(crate) fn parse_uuid(s: &str) -> Result<Uuid, AppError> {
    s.parse::<Uuid>()
        .map_err(|_| AppError::BadRequest(format!("invalid uuid: {s}")))
}

/// Build sources JSON from input.
pub(crate) fn sources_to_json(sources: &[NovelSourceInput]) -> serde_json::Value {
    serde_json::json!(
        sources
            .iter()
            .enumerate()
            .map(|(i, s)| {
                serde_json::json!({
                    "sourceId": s.source_id,
                    "rootPath": s.root_path,
                    "sortOrder": s.sort_order.max(i as i32),
                    "isDefaultDownload": s.is_default_download.unwrap_or(false),
                })
            })
            .collect::<Vec<_>>()
    )
}

/// Convert a `novels::Model` (container) into a `NovelContainerOutput` DTO.
pub(crate) async fn to_novel_container_output(
    db: &sea_orm::DatabaseConnection,
    model: crate::db::entities::novels::Model,
) -> Result<NovelContainerOutput, AppError> {
    use crate::db::entities::novel_items;
    use sea_orm::{ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter};

    let novel_id = model.id;

    let source_tuples = NovelRepo::parse_sources(&model.sources);
    let mut sources = Vec::with_capacity(source_tuples.len());
    for (source_id, root_path, is_default_download) in &source_tuples {
        let fs = vfs::Entity::find_by_id(*source_id).one(db).await?;
        sources.push(NovelSourceOutput {
            source_id: source_id.to_string(),
            root_path: root_path.clone(),
            sort_order: sources.len() as i32,
            is_default_download: *is_default_download,
            source_name: fs.as_ref().map(|f| f.name.clone()),
            source_type: fs.as_ref().map(|f| f.r#type.clone()),
        });
    }

    let item_count = novel_items::Entity::find()
        .filter(novel_items::Column::NovelId.eq(novel_id))
        .count(db)
        .await? as i64;

    Ok(NovelContainerOutput {
        id: model.id.to_string(),
        name: model.name,
        r#type: model.r#type,
        icon: model.icon,
        color: model.color,
        description: model.description,
        poster_path: model.poster_path,
        scrape_enabled: model.scrape_enabled,
        scrape_agents: Some(model.scrape_agents),
        sort_order: model.sort_order,
        settings: model.settings,
        sync_status: model.sync_status,
        last_sync_at: model.last_sync_at.to_api_datetime(),
        item_count,
        sources,
        created_at: model.created_at.to_api_datetime_or_default(),
        updated_at: model.updated_at.to_api_datetime_or_default(),
    })
}

/// Build `NovelContainerOutput` for a list of models.
pub(crate) async fn to_novel_container_outputs(
    db: &sea_orm::DatabaseConnection,
    models: Vec<crate::db::entities::novels::Model>,
) -> Result<Vec<NovelContainerOutput>, AppError> {
    let mut outputs = Vec::with_capacity(models.len());
    for model in models {
        outputs.push(to_novel_container_output(db, model).await?);
    }
    Ok(outputs)
}

pub(crate) fn chapter_to_output(
    c: &crate::db::entities::novel_chapters::Model,
) -> NovelChapterOutput {
    NovelChapterOutput {
        id: c.id.to_string(),
        chapter_number: c.chapter_number,
        title: c.title.clone(),
        word_count: c.word_count,
        volume_id: c.volume_id.map(|v| v.to_string()),
        is_vip: c.is_vip,
    }
}
