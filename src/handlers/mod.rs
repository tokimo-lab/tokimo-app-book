//! Book sidecar handlers.

use std::{convert::Infallible, path::Path as StdPath, sync::Arc};

use async_stream::stream;
use axum::{
    Json,
    extract::{Path, Query, State},
    response::sse::{Event, KeepAlive, Sse},
};
use futures_util::{Stream, StreamExt};
use regex::Regex;
use sea_orm::TransactionTrait;
use serde::{Deserialize, Serialize};
use tokimo_vfs::{DriverRegistry, StorageManager, StorageMount, Vfs};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::{
    bus_clients,
    ctx::AppCtx,
    db::{
        entities::{containers, items},
        repos::{
            book_sync_status_repo::BookSyncStatusRepo,
            chapters_repo::{ChaptersRepo, CreateChapterParams},
            containers_repo::ContainersRepo,
            download_tasks_repo::{DownloadTasksRepo, InsertDownloadTaskParams},
            items_repo::{CreateItemParams, ItemsRepo, UpdateItemParams},
        },
    },
    error::AppError,
    services::scrape::scrape_book_file,
};

#[derive(Serialize)]
pub struct ApiResponse<T> {
    success: bool,
    data: T,
}

fn ok<T>(data: T) -> Json<ApiResponse<T>> {
    Json(ApiResponse { success: true, data })
}

#[derive(Debug, Deserialize)]
pub struct ListBooksQuery {
    #[allow(dead_code)]
    user_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct ListItemsQuery {
    page: Option<u64>,
    page_size: Option<u64>,
    #[serde(rename = "pageSize")]
    page_size_camel: Option<u64>,
    search: Option<String>,
}

impl ListItemsQuery {
    fn page(&self) -> u64 {
        self.page.unwrap_or(1).max(1)
    }

