use std::path::Path as StdPath;
use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    response::Json,
};
use tracing::warn;
use uuid::Uuid;

use crate::db::repos::novel_repo::NovelRepo;
use crate::error::AppError;
use crate::error::OptionExt;
use crate::handlers::{ok, ApiResponse};
use crate::AppState;

use super::{
    chapter_to_output, ListNovelItemsQuery, NovelChapterContentOutput, NovelChapterOutput,
    NovelDetailOutput, NovelFileOutput, NovelVolumeOutput,
};

/// GET /api/apps/novel/{id}/items
pub async fn list_novel_items(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<ListNovelItemsQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let novel_id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid novel id".into()))?;

    let page = q.page.unwrap_or(1);
    let page_size = q.page_size.unwrap_or(20);
    let sort_by = q.sort_by.as_deref().unwrap_or("title");
    let sort_dir = q.sort_dir.as_deref().unwrap_or("asc");
    let search = q.search.as_deref();

    let (items, total) =
        NovelRepo::list_items(&state.db, novel_id, page, page_size, sort_by, sort_dir, search)
            .await?;

    Ok(ok(serde_json::json!({
        "items": items,
        "total": total,
        "page": page,
        "pageSize": page_size,
    })))
}

/// GET /api/apps/novel/item/{id}
pub async fn get_novel_detail(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<NovelDetailOutput>>, AppError> {
    let item_id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid novel id".into()))?;
    let db = &state.db;

    let novel = NovelRepo::get_item_by_id(db, item_id)
        .await?
        .not_found(format!("Novel {id} not found"))?;

    let volumes = NovelRepo::get_volumes(db, item_id).await?;
    let all_chapters = NovelRepo::get_chapters(db, item_id).await?;
    let files = NovelRepo::get_novel_files(db, item_id).await?;

    let volumes_output: Vec<NovelVolumeOutput> = volumes
        .iter()
        .map(|v| {
            let vol_chapters: Vec<NovelChapterOutput> = all_chapters
                .iter()
                .filter(|c| c.volume_id == Some(v.id))
                .map(chapter_to_output)
                .collect();
            NovelVolumeOutput {
                id: v.id.to_string(),
                volume_number: v.volume_number,
                title: v.title.clone(),
                word_count: v.word_count,
                chapter_count: v.chapter_count,
                chapters: vol_chapters,
            }
        })
        .collect();

    let orphan_chapters: Vec<NovelChapterOutput> = all_chapters
        .iter()
        .filter(|c| c.volume_id.is_none())
        .map(chapter_to_output)
        .collect();

    let files_output: Vec<NovelFileOutput> = files
        .iter()
        .map(|f| NovelFileOutput {
            id: f.id.to_string(),
            path: f.path.clone(),
            filename: f.filename.clone(),
            size: f.size,
            mime_type: f.mime_type.clone(),
        })
        .collect();

    let total_chapters = all_chapters.len();

    Ok(ok(NovelDetailOutput {
        id: novel.id.to_string(),
        novel_id: novel.novel_id.to_string(),
        title: novel.title,
        author: novel.author,
        original_title: novel.original_title,
        overview: novel.overview,
        cover_path: novel.cover_path,
        serial_status: novel.serial_status,
        word_count: novel.word_count,
        year: novel.year,
        source_provider: novel.source_provider,
        source_book_id: novel.source_book_id,
        source_url: novel.source_url,
        is_adult: novel.is_adult,
        is_favorite: novel.is_favorite,
        isbn: novel.isbn,
        publisher: novel.publisher,
        douban_rating: novel.douban_rating,
        bangumi_rating: novel.bangumi_rating,
        volumes: volumes_output,
        orphan_chapters,
        files: files_output,
        total_chapters,
        scraped_at: novel.scraped_at.map(|d| d.to_rfc3339()),
        created_at: novel.created_at.map(|d| d.to_rfc3339()),
        updated_at: novel.updated_at.map(|d| d.to_rfc3339()),
    }))
}

/// GET /api/apps/novel/item/{novel_id}/chapters/{chapter_id}/content
pub async fn get_chapter_content(
    State(state): State<Arc<AppState>>,
    Path((novel_id_str, chapter_id_str)): Path<(String, String)>,
) -> Result<Json<ApiResponse<NovelChapterContentOutput>>, AppError> {
    let item_id: Uuid = novel_id_str
        .parse()
        .map_err(|_| AppError::BadRequest("invalid novel id".into()))?;
    let chapter_id: Uuid = chapter_id_str
        .parse()
        .map_err(|_| AppError::BadRequest("invalid chapter id".into()))?;
    let db = &state.db;

    let chapter = NovelRepo::get_chapter_by_id(db, chapter_id)
        .await?
        .not_found("Chapter not found")?;

    if chapter.novel_id != item_id {
        return Err(AppError::BadRequest(
            "Chapter does not belong to this novel".into(),
        ));
    }

    let novel = NovelRepo::get_item_by_id(db, item_id)
        .await?
        .not_found("Novel not found")?;

    // Resolve volume title
    let volume_title = match chapter.volume_id {
        Some(vol_id) => NovelRepo::get_volume_by_id(db, vol_id)
            .await?
            .and_then(|v| v.title),
        None => None,
    };

    // Read file content from VFS
    let content = if chapter.is_vip {
        "VIP章节，内容暂不可用".to_string()
    } else {
        match chapter.file_path.as_deref() {
            Some(file_path) => read_chapter_file(&state, novel.novel_id, file_path).await,
            None => "章节内容未下载".to_string(),
        }
    };

    // Adjacent chapters
    let prev = NovelRepo::get_prev_chapter(db, item_id, chapter.chapter_number).await?;
    let next = NovelRepo::get_next_chapter(db, item_id, chapter.chapter_number).await?;

    Ok(ok(NovelChapterContentOutput {
        id: chapter.id.to_string(),
        title: chapter.title,
        chapter_number: chapter.chapter_number,
        content,
        prev_chapter_id: prev.map(|c| c.id.to_string()),
        next_chapter_id: next.map(|c| c.id.to_string()),
        novel_title: novel.title,
        volume_title,
    }))
}

/// Read chapter file from VFS using the novel container's source configuration.
async fn read_chapter_file(state: &AppState, novel_id: Uuid, file_path: &str) -> String {
    let source = match NovelRepo::get_novel_source(&state.db, novel_id).await {
        Ok(Some(s)) => s,
        Ok(None) => return "章节文件源不可用".to_string(),
        Err(e) => return format!("查询文件源失败: {e}"),
    };

    let vfs = match state.sources.ensure_vfs(&source.0.to_string()).await {
        Ok(v) => v,
        Err(e) => {
            warn!("Failed to get VFS for source {}: {e}", source.0);
            return format!("无法连接文件系统: {e}");
        }
    };

    match vfs.read_bytes(StdPath::new(file_path), 0, None).await {
        Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
        Err(e) => {
            warn!("Failed to read chapter file {file_path}: {e}");
            format!("无法读取章节内容: {e}")
        }
    }
}
