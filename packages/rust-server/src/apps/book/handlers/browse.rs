use std::path::Path as StdPath;
use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    response::Json,
};
use tracing::warn;
use uuid::Uuid;

use crate::db::repos::book_repo::BookRepo;
use crate::error::AppError;
use crate::error::OptionExt;
use crate::handlers::{ok, ApiResponse};
use crate::AppState;

use super::{
    chapter_to_output, ListBookItemsQuery, BookChapterContentOutput, BookChapterOutput,
    BookDetailOutput, BookFileOutput, BookVolumeOutput,
};

/// GET /api/apps/book/{id}/items
pub async fn list_book_items(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<ListBookItemsQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let book_id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid book id".into()))?;

    let page = q.page.unwrap_or(1);
    let page_size = q.page_size.unwrap_or(20);
    let sort_by = q.sort_by.as_deref().unwrap_or("title");
    let sort_dir = q.sort_dir.as_deref().unwrap_or("asc");
    let search = q.search.as_deref();

    let (items, total) =
        BookRepo::list_items(&state.db, book_id, page, page_size, sort_by, sort_dir, search)
            .await?;

    Ok(ok(serde_json::json!({
        "items": items,
        "total": total,
        "page": page,
        "pageSize": page_size,
    })))
}

/// GET /api/apps/book/item/{id}
pub async fn get_book_detail(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<BookDetailOutput>>, AppError> {
    let item_id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid book id".into()))?;
    let db = &state.db;

    let book = BookRepo::get_item_by_id(db, item_id)
        .await?
        .not_found(format!("Book {id} not found"))?;

    let volumes = BookRepo::get_volumes(db, item_id).await?;
    let all_chapters = BookRepo::get_chapters(db, item_id).await?;
    let files = BookRepo::get_book_files(db, item_id).await?;

    let volumes_output: Vec<BookVolumeOutput> = volumes
        .iter()
        .map(|v| {
            let vol_chapters: Vec<BookChapterOutput> = all_chapters
                .iter()
                .filter(|c| c.volume_id == Some(v.id))
                .map(chapter_to_output)
                .collect();
            BookVolumeOutput {
                id: v.id.to_string(),
                volume_number: v.volume_number,
                title: v.title.clone(),
                word_count: v.word_count,
                chapter_count: v.chapter_count,
                chapters: vol_chapters,
            }
        })
        .collect();

    let orphan_chapters: Vec<BookChapterOutput> = all_chapters
        .iter()
        .filter(|c| c.volume_id.is_none())
        .map(chapter_to_output)
        .collect();

    let files_output: Vec<BookFileOutput> = files
        .iter()
        .map(|f| BookFileOutput {
            id: f.id.to_string(),
            path: f.path.clone(),
            filename: f.filename.clone(),
            size: f.size,
            mime_type: f.mime_type.clone(),
        })
        .collect();

    let total_chapters = all_chapters.len();

    Ok(ok(BookDetailOutput {
        id: book.id.to_string(),
        book_id: book.book_id.to_string(),
        title: book.title,
        author: book.author,
        original_title: book.original_title,
        overview: book.overview,
        cover_path: book.cover_path,
        serial_status: book.serial_status,
        word_count: book.word_count,
        year: book.year,
        source_provider: book.source_provider,
        source_book_id: book.source_book_id,
        source_url: book.source_url,
        is_adult: book.is_adult,
        is_favorite: book.is_favorite,
        isbn: book.isbn,
        publisher: book.publisher,
        douban_rating: book.douban_rating,
        bangumi_rating: book.bangumi_rating,
        volumes: volumes_output,
        orphan_chapters,
        files: files_output,
        total_chapters,
        scraped_at: book.scraped_at.map(|d| d.to_rfc3339()),
        created_at: book.created_at.map(|d| d.to_rfc3339()),
        updated_at: book.updated_at.map(|d| d.to_rfc3339()),
    }))
}

/// GET /api/apps/book/item/{book_id}/chapters/{chapter_id}/content
pub async fn get_chapter_content(
    State(state): State<Arc<AppState>>,
    Path((book_id_str, chapter_id_str)): Path<(String, String)>,
) -> Result<Json<ApiResponse<BookChapterContentOutput>>, AppError> {
    let item_id: Uuid = book_id_str
        .parse()
        .map_err(|_| AppError::BadRequest("invalid book id".into()))?;
    let chapter_id: Uuid = chapter_id_str
        .parse()
        .map_err(|_| AppError::BadRequest("invalid chapter id".into()))?;
    let db = &state.db;

    let chapter = BookRepo::get_chapter_by_id(db, chapter_id)
        .await?
        .not_found("Chapter not found")?;

    if chapter.book_id != item_id {
        return Err(AppError::BadRequest(
            "Chapter does not belong to this book".into(),
        ));
    }

    let book = BookRepo::get_item_by_id(db, item_id)
        .await?
        .not_found("Book not found")?;

    // Resolve volume title
    let volume_title = match chapter.volume_id {
        Some(vol_id) => BookRepo::get_volume_by_id(db, vol_id)
            .await?
            .and_then(|v| v.title),
        None => None,
    };

    // Read file content from VFS
    let content = if chapter.is_vip {
        "VIP章节，内容暂不可用".to_string()
    } else {
        match chapter.file_path.as_deref() {
            Some(file_path) => read_chapter_file(&state, book.book_id, file_path).await,
            None => "章节内容未下载".to_string(),
        }
    };

    // Adjacent chapters
    let prev = BookRepo::get_prev_chapter(db, item_id, chapter.chapter_number).await?;
    let next = BookRepo::get_next_chapter(db, item_id, chapter.chapter_number).await?;

    Ok(ok(BookChapterContentOutput {
        id: chapter.id.to_string(),
        title: chapter.title,
        chapter_number: chapter.chapter_number,
        content,
        prev_chapter_id: prev.map(|c| c.id.to_string()),
        next_chapter_id: next.map(|c| c.id.to_string()),
        book_title: book.title,
        volume_title,
    }))
}

/// Read chapter file from VFS using the book container's source configuration.
async fn read_chapter_file(state: &AppState, book_id: Uuid, file_path: &str) -> String {
    let source = match BookRepo::get_book_source(&state.db, book_id).await {
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
