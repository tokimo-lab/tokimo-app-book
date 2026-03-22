use std::convert::Infallible;
use std::path::Path as StdPath;
use std::sync::Arc;

use async_stream::stream;
use axum::{
    extract::{Path, Query, State},
    response::{
        sse::{Event, KeepAlive, Sse},
        Json,
    },
};
use futures_util::stream::Stream;
use futures_util::StreamExt;
use sea_orm::*;
use serde::{Deserialize, Serialize};
use tracing::{error, warn};
use ts_rs::TS;
use uuid::Uuid;

use bytes::Bytes;
use tracing::info;

use crate::db::entities::{novel_chapters, novel_volumes, novels};
use crate::db::repos::novel_repo::NovelRepo;
use crate::error::AppError;
use crate::handlers::{ok, ApiResponse};
use crate::services::storage::UploadOptions;
use crate::AppState;

// ── DTOs (ts-rs exported) ───────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NovelOutput {
    pub id: String,
    pub library_id: String,
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
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NovelDetailOutput {
    pub id: String,
    pub library_id: String,
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

// ── Request types ───────────────────────────────────────────────────────────

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
    pub library_id: String,
    pub title: Option<String>,
    pub year: Option<i32>,
}

#[derive(Deserialize)]
pub struct ListNovelsQuery {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub sort_by: Option<String>,
    pub sort_dir: Option<String>,
    pub search: Option<String>,
}

// ── Handlers ────────────────────────────────────────────────────────────────

/// GET /api/novel/providers
pub async fn list_providers() -> Json<ApiResponse<Vec<NovelProviderOutput>>> {
    let providers = novel_downloader::list_providers()
        .into_iter()
        .map(|p| NovelProviderOutput {
            name: p.name,
            url: p.url,
            supports_search: p.supports_search,
        })
        .collect();
    ok(providers)
}

/// POST /api/novel/search — SSE stream of search results from all providers.
pub async fn search_novels(
    Json(input): Json<NovelSearchInput>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let s = stream! {
        let mut search = novel_downloader::search_stream(&input.keyword);
        while let Some(result) = search.next().await {
            let output = NovelSearchResultOutput {
                site: result.site,
                book_id: result.book_id,
                title: result.title,
                author: result.author,
                latest_chapter: result.latest_chapter,
                update_date: result.update_date,
                word_count: result.word_count,
            };
            if let Ok(data) = serde_json::to_string(&output) {
                yield Ok::<_, Infallible>(Event::default().event("result").data(data));
            }
        }
        yield Ok(Event::default().event("done").data("{}"));
    };
    Sse::new(s).keep_alive(KeepAlive::default())
}