    fn page_size(&self) -> u64 {
        self.page_size.or(self.page_size_camel).unwrap_or(20).clamp(1, 200)
    }
}

pub async fn list_books(
    State(ctx): State<Arc<AppCtx>>,
    Query(_q): Query<ListBooksQuery>,
) -> Result<Json<ApiResponse<Vec<containers::Model>>>, AppError> {
    Ok(ok(ContainersRepo::list_all(&ctx.db).await?))
}

pub async fn get_book(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<containers::Model>>, AppError> {
    let container = ContainersRepo::get_by_id(&ctx.db, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("container {id} not found")))?;
    Ok(ok(container))
}

#[derive(Debug, Deserialize)]
pub struct CreateBookRequest {
    container_id: Uuid,
    title: String,
    author: Option<String>,
    file_path: Option<String>,
    format: Option<String>,
    size_bytes: Option<i64>,
    content: Option<String>,
    metadata: Option<serde_json::Value>,
}

pub async fn create_book(
    State(ctx): State<Arc<AppCtx>>,
    Json(req): Json<CreateBookRequest>,
) -> Result<Json<ApiResponse<items::Model>>, AppError> {
    let item = ItemsRepo::create(
        &ctx.db,
        CreateItemParams {
            container_id: req.container_id,
            title: req.title,
            author: req.author,
            file_path: req.file_path.unwrap_or_default(),
            format: req.format.unwrap_or_else(|| "txt".to_string()),
            size_bytes: req.size_bytes,
            content: req.content,
            metadata: req.metadata.unwrap_or_else(|| serde_json::json!({})),
        },
    )
    .await?;
    Ok(ok(item))
}

#[derive(Debug, Deserialize)]
pub struct UpdateBookRequest {
    title: Option<String>,
    author: Option<String>,
    file_path: Option<String>,
    format: Option<String>,
    size_bytes: Option<i64>,
    content: Option<String>,
    metadata: Option<serde_json::Value>,
}

pub async fn update_book(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateBookRequest>,
) -> Result<Json<ApiResponse<items::Model>>, AppError> {
    let item = ItemsRepo::update(
        &ctx.db,
        id,
        UpdateItemParams {
            title: req.title,
            author: req.author,
            file_path: req.file_path,
            format: req.format,
            size_bytes: req.size_bytes,
            content: req.content,
            metadata: req.metadata,
        },
    )
    .await?;
    Ok(ok(item))
}

pub async fn delete_book(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    ItemsRepo::delete(&ctx.db, id).await?;
    Ok(ok(()))
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum ReorderBooksRequest {
    Array(Vec<Uuid>),
    Object {
        #[serde(alias = "ids", alias = "books", alias = "order")]
        ids: Vec<Uuid>,
    },
}

impl ReorderBooksRequest {
    fn ids(self) -> Vec<Uuid> {
        match self {
            Self::Array(ids) | Self::Object { ids } => ids,
        }
    }
}

pub async fn reorder_books(
    State(ctx): State<Arc<AppCtx>>,
    Json(req): Json<ReorderBooksRequest>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    ContainersRepo::reorder(&ctx.db, req.ids()).await?;
    Ok(ok(()))
}

pub async fn list_book_items(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<Uuid>,
    Query(q): Query<ListItemsQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let page = q.page();
    let page_size = q.page_size();
    let (rows, total) = ItemsRepo::list_by_container(&ctx.db, id, page, page_size, q.search.as_deref()).await?;
    Ok(ok(serde_json::json!({
        "items": rows,
        "total": total,
        "page": page,
        "pageSize": page_size,
    })))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookDetailResponse {
    #[serde(flatten)]
    item: items::Model,
    chapters: Vec<crate::db::entities::chapters::Model>,
    total_chapters: usize,
}

pub async fn get_book_detail(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<BookDetailResponse>>, AppError> {
    let item = ItemsRepo::get_by_id(&ctx.db, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("book item {id} not found")))?;
    let chapters = ChaptersRepo::list_by_item(&ctx.db, id).await?;
    Ok(ok(BookDetailResponse {
        item,
        total_chapters: chapters.len(),
        chapters,
    }))
}

#[derive(Serialize)]
pub struct ChapterContentResponse {
    id: Uuid,
    title: String,
    idx: i32,
    content: String,
    #[serde(rename = "itemId")]
    item_id: Uuid,
}

pub async fn get_chapter_content(
    State(ctx): State<Arc<AppCtx>>,
    Path((book_id, chapter_id)): Path<(Uuid, i32)>,
) -> Result<Json<ApiResponse<ChapterContentResponse>>, AppError> {
    let chapter = ChaptersRepo::get_by_item_and_idx(&ctx.db, book_id, chapter_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("chapter {chapter_id} in item {book_id} not found")))?;
    Ok(ok(ChapterContentResponse {
        id: chapter.id,
        title: chapter.title,
        idx: chapter.idx,
        content: chapter.content,
        item_id: chapter.item_id,
    }))
}

pub async fn sync_book(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let container = ContainersRepo::get_by_id(&ctx.db, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("container {id} not found")))?;
    BookSyncStatusRepo::upsert(
        &ctx.db,
        id,
        "running".to_string(),
        None,
        None,
        Some(serde_json::json!({"scanned": 0})),
    )
    .await?;
    let bg_ctx = Arc::clone(&ctx);
    tokio::spawn(async move {
        if let Err(error) = execute_book_sync(bg_ctx, container).await {
            error!(%error, "book sync failed");
        }
    });
    Ok(ok(serde_json::json!({ "started": true })))
}

#[derive(Serialize)]
pub struct BookSyncStatusResponse {
    #[serde(rename = "bookId")]
    book_id: Uuid,
    #[serde(rename = "containerId")]
    container_id: Uuid,
    status: String,
    #[serde(rename = "lastSyncAt")]
    last_sync_at: Option<String>,
    #[serde(rename = "lastError")]
    last_error: Option<String>,
    progress: Option<serde_json::Value>,
    #[serde(rename = "updatedAt")]
    updated_at: String,
}

pub async fn get_book_sync_status(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<BookSyncStatusResponse>>, AppError> {
    let status = BookSyncStatusRepo::get_by_container(&ctx.db, id).await?;
    let response = if let Some(s) = status {
        BookSyncStatusResponse {
            book_id: s.container_id,
            container_id: s.container_id,
            status: s.status,
            last_sync_at: s.last_sync_at.map(|t| t.to_string()),
            last_error: s.last_error,
            progress: s.progress,
            updated_at: s.updated_at.to_string(),
        }
    } else {
        BookSyncStatusResponse {
            book_id: id,
            container_id: id,
            status: "none".to_string(),
            last_sync_at: None,
            last_error: None,
            progress: None,
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    };
    Ok(ok(response))
}

pub async fn get_all_book_sync_statuses(
    State(ctx): State<Arc<AppCtx>>,
) -> Result<Json<ApiResponse<Vec<BookSyncStatusResponse>>>, AppError> {
    let response = BookSyncStatusRepo::list_all(&ctx.db)
        .await?
        .into_iter()
        .map(|s| BookSyncStatusResponse {
            book_id: s.container_id,
            container_id: s.container_id,
            status: s.status,
            last_sync_at: s.last_sync_at.map(|t| t.to_string()),
            last_error: s.last_error,
            progress: s.progress,
            updated_at: s.updated_at.to_string(),
        })
        .collect();
    Ok(ok(response))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookProviderOutput {
    name: String,
    url: String,
    supports_search: bool,
}

#[allow(clippy::unused_async)]
pub async fn list_providers() -> Result<Json<ApiResponse<Vec<BookProviderOutput>>>, AppError> {
    let mut providers: Vec<BookProviderOutput> = novel_downloader::list_providers()
        .into_iter()
        .map(|p| BookProviderOutput {
            name: p.name,
            url: p.url,
            supports_search: p.supports_search,
        })
        .collect();
    for name in bookfinder::list_provider_names() {
        providers.push(BookProviderOutput {
            name: name.to_string(),
            url: format!("bookfinder://{name}"),
            supports_search: true,
        });
    }
    Ok(ok(providers))
}

#[derive(Debug, Deserialize)]
pub struct SearchBooksRequest {
    #[serde(alias = "keyword")]
    query: String,
    #[serde(alias = "source")]
    provider: Option<String>,
    #[serde(alias = "sources")]
    providers: Option<Vec<String>>,
}

fn is_bookfinder_provider(name: &str) -> bool {
    let provider = name.trim().to_ascii_lowercase();
    matches!(
        provider.as_str(),
        "libgen" | "gutenberg" | "archive" | "annas-archive" | "bookfinder"
    ) || provider.contains("bookfinder")
        || provider.contains("libgen")
        || bookfinder::list_provider_names()
            .iter()
            .any(|known| provider == known.to_ascii_lowercase())
}

#[derive(Clone, Debug)]
enum BookfinderSelection {
    All,
    Providers(Vec<String>),
}

fn normalize_provider_name(name: &str) -> String {
    name.trim()
        .trim_start_matches("bookfinder://")
        .trim()
        .to_ascii_lowercase()
}

fn requested_bookfinder_selection(requested: &[String]) -> Option<BookfinderSelection> {
    if requested.is_empty() {
        return Some(BookfinderSelection::All);
    }

    let mut provider_names = Vec::new();
    for provider in requested {
        let provider = normalize_provider_name(provider);
        if provider == "bookfinder" {
            return Some(BookfinderSelection::All);
        }
        if bookfinder::list_provider_names().iter().any(|known| provider == *known)
            && !provider_names.contains(&provider)
        {
            provider_names.push(provider);
        }
    }

    if provider_names.is_empty() {
        None
    } else {
        Some(BookfinderSelection::Providers(provider_names))
    }
}

async fn send_bookfinder_results(query: String, selection: BookfinderSelection, tx: tokio::sync::mpsc::Sender<Event>) {
    match selection {
        BookfinderSelection::All => {
            let mut stream = bookfinder::search_stream(query);
            while let Some(result) = stream.next().await {
                if let Ok(data) = serde_json::to_string(&result) {
                    let _ = tx.send(Event::default().event("result").data(data)).await;
                }
            }
        }
        BookfinderSelection::Providers(provider_names) => {
            for provider_name in provider_names {
                let Some(provider) = bookfinder::get_providers()
                    .into_iter()
                    .find(|provider| provider.name() == provider_name)
                else {
                    warn!(%provider_name, "requested bookfinder provider not found");
                    continue;
                };
                match provider.search(&query).await {
                    Ok(results) => {
                        for result in results {
                            if let Ok(data) = serde_json::to_string(&result) {
                                let _ = tx.send(Event::default().event("result").data(data)).await;
                            }
                        }
                    }
                    Err(error) => warn!(%error, %provider_name, "bookfinder search failed"),
                }
            }
        }
    }
}

#[allow(clippy::unused_async)]
pub async fn search_books(Json(req): Json<SearchBooksRequest>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let requested: Vec<String> = req
        .providers
        .clone()
        .unwrap_or_else(|| req.provider.clone().into_iter().collect());

    let bookfinder_selection = requested_bookfinder_selection(&requested);
    let use_novel = requested.is_empty() || requested.iter().any(|p| !is_bookfinder_provider(p));

    let query = req.query.clone();
    let s = stream! {
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Event>(256);
        if let Some(selection) = bookfinder_selection.clone() {
            let bookfinder_query = query.clone();
            let bookfinder_tx = tx.clone();
            tokio::spawn(async move {
                send_bookfinder_results(bookfinder_query, selection, bookfinder_tx).await;
            });
        }
        if use_novel {
            let novel_query = query.clone();
            let novel_tx = tx.clone();
            tokio::spawn(async move {
                let mut stream = novel_downloader::search_stream(novel_query);
                while let Some(result) = stream.next().await {
                    if let Ok(data) = serde_json::to_string(&result) {
                        let _ = novel_tx.send(Event::default().event("result").data(data)).await;
                    }
                }
            });
        }
        drop(tx);
        while let Some(event) = rx.recv().await {
            yield Ok::<_, Infallible>(event);
        }
        yield Ok(Event::default().event("done").data("{}"));
    };
    Sse::new(s).keep_alive(KeepAlive::default())
}

#[derive(Debug, Deserialize)]
pub struct GetBookInfoRequest {
    provider: String,
    #[serde(alias = "book_id", alias = "external_id", alias = "externalId")]
    book_id: String,
}

pub async fn get_book_info(
    Json(req): Json<GetBookInfoRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    if req.provider.trim().is_empty() || req.book_id.trim().is_empty() {
        return Err(AppError::BadRequest("provider and book_id are required".to_string()));
    }
    if is_bookfinder_provider(&req.provider) {
        return Err(AppError::BadRequest(format!(
            "provider '{}' is a binary-file provider and does not support chapter metadata; use download to obtain the file",
            req.provider
        )));
    }
    let info = novel_downloader::get_book_info(&req.provider, &req.book_id)
        .await
        .map_err(|error| AppError::BadRequest(format!("failed to get book info: {error}")))?;
    Ok(ok(book_info_json(&info)))
}

#[derive(Debug, Deserialize)]
pub struct DownloadBookRequest {
    provider: String,
    #[serde(alias = "book_id", alias = "external_id", alias = "externalId")]
    book_id: String,
    #[serde(alias = "container_id", alias = "libraryId", alias = "library_id")]
    container_id: Uuid,
    user_id: Option<Uuid>,
    title: Option<String>,
}

#[allow(clippy::unused_async)]
pub async fn download_book(
    State(ctx): State<Arc<AppCtx>>,
    Json(req): Json<DownloadBookRequest>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let s = stream! {
        let task = DownloadTasksRepo::insert(
            &ctx.db,
            InsertDownloadTaskParams {
                user_id: req.user_id,
                provider: req.provider.clone(),
                query: req.title.clone().unwrap_or_else(|| req.book_id.clone()),
                external_id: Some(req.book_id.clone()),
                status: "running".to_string(),
                item_id: None,
                error: None,
                progress: Some(serde_json::json!({"downloaded": 0, "failed": 0})),
            },
        ).await;
        let task = match task {
            Ok(task) => task,
            Err(error) => {
                yield Ok::<_, Infallible>(Event::default().event("error").data(error.to_string()));
                return;
            }
        };
        yield Ok(Event::default().event("task").data(serde_json::json!({"taskId": task.id}).to_string()));
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Event>();
        let worker_ctx = Arc::clone(&ctx);
        let error_ctx = Arc::clone(&ctx);
        let worker_task_id = task.id;
        tokio::spawn(async move {
            if let Err(error) = do_download_book(worker_ctx, req, worker_task_id, tx.clone()).await {
                let _ = DownloadTasksRepo::update(
                    &error_ctx.db,
                    worker_task_id,
                    "failed".to_string(),
                    None,
                    Some(error.to_string()),
                    None,
                ).await;
                let _ = tx.send(Event::default().event("error").data(error.to_string()));
            }
        });
        while let Some(event) = rx.recv().await {
            yield Ok(event);
        }
    };
    Sse::new(s).keep_alive(KeepAlive::default())
}

async fn do_download_book(
    ctx: Arc<AppCtx>,
    req: DownloadBookRequest,
    task_id: Uuid,
    events: tokio::sync::mpsc::UnboundedSender<Event>,
) -> Result<(), AppError> {
    let container = ContainersRepo::get_by_id(&ctx.db, req.container_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("container {} not found", req.container_id)))?;
    let info = novel_downloader::get_book_info(&req.provider, &req.book_id)
        .await
        .map_err(|error| AppError::BadRequest(format!("failed to get book info: {error}")))?;
    let title = req.title.clone().unwrap_or_else(|| info.book_name.clone());
    let total_chapters = info.volumes.iter().map(|v| v.chapters.len()).sum::<usize>();
    let chapter_vfs = match ensure_container_vfs(&ctx, &container).await {
        Ok(vfs) => Some(vfs),
        Err(error) => {
            warn!(%error, "download will persist chapter content in database only");
            None
        }
    };
    let book_dir = join_vfs_path(&container.root_path, &sanitize_filename(&title));
    if let Some(vfs) = &chapter_vfs
        && let Err(error) = vfs.mkdir(StdPath::new(&book_dir)).await
    {
        warn!(%error, %book_dir, "failed to create book directory in VFS");
    }
    let item = ItemsRepo::create(
        &ctx.db,
        CreateItemParams {
            container_id: container.id,
            title: title.clone(),
            author: Some(info.author.clone()).filter(|s| !s.is_empty()),
            file_path: String::new(),
            format: "online-novel".to_string(),
            size_bytes: None,
            content: None,
            metadata: serde_json::json!({
                "provider": req.provider,
                "bookId": req.book_id,
                "summary": info.summary,
                "coverUrl": info.cover_url,
                "updateTime": info.update_time,
                "wordCount": info.word_count,
                "serialStatus": info.serial_status,
                "totalChapters": total_chapters,
                "vfsDir": book_dir,
                "volumes": info.volumes,
            }),
        },
    )
    .await?;
    DownloadTasksRepo::update(
        &ctx.db,
        task_id,
        "running".to_string(),
        Some(item.id),
        None,
        Some(serde_json::json!({"downloaded": 0, "failed": 0, "total": total_chapters})),
    )
    .await?;
    let _ = events.send(
        Event::default().event("book_info").data(
            serde_json::json!({
                "taskId": task_id,
                "bookId": item.id,
                "title": title,
                "author": info.author,
                "totalChapters": total_chapters,
            })
            .to_string(),
        ),
    );

    let mut downloaded = 0usize;
    let mut failed = 0usize;
    let mut stream = novel_downloader::download_stream(req.provider, req.book_id);
    while let Some(event) = stream.next().await {
        match event.map_err(|error| AppError::BadRequest(format!("download failed: {error}")))? {
            novel_downloader::DownloadEvent::BookInfo { .. } => {}
            novel_downloader::DownloadEvent::Chapter {
                index, title, content, ..
            } => {
                let chapter_title = title.clone();
                if let Some(vfs) = &chapter_vfs {
                    let filename = format!("第{:03}章 {}.txt", index + 1, sanitize_filename(&chapter_title));
                    let chapter_path = join_vfs_path(&book_dir, &filename);
                    if let Err(error) = vfs.put(StdPath::new(&chapter_path), content.as_bytes().to_vec()).await {
                        warn!(%error, %chapter_path, "failed to write chapter to VFS");
                    }
                }
                let txn = ctx.db.begin().await?;
                ChaptersRepo::create(
                    &txn,
                    CreateChapterParams {
                        item_id: item.id,
                        idx: index as i32,
                        title,
                        content,
                    },
                )
                .await?;
                txn.commit().await?;
                downloaded += 1;
                DownloadTasksRepo::update(
                    &ctx.db,
                    task_id,
                    "running".to_string(),
                    Some(item.id),
                    None,
                    Some(serde_json::json!({"downloaded": downloaded, "failed": failed, "total": total_chapters})),
                )
                .await?;
                let _ = events.send(
                    Event::default().event("chapter").data(
                        serde_json::json!({
                            "index": index,
                            "title": chapter_title,
                            "downloaded": downloaded,
                            "failed": failed,
                            "total": total_chapters,
                        })
                        .to_string(),
                    ),
                );
            }
            novel_downloader::DownloadEvent::ChapterError { error, .. } => {
                failed += 1;
                warn!(%error, "chapter download failed");
                let error_message = error.clone();
                DownloadTasksRepo::update(
                    &ctx.db,
                    task_id,
                    "running".to_string(),
                    Some(item.id),
                    Some(error),
                    Some(serde_json::json!({"downloaded": downloaded, "failed": failed, "total": total_chapters})),
                )
                .await?;
                let _ = events.send(
                    Event::default().event("chapter_error").data(
                        serde_json::json!({
                            "downloaded": downloaded,
                            "failed": failed,
                            "total": total_chapters,
                            "error": error_message,
                        })
                        .to_string(),
                    ),
                );
            }
            novel_downloader::DownloadEvent::Done {
                downloaded: done,
                failed: done_failed,
            } => {
                DownloadTasksRepo::update(
                    &ctx.db,
                    task_id,
                    "completed".to_string(),
                    Some(item.id),
                    None,
                    Some(serde_json::json!({"downloaded": done, "failed": done_failed, "total": total_chapters})),
                )
                .await?;
                let _ = events.send(
                    Event::default().event("done").data(
                        serde_json::json!({
                            "taskId": task_id,
                            "bookId": item.id,
                            "downloaded": done,
                            "failed": done_failed,
                            "total": total_chapters,
                        })
                        .to_string(),
                    ),
                );
            }
        }
    }
    Ok(())
}

async fn execute_book_sync(ctx: Arc<AppCtx>, container: containers::Model) -> Result<(), AppError> {
    let result = async {
        let vfs = ensure_container_vfs(&ctx, &container).await?;
        let mut files = Vec::new();
        walk_book_files(&vfs, &container.root_path, &mut files).await?;
        let total = files.len();
        let mut scanned = 0usize;
        for file in files {
            let ext = extension(&file.path);
            let filename = file.path.rsplit('/').next().unwrap_or(&file.path);
            let parsed = parse_book_name(filename);
            if parsed.title.is_empty() {
                continue;
            }

            // Read bytes for txt/epub/pdf
            let bytes_opt = if matches!(ext.as_str(), "txt" | "epub" | "pdf") {
                vfs.read_bytes(StdPath::new(&file.path), 0, None).await.ok()
            } else {
                None
            };

            let (title, author, content, extra_metadata) = if let Some(bytes) = &bytes_opt {
                if ext == "txt" {
                    let text = String::from_utf8_lossy(bytes).into_owned();
                    (parsed.title, parsed.author, Some(text), serde_json::json!({}))
                } else if matches!(ext.as_str(), "epub" | "pdf") {
                    let scraped = scrape_book_file(&file.path, &ext, bytes);
                    let title = scraped.title.filter(|s| !s.trim().is_empty()).unwrap_or(parsed.title);
                    let author = scraped.author.filter(|s| !s.trim().is_empty()).or(parsed.author);
                    (title, author, scraped.content, scraped.metadata)
                } else {
                    (parsed.title, parsed.author, None, serde_json::json!({}))
                }
            } else {
                (parsed.title, parsed.author, None, serde_json::json!({}))
            };

            // Merge source fields with scrape metadata
            let mut metadata = serde_json::json!({
                "sourceId": container.source_id,
                "sourceType": container.source_type,
                "syncedFromVfs": true,
            });
            if let (Some(base), Some(extra)) = (metadata.as_object_mut(), extra_metadata.as_object()) {
                for (k, v) in extra {
                    base.insert(k.clone(), v.clone());
                }
            }

            ItemsRepo::upsert_scanned_file(
                &ctx.db,
                CreateItemParams {
                    container_id: container.id,
                    title,
                    author,
                    file_path: file.path.clone(),
                    format: ext,
                    size_bytes: Some(file.size as i64),
                    content,
                    metadata,
                },
            )
            .await?;
            scanned += 1;
            BookSyncStatusRepo::upsert(
                &ctx.db,
                container.id,
                "running".to_string(),
                None,
                None,
                Some(serde_json::json!({"scanned": scanned, "total": total})),
            )
            .await?;
        }
        Ok::<usize, AppError>(scanned)
    }
    .await;

    match result {
        Ok(scanned) => {
            BookSyncStatusRepo::upsert(
                &ctx.db,
                container.id,
                "completed".to_string(),
                Some(chrono::Utc::now().into()),
                None,
                Some(serde_json::json!({"scanned": scanned})),
            )
            .await?;
            info!(container_id = %container.id, scanned, "book sync completed");
            Ok(())
        }
        Err(error) => {
            BookSyncStatusRepo::upsert(
                &ctx.db,
                container.id,
                "failed".to_string(),
                None,
                Some(error.to_string()),
                None,
            )
            .await?;
            Err(error)
        }
    }
}

#[derive(Debug)]
struct WalkedFile {
    path: String,
    size: u64,
}

async fn walk_book_files(vfs: &Arc<Vfs>, root: &str, output: &mut Vec<WalkedFile>) -> Result<(), AppError> {
    let mut stack = vec![normalize_vfs_path(root)];
    while let Some(path) = stack.pop() {
        let entries = vfs
            .list(StdPath::new(&path))
            .await
            .map_err(|error| AppError::Internal(format!("vfs list {path}: {error}")))?;
        for entry in entries {
            if entry.is_dir {
                stack.push(entry.path);
            } else if is_book_extension(&entry.path) {
                output.push(WalkedFile {
                    path: entry.path,
                    size: entry.size,
                });
            }
        }
    }
    Ok(())
}

async fn ensure_container_vfs(ctx: &AppCtx, container: &containers::Model) -> Result<Arc<Vfs>, AppError> {
    let source_id = container
        .source_id
        .ok_or_else(|| AppError::BadRequest("container has no source_id".to_string()))?;
    let client = ctx
        .client
        .get()
        .ok_or_else(|| AppError::Internal("bus client is not initialized".to_string()))?;
    let cfg = bus_clients::vfs::get_driver_config(client, source_id).await?;
    let registry = DriverRegistry::new();
    let driver = registry
        .create(&cfg.driver_name, &cfg.config)
        .map_err(|error| AppError::Internal(format!("vfs driver create: {error}")))?;
    let driver: Arc<dyn tokimo_vfs::Driver> = Arc::from(driver);
    driver
        .init()
        .await
        .map_err(|error| AppError::Internal(format!("vfs driver init: {error}")))?;
    let manager = StorageManager::new();
    manager.mount(StorageMount::new("/", driver)).await;
    Ok(Arc::new(Vfs::new(manager)))
}

fn book_info_json(info: &novel_downloader::BookInfo) -> serde_json::Value {
    serde_json::json!({
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
            "chapters": v.chapters,
        })).collect::<Vec<_>>(),
        "totalChapters": info.volumes.iter().map(|v| v.chapters.len()).sum::<usize>(),
    })
}

