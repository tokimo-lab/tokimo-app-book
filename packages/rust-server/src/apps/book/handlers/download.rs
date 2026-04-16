use std::convert::Infallible;
use std::path::Path as StdPath;
use std::sync::Arc;

use async_stream::stream;
use axum::{
    extract::State,
    response::{
        Json,
        sse::{Event, KeepAlive, Sse},
    },
};
use bytes::Bytes;
use futures_util::StreamExt;
use futures_util::stream::Stream;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::AppState;
use crate::db::repos::book_repo::{BookRepo, CreateBookItemInput, InsertChapterInput, InsertVolumeInput};
use crate::error::AppError;
use crate::error::OptionExt;
use crate::handlers::{ApiResponse, ok};
use crate::services::storage::UploadOptions;

use super::{BookDownloadInput, BookInfoInput, BookProviderOutput, BookSearchInput, BookSearchResultOutput};

/// GET /api/apps/book/providers
pub async fn list_providers() -> Json<ApiResponse<Vec<BookProviderOutput>>> {
    let providers = novel_downloader::list_providers()
        .into_iter()
        .map(|p| BookProviderOutput {
            name: p.name,
            url: p.url,
            supports_search: p.supports_search,
        })
        .collect();
    ok(providers)
}

/// POST /api/apps/book/search — SSE stream of search results from all providers.
pub async fn search_books(Json(input): Json<BookSearchInput>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let s = stream! {
        let mut search = novel_downloader::search_stream(&input.keyword);
        while let Some(result) = search.next().await {
            let output = BookSearchResultOutput {
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

/// POST /api/apps/book/book-info — Get detailed book info from a provider.
pub async fn get_book_info(Json(input): Json<BookInfoInput>) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let info = novel_downloader::get_book_info(&input.provider, &input.book_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("Failed to get book info: {e}")))?;

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

/// POST /api/apps/book/download — SSE stream that downloads a book, writing
/// chapter files to the book VFS and persisting metadata in the database.
pub async fn download_book(
    State(state): State<Arc<AppState>>,
    Json(input): Json<BookDownloadInput>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let s = stream! {
        match do_download_book(state, input).await {
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
#[allow(clippy::too_many_lines)]
async fn do_download_book(state: Arc<AppState>, input: BookDownloadInput) -> Result<Vec<Event>, AppError> {
    let db = state.db.clone();
    let sources = Arc::clone(&state.sources);

    let book_container_id: Uuid = input
        .library_id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid library_id".into()))?;

    // Resolve book source from container
    let (source_id, root_path) = BookRepo::get_book_source(&db, book_container_id)
        .await?
        .bad_request("Book has no file system sources")?;

    let source_id_str = source_id.to_string();

    // Fetch book metadata
    let book_info = novel_downloader::get_book_info(&input.provider, &input.book_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("Failed to get book info: {e}")))?;

    let book_title = input.title.as_deref().unwrap_or(&book_info.book_name).to_string();
    let year = input.year;

    let folder_name = match year {
        Some(y) => format!("{book_title}（{y}）"),
        None => book_title.clone(),
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

    // Create book item record
    let book_item_id = Uuid::new_v4();

    BookRepo::create_item(
        &db,
        CreateBookItemInput {
            id: book_item_id,
            book_id: book_container_id,
            title: book_title.clone(),
            author: Some(book_info.author.clone()),
            overview: Some(book_info.summary.clone()),
            serial_status: Some(serial_status),
            word_count,
            year,
            source_provider: Some(input.provider.clone()),
            source_book_id: Some(input.book_id.clone()),
        },
    )
    .await?;

    // Download and upload cover image
    if !book_info.cover_url.is_empty() {
        match download_and_upload_cover(&state, book_item_id, &book_info.cover_url).await {
            Ok(cover_path) => {
                if let Err(e) = BookRepo::update_cover_path(&db, book_item_id, cover_path.clone()).await {
                    warn!("Failed to update book cover path: {e}");
                } else {
                    info!("Downloaded cover for book {}: {}", book_title, cover_path);
                }
            }
            Err(e) => {
                warn!("Failed to download book cover: {e}");
            }
        }
    }

    let total_chapters: usize = book_info.volumes.iter().map(|v| v.chapters.len()).sum();

    let mut events = Vec::new();
    events.push(
        Event::default().event("book_info").data(
            serde_json::to_string(&serde_json::json!({
                "bookId": book_item_id.to_string(),
                "title": &book_title,
                "author": &book_info.author,
                "totalChapters": total_chapters,
            }))
            .unwrap_or_default(),
        ),
    );

    // Create volumes
    let mut volume_map: std::collections::HashMap<String, Uuid> = std::collections::HashMap::new();
    for (vi, vol) in book_info.volumes.iter().enumerate() {
        let vol_id = Uuid::new_v4();
        BookRepo::insert_volume(
            &db,
            InsertVolumeInput {
                id: vol_id,
                book_id: book_item_id,
                volume_number: (vi + 1) as i32,
                title: Some(vol.volume_name.clone()),
                chapter_count: Some(vol.chapters.len() as i32),
            },
        )
        .await?;
        volume_map.insert(vol.volume_name.clone(), vol_id);
    }

    // Get VFS handle
    let vfs = sources
        .ensure_vfs(&source_id_str)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to get VFS: {e}")))?;

    // Build book directory path
    let book_dir = if root_path.ends_with('/') || root_path.is_empty() {
        format!("{root_path}{folder_name}")
    } else {
        format!("{root_path}/{folder_name}")
    };

    // Create directory (ignore error if already exists)
    let _ = vfs.mkdir(StdPath::new(&book_dir)).await;

    // Search alternative providers for VIP chapter fallback.
    events.push(
        Event::default().event("searching_alternatives").data(
            serde_json::to_string(&serde_json::json!({
                "title": &book_title,
                "provider": &input.provider,
            }))
            .unwrap_or_default(),
        ),
    );
    let alt_map = build_alt_chapter_map(&book_title, &book_info.author, &input.provider).await;
    let alt_chapter_count: usize = alt_map.values().map(std::vec::Vec::len).sum();
    if alt_chapter_count > 0 {
        events.push(
            Event::default().event("alt_sources_ready").data(
                serde_json::to_string(&serde_json::json!({
                    "mappedChapters": alt_chapter_count,
                }))
                .unwrap_or_default(),
            ),
        );
    }

    // Download chapters
    let mut download_stream = novel_downloader::download_stream(&input.provider, &input.book_id);
    let mut downloaded = 0usize;
    let mut rescued = 0usize;
    let mut _failed = 0usize;
    let mut vip_skipped = 0usize;
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

                if let Some(ref vol_name) = volume {
                    current_vol_id = volume_map.get(vol_name).copied();
                }

                // Detect VIP stub content — try alternative sources first
                if is_vip_stub(&content) {
                    let norm_title = normalize_for_matching(&title);
                    let alt = match alt_map.get(&norm_title) {
                        Some(alts) => try_alt_chapter(alts).await,
                        None => None,
                    };

                    if let Some((alt_content, alt_provider)) = alt {
                        let safe_title = sanitize_filename(&title);
                        let filename = format!("第{:03}章 {}.txt", ch_num + 1, safe_title);
                        let file_path = format!("{book_dir}/{filename}");
                        let word_cnt = alt_content.chars().count() as i32;
                        let content_bytes = alt_content.into_bytes();

                        match vfs.put(StdPath::new(&file_path), content_bytes).await {
                            Ok(()) => {
                                let ch_id = Uuid::new_v4();
                                let _ = BookRepo::insert_chapter(
                                    &db,
                                    InsertChapterInput {
                                        id: ch_id,
                                        book_id: book_item_id,
                                        volume_id: current_vol_id,
                                        chapter_number: ch_num,
                                        title: Some(title.clone()),
                                        word_count: Some(word_cnt),
                                        file_path: Some(file_path),
                                        is_vip: false,
                                    },
                                )
                                .await;
                                downloaded += 1;
                                rescued += 1;
                                events.push(
                                    Event::default().event("chapter").data(
                                        serde_json::to_string(&serde_json::json!({
                                            "index": index,
                                            "title": title,
                                            "downloaded": downloaded,
                                            "altSource": alt_provider,
                                        }))
                                        .unwrap_or_default(),
                                    ),
                                );
                                continue;
                            }
                            Err(e) => {
                                warn!("Failed to write alt chapter file: {e}");
                            }
                        }
                    }

                    // No alternative found — mark as VIP
                    let ch_id = Uuid::new_v4();
                    let _ = BookRepo::insert_chapter(
                        &db,
                        InsertChapterInput {
                            id: ch_id,
                            book_id: book_item_id,
                            volume_id: current_vol_id,
                            chapter_number: ch_num,
                            title: Some(title.clone()),
                            word_count: Some(0),
                            file_path: None,
                            is_vip: true,
                        },
                    )
                    .await;
                    vip_skipped += 1;
                    events.push(
                        Event::default().event("chapter_vip").data(
                            serde_json::to_string(&serde_json::json!({
                                "index": index,
                                "title": title,
                                "vipSkipped": vip_skipped,
                                "triedAlternatives": alt_map.contains_key(&norm_title),
                            }))
                            .unwrap_or_default(),
                        ),
                    );
                    continue;
                }

                let safe_title = sanitize_filename(&title);
                let filename = format!("第{:03}章 {}.txt", ch_num + 1, safe_title);
                let file_path = format!("{book_dir}/{filename}");

                let content_bytes = content.as_bytes().to_vec();
                let word_cnt = content.chars().count() as i32;

                match vfs.put(StdPath::new(&file_path), content_bytes).await {
                    Ok(()) => {
                        let ch_id = Uuid::new_v4();

                        let _ = BookRepo::insert_chapter(
                            &db,
                            InsertChapterInput {
                                id: ch_id,
                                book_id: book_item_id,
                                volume_id: current_vol_id,
                                chapter_number: ch_num,
                                title: Some(title.clone()),
                                word_count: Some(word_cnt),
                                file_path: Some(file_path),
                                is_vip: false,
                            },
                        )
                        .await;

                        downloaded += 1;
                        events.push(
                            Event::default().event("chapter").data(
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
            Ok(novel_downloader::DownloadEvent::ChapterError { index, title, error }) => {
                _failed += 1;
                events.push(
                    Event::default().event("chapter_error").data(
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
                    Event::default().event("done").data(
                        serde_json::to_string(&serde_json::json!({
                            "bookId": book_item_id.to_string(),
                            "downloaded": d,
                            "failed": f,
                            "vipSkipped": vip_skipped,
                            "rescued": rescued,
                        }))
                        .unwrap_or_default(),
                    ),
                );
            }
            Ok(novel_downloader::DownloadEvent::BookInfo { .. }) => {}
            Err(e) => {
                error!("Download stream error: {e}");
                events.push(Event::default().event("error").data(format!("{e}")));
            }
        }
    }

    Ok(events)
}

// ── Cover download ──────────────────────────────────────────────────────────

async fn download_and_upload_cover(state: &Arc<AppState>, book_id: Uuid, cover_url: &str) -> Result<String, AppError> {
    let resp = state
        .http_client
        .get(cover_url)
        .send()
        .await
        .map_err(|e| AppError::BadRequest(format!("Failed to fetch cover: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::BadRequest(format!("Cover HTTP {}", resp.status())));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::BadRequest(format!("Failed to read cover bytes: {e}")))?;

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

    let storage_key = format!("app-images/books/{book_id}/cover.{ext}");

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

fn is_vip_stub(content: &str) -> bool {
    let trimmed = content.trim();
    const VIP_PATTERNS: &[&str] = &[
        "[VIP章节，需要订阅]",
        "[VIP章节，需要购买后阅读]",
        "[VIP图片章节，需要登录并订阅]",
    ];
    if VIP_PATTERNS.contains(&trimmed) {
        return true;
    }
    if trimmed.len() < 80 && trimmed.starts_with("[VIP") {
        return true;
    }
    false
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

type AltChapterMap = std::collections::HashMap<String, Vec<(String, String, String)>>;

fn normalize_for_matching(s: &str) -> String {
    let s = s.trim();
    let body = if let Some(pos) = s.find('章') {
        let after = s[pos + '章'.len_utf8()..].trim();
        if after.is_empty() { s } else { after }
    } else {
        s
    };
    body.chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

async fn build_alt_chapter_map(title: &str, author: &str, primary_provider: &str) -> AltChapterMap {
    use tokio::time::Duration;

    let norm_title = normalize_for_matching(title);
    let norm_author = normalize_for_matching(author);

    let search_results: Vec<novel_downloader::SearchResult> = {
        let mut stream = novel_downloader::search_stream(title);
        let mut collected = Vec::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(8);
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                break;
            }
            match tokio::time::timeout(remaining, stream.next()).await {
                Ok(Some(r)) => collected.push(r),
                _ => break,
            }
        }
        collected
    };

    let mut seen = std::collections::HashSet::new();
    let candidates: Vec<_> = search_results
        .into_iter()
        .filter(|r| {
            r.site != primary_provider
                && normalize_for_matching(&r.title) == norm_title
                && {
                    let na = normalize_for_matching(&r.author);
                    na.contains(&norm_author) || norm_author.contains(&na)
                }
                && seen.insert((r.site.clone(), r.book_id.clone()))
        })
        .take(5)
        .collect();

    if candidates.is_empty() {
        return AltChapterMap::new();
    }

    let futures: Vec<_> = candidates
        .into_iter()
        .map(|r| {
            let provider = r.site.clone();
            let book_id = r.book_id.clone();
            async move {
                match tokio::time::timeout(
                    Duration::from_secs(10),
                    novel_downloader::get_book_info(&provider, &book_id),
                )
                .await
                {
                    Ok(Ok(info)) => Some((provider, book_id, info)),
                    _ => None,
                }
            }
        })
        .collect();

    let book_infos = futures_util::future::join_all(futures).await;

    let mut map = AltChapterMap::new();
    for (provider, book_id, info) in book_infos.into_iter().flatten() {
        for vol in &info.volumes {
            for ch in &vol.chapters {
                let norm = normalize_for_matching(&ch.title);
                if !norm.is_empty() {
                    map.entry(norm)
                        .or_default()
                        .push((provider.clone(), book_id.clone(), ch.chapter_id.clone()));
                }
            }
        }
    }
    map
}

async fn try_alt_chapter(alts: &[(String, String, String)]) -> Option<(String, String)> {
    for (provider_id, book_id, chapter_id) in alts {
        let result = tokio::time::timeout(
            tokio::time::Duration::from_secs(8),
            novel_downloader::get_chapter(provider_id, book_id, chapter_id),
        )
        .await;
        match result {
            Ok(Ok(ch)) if !is_vip_stub(&ch.content) && ch.content.len() > 80 => {
                return Some((ch.content, provider_id.clone()));
            }
            _ => {}
        }
    }
    None
}