/// POST /api/novel/book-info — Get detailed book info from a provider.
pub async fn get_book_info(
    Json(input): Json<NovelBookInfoInput>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let info = novel_downloader::get_book_info(&input.provider, &input.book_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to get book info: {e}")))?;

    Ok(ok(serde_json::json!({
        "bookName": info.book_name,
        "author": info.author,
        "summary": info.summary,
        "coverUrl": info.cover_url,
        "updateTime": info.update_time,
        "wordCount": info.word_count,
        "serialStatus": info.serial_status,
        "volumes": info.volumes.iter().map(|v| serde_json::json!({
            "volumeName": v.volume_name,
            "chapterCount": v.chapters.len(),
            "chapters": v.chapters.iter().map(|c| serde_json::json!({
                "title": c.title,
                "chapterId": c.chapter_id,
            })).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
        "totalChapters": info.volumes.iter().map(|v| v.chapters.len()).sum::<usize>(),
    })))
}

/// POST /api/novel/download — SSE stream that downloads a novel, writing
/// chapter files to the library VFS and persisting metadata in the database.
pub async fn download_novel(
    State(state): State<Arc<AppState>>,
    Json(input): Json<NovelDownloadInput>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let s = stream! {
        match do_download_novel(state, input).await {
            Ok(events) => {
                for ev in events {
                    yield Ok::<_, Infallible>(ev);
                }
            }
            Err(e) => {
                yield Ok(Event::default().event("error").data(format!("{e}")));
            }
        }
    };
    Sse::new(s).keep_alive(KeepAlive::default())
}

/// Core download logic. Returns collected events to be streamed to the client.
async fn do_download_novel(
    state: Arc<AppState>,
    input: NovelDownloadInput,
) -> Result<Vec<Event>, AppError> {
    let db = state.db.clone();
    let sources = Arc::clone(&state.sources);

    let library_id: Uuid = input
        .library_id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid library_id".into()))?;

    // Resolve library file system source
    let lib_source = NovelRepo::get_library_source(&db, library_id)
        .await?
        .ok_or_else(|| AppError::BadRequest("Library has no file system sources".into()))?;

    let source_id = lib_source.source_id.to_string();
    let root_path = lib_source.root_path.clone();

    // Fetch book metadata
    let book_info = novel_downloader::get_book_info(&input.provider, &input.book_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to get book info: {e}")))?;

    let novel_title = input
        .title
        .as_deref()
        .unwrap_or(&book_info.book_name)
        .to_string();
    let year = input.year;

    let folder_name = match year {
        Some(y) => format!("{novel_title}（{y}）"),
        None => novel_title.clone(),
    };

    let serial_status = normalize_serial_status(&book_info.serial_status);

    let word_count: Option<i32> = book_info
        .word_count
        .replace(['万', '字', ',', ' '], "")
        .parse::<f64>()
        .ok()
        .map(|v| {
            if book_info.word_count.contains('万') {
                (v * 10000.0) as i32
            } else {
                v as i32
            }
        });

    // Create Novel record
    let novel_id = Uuid::new_v4();
    let now = chrono::Utc::now().fixed_offset();

    let novel = novels::ActiveModel {
        id: Set(novel_id),
        library_id: Set(library_id),
        title: Set(novel_title.clone()),
        author: Set(Some(book_info.author.clone())),
        overview: Set(Some(book_info.summary.clone())),
        serial_status: Set(Some(serial_status)),
        word_count: Set(word_count),
        year: Set(year),
        source_provider: Set(Some(input.provider.clone())),
        source_book_id: Set(Some(input.book_id.clone())),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        ..Default::default()
    };
    novels::Entity::insert(novel).exec(&db).await?;

    // Download and upload cover image
    if !book_info.cover_url.is_empty() {
        match download_and_upload_cover(&state, novel_id, &book_info.cover_url).await {
            Ok(cover_path) => {
                let mut active: novels::ActiveModel = novels::Entity::find_by_id(novel_id)
                    .one(&db)
                    .await?
                    .unwrap()
                    .into();
                active.cover_path = Set(Some(cover_path.clone()));
                active.update(&db).await?;
                info!("Downloaded cover for novel {}: {}", novel_title, cover_path);
            }
            Err(e) => {
                warn!("Failed to download novel cover: {e}");
            }
        }
    }

    let total_chapters: usize = book_info.volumes.iter().map(|v| v.chapters.len()).sum();

    let mut events = Vec::new();
    events.push(
        Event::default()
            .event("book_info")
            .data(
                serde_json::to_string(&serde_json::json!({
                    "novelId": novel_id.to_string(),
                    "title": &novel_title,
                    "author": &book_info.author,
                    "totalChapters": total_chapters,
                }))
                .unwrap_or_default(),
            ),
    );

    // Create volumes
    let mut volume_map: std::collections::HashMap<String, Uuid> =
        std::collections::HashMap::new();
    for (vi, vol) in book_info.volumes.iter().enumerate() {
        let vol_id = Uuid::new_v4();
        let vol_model = novel_volumes::ActiveModel {
            id: Set(vol_id),
            novel_id: Set(novel_id),
            volume_number: Set((vi + 1) as i32),
            title: Set(Some(vol.volume_name.clone())),
            chapter_count: Set(Some(vol.chapters.len() as i32)),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            ..Default::default()
        };
        novel_volumes::Entity::insert(vol_model).exec(&db).await?;
        volume_map.insert(vol.volume_name.clone(), vol_id);
    }

    // Get VFS handle
    let vfs = sources
        .ensure_vfs(&source_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to get VFS: {e}")))?;

    // Build novel directory path
    let novel_dir = if root_path.ends_with('/') || root_path.is_empty() {
        format!("{root_path}{folder_name}")
    } else {
        format!("{root_path}/{folder_name}")
    };

    // Create directory (ignore error if already exists)
    let _ = vfs.mkdir(StdPath::new(&novel_dir)).await;

    // Download chapters
    let mut download_stream = novel_downloader::download_stream(&input.provider, &input.book_id);
    let mut downloaded = 0usize;
    let mut _failed = 0usize;
    let mut current_vol_id: Option<Uuid> = None;

    while let Some(event) = download_stream.next().await {
        match event {
            Ok(novel_downloader::DownloadEvent::Chapter {
                index,
                volume,
                title,
                content,
            }) => {
                let ch_num = index as i32;
                let safe_title = sanitize_filename(&title);
                let filename = format!("第{:03}章 {}.txt", ch_num + 1, safe_title);
                let file_path = format!("{novel_dir}/{filename}");

                let content_bytes = content.as_bytes().to_vec();
                let word_cnt = content.chars().count() as i32;

                // Update current volume when a new volume header appears
                if let Some(ref vol_name) = volume {
                    current_vol_id = volume_map.get(vol_name).copied();
                }

                match vfs.put(StdPath::new(&file_path), content_bytes).await {
                    Ok(_) => {
                        let ch_id = Uuid::new_v4();

                        let chapter = novel_chapters::ActiveModel {
                            id: Set(ch_id),
                            novel_id: Set(novel_id),
                            volume_id: Set(current_vol_id),
                            chapter_number: Set(ch_num),
                            title: Set(Some(title.clone())),
                            word_count: Set(Some(word_cnt)),
                            file_path: Set(Some(file_path)),
                            created_at: Set(Some(now)),
                            updated_at: Set(Some(now)),
                            ..Default::default()
                        };
                        let _ = novel_chapters::Entity::insert(chapter).exec(&db).await;

                        downloaded += 1;
                        events.push(
                            Event::default()
                                .event("chapter")
                                .data(
                                    serde_json::to_string(&serde_json::json!({
                                        "index": index,
                                        "title": title,
                                        "downloaded": downloaded,
                                    }))
                                    .unwrap_or_default(),
                                ),
                        );
                    }
                    Err(e) => {
                        warn!("Failed to write chapter file {file_path}: {e}");
                        _failed += 1;
                    }
                }
            }
            Ok(novel_downloader::DownloadEvent::ChapterError {
                index,
                title,
                error,
            }) => {
                _failed += 1;
                events.push(
                    Event::default()
                        .event("chapter_error")
                        .data(
                            serde_json::to_string(&serde_json::json!({
                                "index": index,
                                "title": title,
                                "error": error,
                            }))
                            .unwrap_or_default(),
                        ),
                );
            }
            Ok(novel_downloader::DownloadEvent::Done {
                downloaded: d,
                failed: f,
            }) => {
                events.push(
                    Event::default()
                        .event("done")
                        .data(
                            serde_json::to_string(&serde_json::json!({
                                "novelId": novel_id.to_string(),
                                "downloaded": d,
                                "failed": f,
                            }))
                            .unwrap_or_default(),
                        ),
                );
            }
            Ok(novel_downloader::DownloadEvent::BookInfo { .. }) => {
                // Already handled above from get_book_info
            }
            Err(e) => {
                error!("Download stream error: {e}");
                events.push(Event::default().event("error").data(format!("{e}")));
            }
        }
    }

    Ok(events)
}

// ── Library novel listing ───────────────────────────────────────────────────

/// GET /api/media-libraries/{id}/novels
pub async fn list_novels(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<ListNovelsQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let library_id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid library id".into()))?;

    let page = q.page.unwrap_or(1);
    let page_size = q.page_size.unwrap_or(20);
    let sort_by = q.sort_by.as_deref().unwrap_or("title");
    let sort_dir = q.sort_dir.as_deref().unwrap_or("asc");
    let search = q.search.as_deref();

    let (items, total) =
        NovelRepo::list_novels(&state.db, library_id, page, page_size, sort_by, sort_dir, search)
            .await?;

    Ok(ok(serde_json::json!({
        "items": items,
        "total": total,
        "page": page,
        "pageSize": page_size,
    })))
}

// ── Novel detail ────────────────────────────────────────────────────────────

/// GET /api/media-libraries/novel/{id}
pub async fn get_novel_detail(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<NovelDetailOutput>>, AppError> {
    let novel_id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid novel id".into()))?;
    let db = &state.db;

    let novel = NovelRepo::get_by_id(db, novel_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Novel {id} not found")))?;

    let volumes = NovelRepo::get_volumes(db, novel_id).await?;
    let all_chapters = NovelRepo::get_chapters(db, novel_id).await?;
    let files = NovelRepo::get_novel_files(db, novel_id).await?;

    // Group chapters by volume
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
        library_id: novel.library_id.to_string(),
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
        created_at: novel.created_at.map(|d| d.to_rfc3339()),
        updated_at: novel.updated_at.map(|d| d.to_rfc3339()),
    }))
}

// ── Chapter content ─────────────────────────────────────────────────────────

/// GET /api/novels/{novel_id}/chapters/{chapter_id}/content
pub async fn get_chapter_content(
    State(state): State<Arc<AppState>>,
    Path((novel_id_str, chapter_id_str)): Path<(String, String)>,
) -> Result<Json<ApiResponse<NovelChapterContentOutput>>, AppError> {
    let novel_id: Uuid = novel_id_str
        .parse()
        .map_err(|_| AppError::BadRequest("invalid novel id".into()))?;
    let chapter_id: Uuid = chapter_id_str
        .parse()
        .map_err(|_| AppError::BadRequest("invalid chapter id".into()))?;
    let db = &state.db;

    let chapter = NovelRepo::get_chapter_by_id(db, chapter_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Chapter not found".into()))?;

    if chapter.novel_id != novel_id {
        return Err(AppError::BadRequest(
            "Chapter does not belong to this novel".into(),
        ));
    }

    let novel = NovelRepo::get_by_id(db, novel_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Novel not found".into()))?;

    // Resolve volume title
    let volume_title = match chapter.volume_id {
        Some(vol_id) => {
            novel_volumes::Entity::find_by_id(vol_id)
                .one(db)
                .await?
                .and_then(|v| v.title)
        }
        None => None,
    };

    // Read file content from VFS
    let content = match chapter.file_path.as_deref() {
        Some(file_path) => {
            read_chapter_file(&state, novel.library_id, file_path).await
        }
        None => "章节内容未下载".to_string(),
    };

    // Adjacent chapters
    let prev = NovelRepo::get_prev_chapter(db, novel_id, chapter.chapter_number).await?;
    let next = NovelRepo::get_next_chapter(db, novel_id, chapter.chapter_number).await?;

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

// ── Cover download ──────────────────────────────────────────────────────────

async fn download_and_upload_cover(
    state: &Arc<AppState>,
    novel_id: Uuid,
    cover_url: &str,
) -> Result<String, AppError> {
    let resp = state
        .http_client
        .get(cover_url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to fetch cover: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Internal(format!(
            "Cover HTTP {}",
            resp.status()
        )));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read cover bytes: {e}")))?;

    let ext = cover_url
        .rsplit('.')
        .next()
        .and_then(|e| {
            let lower = e.split('?').next().unwrap_or(e).to_ascii_lowercase();
            if matches!(lower.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif") {
                Some(lower)
            } else {
                None
            }
        })
        .unwrap_or_else(|| "jpg".to_string());

    let mime = match ext.as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/jpeg",
    };

    let storage_key = format!("library-images/novels/{novel_id}/cover.{ext}");

    state
        .storage
        .upload(
            &storage_key,
            Bytes::from(bytes.to_vec()),
            Some(UploadOptions {
                content_type: Some(mime.to_string()),
            }),
        )
        .await
        .map_err(|e| AppError::Internal(format!("Storage upload failed: {e}")))?;

    Ok(format!("/storage/{storage_key}"))
}

// ── Helpers ─────────────────────────────────────────────────────────────────

fn chapter_to_output(c: &novel_chapters::Model) -> NovelChapterOutput {
    NovelChapterOutput {
        id: c.id.to_string(),
        chapter_number: c.chapter_number,
        title: c.title.clone(),
        word_count: c.word_count,
        volume_id: c.volume_id.map(|v| v.to_string()),
    }
}

async fn read_chapter_file(state: &AppState, library_id: Uuid, file_path: &str) -> String {
    let lib_source = match NovelRepo::get_library_source(&state.db, library_id).await {
        Ok(Some(ls)) => ls,
        Ok(None) => return "章节文件源不可用".to_string(),
        Err(e) => return format!("查询文件源失败: {e}"),
    };

    let source_id = lib_source.source_id.to_string();
    let vfs = match state.sources.ensure_vfs(&source_id).await {
        Ok(v) => v,
        Err(e) => {
            warn!("Failed to get VFS for source {source_id}: {e}");
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

fn normalize_serial_status(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("完结") || lower.contains("完本") || lower.contains("completed") {
        "completed".to_string()
    } else if lower.contains("连载") || lower.contains("ongoing") {
        "ongoing".to_string()
    } else if lower.contains("暂停") || lower.contains("停更") || lower.contains("hiatus") {
        "hiatus".to_string()
    } else {
        "unknown".to_string()
    }
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}