fn normalize_vfs_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "/" {
        "/".to_string()
    } else if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    }
}

fn extension(path: &str) -> String {
    StdPath::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("txt")
        .to_ascii_lowercase()
}

fn is_book_extension(path: &str) -> bool {
    matches!(
        extension(path).as_str(),
        "epub" | "pdf" | "mobi" | "azw3" | "txt" | "cbz"
    )
}

fn join_vfs_path(parent: &str, child: &str) -> String {
    let parent = normalize_vfs_path(parent);
    if parent == "/" {
        format!("/{child}")
    } else {
        format!("{}/{child}", parent.trim_end_matches('/'))
    }
}

fn sanitize_filename(name: &str) -> String {
    let sanitized = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect::<String>()
        .trim()
        .to_string();
    if sanitized.is_empty() {
        "untitled".to_string()
    } else {
        sanitized
    }
}

struct ParsedBookName {
    title: String,
    author: Option<String>,
}

fn parse_book_name(raw: &str) -> ParsedBookName {
    let stem = raw.rsplit_once('.').map_or(raw, |(name, _)| name).trim();
    let stem = Regex::new(r"\s*\((?:Z-Library|z-lib\.org|zlibrary)[^)]*\)\s*$")
        .ok()
        .map_or_else(|| stem.to_string(), |re| re.replace(stem, "").to_string());
    let stem = stem.trim();
    if stem.is_empty() || stem.chars().all(|c| c.is_ascii_digit()) {
        return ParsedBookName {
            title: String::new(),
            author: None,
        };
    }
    if let Some(caps) = Regex::new(r"^\[(.+?)\]\s*(.+)$").ok().and_then(|re| re.captures(stem)) {
        return ParsedBookName {
            title: caps.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default(),
            author: caps.get(1).map(|m| m.as_str().trim().to_string()),
        };
    }
    if let Some(caps) = Regex::new(r"^(.+?)[（(]([^）)]+)[）)]$")
        .ok()
        .and_then(|re| re.captures(stem))
    {
        return ParsedBookName {
            title: caps.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default(),
            author: caps.get(2).map(|m| m.as_str().trim().to_string()),
        };
    }
    if let Some(caps) = Regex::new(r"^(.+?)\s*[-–—]\s*(.+)$")
        .ok()
        .and_then(|re| re.captures(stem))
    {
        let left = caps.get(1).map(|m| m.as_str().trim()).unwrap_or_default();
        let right = caps.get(2).map(|m| m.as_str().trim()).unwrap_or_default();
        if !left.is_empty() && !right.is_empty() && left.chars().count() <= 10 {
            return ParsedBookName {
                title: right.to_string(),
                author: Some(left.to_string()),
            };
        }
    }
    ParsedBookName {
        title: stem.to_string(),
        author: None,
    }
}
