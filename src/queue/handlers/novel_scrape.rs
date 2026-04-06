//! `novel_scrape` queue handler — processes novel files discovered from VFS walk.
//!
//! For each novel file:
//! 1. Parse title/author from **filename** (never directory name)
//! 2. Idempotency check against the novels table
//! 3. Create Novel record in DB
//! 4. Attempt metadata scrape via Douban Books + Qidian (dual-source, like TMDB+IMDB for movies)
//! 5. Create `MediaFile` record linking the file to the novel

use bytes::Bytes;
use regex::Regex;
use rust_client_api::metadata_providers::douban::{DoubanBookDetail, DoubanClient, DoubanConfig};
use rust_client_api::metadata_providers::qidian::{
    QidianBookDetail, QidianClient, QidianConfig, QidianSearchItem,
};
use sea_orm::*;
use serde_json::{json, Value as JsonValue};
use std::hash::{Hash, Hasher};
use std::path::Path as StdPath;
use std::sync::{Arc, LazyLock};
use tokio::time::Duration;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::db::entities::{novel_files, novel_chapters, novels};
use crate::config::DoubanSettings;
use crate::db::repos::system_config_repo::SystemConfigRepo;
use crate::services::storage::UploadOptions;
use crate::AppState;

type BoxError = Box<dyn std::error::Error + Send + Sync>;

struct ParsedNovelName {
    title: String,
    author: Option<String>,
}

/// `作者 - 书名` or `作者-书名`
static RE_DASH_SEP: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(.+?)\s*[-–—]\s*(.+)$").unwrap());

/// `[作者] 书名`
static RE_BRACKET_AUTHOR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\[(.+?)\]\s*(.+)$").unwrap());

/// `书名（作者）` or `书名(作者)` — fullwidth/halfwidth parens
static RE_PAREN_AUTHOR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(.+?)[（(]([^）)]+)[）)]$").unwrap());

/// `《书名》描述.作者名` e.g. `民国三大奇书《宗吾臆谈》.李宗吾`
static RE_BOOK_TITLE_BRACKETS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"《(.+?)》").unwrap());

/// Z-Library style: `书名 (作者) (Z-Library)` or `书名 (作者, 译者) (Z-Library)`
static RE_ZLIB: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(.+?)\s*\(([^)]+)\)\s*\((?:Z-Library|z-lib\.org|zlibrary)[^)]*\)$").unwrap()
});

/// Trailing Z-Library / z-lib tag: `(Z-Library)`, `(z-lib.org)`, etc.
static RE_ZLIB_SUFFIX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s*\((?:Z-Library|z-lib\.org|zlibrary)[^)]*\)\s*$").unwrap());

/// Trailing `(1)`, `(2)` etc. duplicate suffix
static RE_DUP_SUFFIX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*\(\d+\)\s*$").unwrap());

/// Detect numeric volume range like `1-10` at the end (to avoid splitting on dash)
static RE_VOL_RANGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d+\s*[-–—]\s*\d+").unwrap());

/// Strip known file extensions from a filename stem.
fn strip_ext(filename: &str) -> &str {
    let lower = filename.to_lowercase();
    for ext in [".txt", ".epub", ".mobi", ".azw3", ".pdf", ".cbz"] {
        if lower.ends_with(ext) {
            return &filename[..filename.len() - ext.len()];
        }
    }
    filename
}

/// Clean a raw filename stem: remove duplicate suffixes, Z-Library tags, etc.
fn clean_stem(stem: &str) -> String {
    // Strip (1), (2) duplicate suffixes first
    let s = RE_DUP_SUFFIX.replace(stem, "");
    // Strip (Z-Library) or (z-lib.org) suffix
    let s = RE_ZLIB_SUFFIX.replace(&s, "");
    s.trim().to_string()
}

/// Returns true if the stem looks purely numeric (e.g. "1", "10", "123")
fn is_numeric_title(title: &str) -> bool {
    !title.is_empty() && title.chars().all(|c| c.is_ascii_digit())
}

fn parse_novel_name(raw: &str) -> ParsedNovelName {
    let stem = clean_stem(strip_ext(raw).trim());

    // Skip purely numeric filenames like "1.pdf", "10.pdf"
    if is_numeric_title(&stem) {
        return ParsedNovelName {
            title: String::new(),
            author: None,
        };
    }

    // Pattern: Z-Library style `书名 (作者) (Z-Library).epub`
    // (Only tries after Z-Library suffix was already stripped by clean_stem,
    //  this handles the case where clean_stem couldn't strip it.)
    if let Some(caps) = RE_ZLIB.captures(&stem) {
        return ParsedNovelName {
            title: caps.get(1).unwrap().as_str().trim().to_string(),
            author: Some(
                caps.get(2)
                    .unwrap()
                    .as_str()
                    .split(',')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string(),
            ),
        };
    }

    // Pattern: `《书名》...` — extract title from Chinese book brackets
    if let Some(caps) = RE_BOOK_TITLE_BRACKETS.captures(&stem) {
        let title = caps.get(1).unwrap().as_str().trim().to_string();
        let after = stem[caps.get(0).unwrap().end()..].trim();
        let author = after
            .trim_start_matches('.')
            .trim_start_matches('_')
            .trim()
            .to_string();
        return ParsedNovelName {
            title,
            author: if author.is_empty() {
                None
            } else {
                Some(author)
            },
        };
    }

    // Pattern: `[书名].作者.描述` — when content after `]` starts with `.`
    // vs `[作者] 书名` — when content after `]` starts with a space
    if let Some(caps) = RE_BRACKET_AUTHOR.captures(&stem) {
        let bracket_content = caps.get(1).unwrap().as_str().trim();
        let rest = caps.get(2).unwrap().as_str().trim();
        if rest.starts_with('.') {
            let after_dot = rest.trim_start_matches('.');
            let author = after_dot.split('.').next().unwrap_or("").trim();
            return ParsedNovelName {
                title: bracket_content.to_string(),
                author: if author.is_empty() {
                    None
                } else {
                    Some(author.to_string())
                },
            };
        }
        return ParsedNovelName {
            title: rest.to_string(),
            author: Some(bracket_content.to_string()),
        };
    }

    // Pattern: `书名（作者）` or `书名(作者)` — BEFORE dash to handle
    // cases like `Title - Subtitle (Author)` correctly
    if let Some(caps) = RE_PAREN_AUTHOR.captures(&stem) {
        return ParsedNovelName {
            title: caps.get(1).unwrap().as_str().trim().to_string(),
            author: Some(caps.get(2).unwrap().as_str().trim().to_string()),
        };
    }

    // Pattern: `作者 - 书名` — but skip if the dash is part of a volume range (e.g. `镖人1-10`)
    if let Some(caps) = RE_DASH_SEP.captures(&stem) {
        let part1 = caps.get(1).unwrap().as_str().trim();
        let part2 = caps.get(2).unwrap().as_str().trim();
        // Skip if this looks like a volume range (e.g. "镖人1-10")
        if !RE_VOL_RANGE.is_match(&stem) && part1.chars().count() <= 10 {
            return ParsedNovelName {
                title: part2.to_string(),
                author: Some(part1.to_string()),
            };
        }
        // Otherwise treat whole stem as title
        return ParsedNovelName {
            title: stem.clone(),
            author: None,
        };
    }

    // Fallback: whole stem is title
    ParsedNovelName {
        title: stem.clone(),
        author: None,
    }
}

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    _job_id: Uuid,
    payload: &JsonValue,
) -> Result<Option<JsonValue>, BoxError> {
    let app_id = payload
        .get("appId")
        .and_then(|v| v.as_str())
        .ok_or("Missing appId")?;
    let source_id = payload
        .get("sourceId")
        .and_then(|v| v.as_str())
        .ok_or("Missing sourceId")?;
    let app_uuid = Uuid::parse_str(app_id)?;
    let source_uuid = Uuid::parse_str(source_id)?;

    // Dispatch: directory mode (chapterFiles present) vs single-file mode
    if let Some(chapter_files) = payload.get("chapterFiles").and_then(|v| v.as_array()) {
        handle_directory_novel(db, state, payload, app_uuid, source_uuid, chapter_files).await
    } else {
        handle_single_file_novel(db, state, payload, app_uuid, source_uuid).await
    }
}

/// Directory mode: a folder of .txt chapter files → one novel with chapter records.
/// Title is derived from the directory name. Chapters go into `novel_chapters` table.
async fn handle_directory_novel(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    payload: &JsonValue,
    app_uuid: Uuid,
    _source_uuid: Uuid,
    chapter_files: &[JsonValue],
) -> Result<Option<JsonValue>, BoxError> {
    let dir_path = payload
        .get("dirPath")
        .and_then(|v| v.as_str())
        .ok_or("Missing dirPath")?;

    // Title from directory name
    let dir_name = dir_path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(dir_path);
    let parsed = parse_novel_name(dir_name);
    let title = parsed.title.clone();

    if title.is_empty() {
        return Ok(Some(
            json!({ "skipped": true, "reason": "empty_dir_title" }),
        ));
    }

    info!(
        "[novel_scrape] Directory mode: \"{title}\" from {dir_path} ({} chapters)",
        chapter_files.len()
    );

    // Parse chapter info from filenames and sort by number
    let mut chapters = parse_chapter_files(chapter_files);
    chapters.sort_by_key(|c| c.number);

    // ── Idempotency check with advisory lock ──
    let lock_key = {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        (app_uuid, &title).hash(&mut hasher);
        hasher.finish() as i64
    };

    let txn = db.begin().await?;
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        format!("SELECT pg_advisory_xact_lock({lock_key})"),
        vec![],
    ))
    .await?;

    let existing = novels::Entity::find()
        .filter(novels::Column::AppId.eq(app_uuid))
        .filter(novels::Column::Title.eq(&title))
        .one(&txn)
        .await?;

    let novel_id = if let Some(existing_novel) = existing {
        // Novel already exists — add any new chapters
        let existing_chapters: Vec<i32> = novel_chapters::Entity::find()
            .filter(novel_chapters::Column::NovelId.eq(existing_novel.id))
            .all(&txn)
            .await?
            .iter()
            .map(|c| c.chapter_number)
            .collect();

        let mut added = 0u64;
        for ch in &chapters {
            if existing_chapters.contains(&ch.number) {
                continue;
            }
            insert_novel_chapter(&txn, existing_novel.id, ch).await?;
            added += 1;
        }
        txn.commit().await?;
        if added > 0 {
            info!("[novel_scrape] Added {added} new chapters to existing \"{title}\"");
        } else {
            debug!("[novel_scrape] Directory \"{title}\" already fully indexed");
        }
        return Ok(Some(
            json!({ "linked": true, "novelId": existing_novel.id.to_string(), "newChapters": added }),
        ));
    } else {
        // Create new novel
        let novel_id = Uuid::new_v4();
        let now = chrono::Utc::now().fixed_offset();
        let novel = novels::ActiveModel {
            id: Set(novel_id),
            app_id: Set(app_uuid),
            title: Set(title.clone()),
            author: Set(parsed.author.clone()),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            ..Default::default()
        };
        novels::Entity::insert(novel).exec(&txn).await?;

        // Insert all chapter records
        for ch in &chapters {
            insert_novel_chapter(&txn, novel_id, ch).await?;
        }
        txn.commit().await?;
        info!(
            "[novel_scrape] Created novel \"{title}\" ({novel_id}) with {} chapters",
            chapters.len()
        );
        novel_id
    };

    // ── Online metadata scrape (Douban + Qidian dual-source) ──
    if let Err(e) = scrape_metadata(db, state, novel_id, &title, parsed.author.as_deref()).await {
        warn!("[novel_scrape] Metadata scrape failed for \"{title}\": {e}");
    }

    Ok(Some(json!({
        "novelId": novel_id.to_string(),
        "title": title,
        "chapters": chapters.len(),
    })))
}

/// Single-file mode: one novel file (epub/mobi/pdf/azw3/cbz or lone txt).
async fn handle_single_file_novel(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    payload: &JsonValue,
    app_uuid: Uuid,
    source_uuid: Uuid,
) -> Result<Option<JsonValue>, BoxError> {
    let file_path = payload
        .get("filePath")
        .and_then(|v| v.as_str())
        .ok_or("Missing filePath")?;
    let file_size = payload
        .get("fileSize")
        .and_then(sea_orm::JsonValue::as_i64)
        .unwrap_or(0);
    let checksum = payload
        .get("checksum")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let filename = file_path.rsplit('/').next().unwrap_or(file_path);
    let parsed = parse_novel_name(filename);
    let title = parsed.title.clone();

    if title.is_empty() {
        return Ok(Some(
            json!({ "skipped": true, "reason": "empty_or_numeric_title" }),
        ));
    }

    // ── Early dedup by file path ──
    let mf_exists = novel_files::Entity::find()
        .filter(novel_files::Column::SourceId.eq(source_uuid))
        .filter(novel_files::Column::Path.eq(file_path))
        .one(db)
        .await?;
    if mf_exists.is_some() {
        debug!("[novel_scrape] File already indexed: {file_path}");
        return Ok(Some(
            json!({ "skipped": true, "reason": "file_already_indexed" }),
        ));
    }

    // ── Idempotency check ──
    let lock_key = {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        (app_uuid, &title).hash(&mut hasher);
        hasher.finish() as i64
    };

    let txn = db.begin().await?;
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        format!("SELECT pg_advisory_xact_lock({lock_key})"),
        vec![],
    ))
    .await?;

    let existing = novels::Entity::find()
        .filter(novels::Column::AppId.eq(app_uuid))
        .filter(novels::Column::Title.eq(&title))
        .one(&txn)
        .await?;

    if let Some(existing_novel) = existing {
        let mf_exists = novel_files::Entity::find()
            .filter(novel_files::Column::SourceId.eq(source_uuid))
            .filter(novel_files::Column::Path.eq(file_path))
            .one(&txn)
            .await?;
        if mf_exists.is_some() {
            txn.commit().await?;
            return Ok(Some(
                json!({ "skipped": true, "reason": "already_ingested" }),
            ));
        }
        insert_novel_media_file(
            &txn,
            source_uuid,
            existing_novel.id,
            file_path,
            filename,
            file_size,
            checksum,
        )
        .await?;
        txn.commit().await?;
        info!("[novel_scrape] Linked file to existing novel \"{title}\": {file_path}");
        return Ok(Some(
            json!({ "linked": true, "novelId": existing_novel.id.to_string() }),
        ));
    }

    // ── Create new Novel ──
    let novel_id = Uuid::new_v4();
    let now = chrono::Utc::now().fixed_offset();
    let novel = novels::ActiveModel {
        id: Set(novel_id),
        app_id: Set(app_uuid),
        title: Set(title.clone()),
        author: Set(parsed.author.clone()),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        ..Default::default()
    };
    novels::Entity::insert(novel).exec(&txn).await?;
    insert_novel_media_file(
        &txn,
        source_uuid,
        novel_id,
        file_path,
        filename,
        file_size,
        checksum,
    )
    .await?;
    txn.commit().await?;

    info!("[novel_scrape] Created novel \"{title}\" ({novel_id}) from {file_path}");

    // ── Online metadata scrape (Douban + Qidian dual-source) ──
    if let Err(e) = scrape_metadata(db, state, novel_id, &title, parsed.author.as_deref()).await {
        warn!("[novel_scrape] Metadata scrape failed for \"{title}\": {e}");
    }

    Ok(Some(json!({
        "novelId": novel_id.to_string(),
        "title": title,
    })))
}

/// Parsed chapter info from a .txt filename.
struct ChapterInfo {
    number: i32,
    title: Option<String>,
    file_path: String,
}

// ── Chapter number parsing (comprehensive Chinese novel patterns) ────────────

/// Arabic numeral: 第123章, 第123回, 第123节, 第123话, 第123集
static RE_CH_ARABIC: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"第(\d+)[章回节话集]").unwrap());

/// Chinese numeral: 第一章, 第十二回, 第一百零三章, 第两百四十六话
static RE_CH_CHINESE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"第([零一二两三四五六七八九十百千万]+)[章回节话集]").unwrap());

/// English: Chapter 123, Ch.123, Ch 123
static RE_CH_ENGLISH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:chapter|ch\.?)\s*(\d+)").unwrap());

/// Leading digits: 001 标题, `001_标题`, 001.标题, 001-标题
static RE_CH_LEADING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\d{1,5})(?:\s|[._\-])").unwrap());

/// Bare leading number for filenames that are just numbers: 001.txt
static RE_CH_BARE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\d{1,5})$").unwrap());

/// 卷N/Vol N prefix extractor (removed from title)
static RE_VOLUME_PREFIX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:第[零一二两三四五六七八九十百千万\d]+卷|卷[零一二两三四五六七八九十百千万\d]+|[Vv]ol(?:ume)?\.?\s*\d+|正文)\s*").unwrap()
});

/// Convert Chinese numeral string to integer.
/// Handles: 零一二三四五六七八九十百千万两
fn chinese_num_to_i32(s: &str) -> Option<i32> {
    let chars: Vec<char> = s.chars().collect();
    if chars.is_empty() {
        return None;
    }
    let digit = |c: char| -> i32 {
        match c {
            '零' => 0,
            '一' => 1,
            '二' | '两' => 2,
            '三' => 3,
            '四' => 4,
            '五' => 5,
            '六' => 6,
            '七' => 7,
            '八' => 8,
            '九' => 9,
            _ => -1,
        }
    };

    let mut total = 0i32;
    let mut current = 0i32; // accumulator for current section

    for &c in &chars {
        let d = digit(c);
        match c {
            '万' => {
                if current == 0 {
                    current = 1;
                }
                total = (total + current) * 10000;
                current = 0;
            }
            '千' => {
                if current == 0 {
                    current = 1;
                }
                current *= 1000;
            }
            '百' => {
                if current == 0 {
                    current = 1;
                }
                current *= 100;
            }
            '十' => {
                if current == 0 {
                    current = 1;
                }
                current *= 10;
            }
            _ if d >= 0 => {
                current += d;
            }
            _ => return None,
        }
    }
    total += current;
    // Handle "十" alone = 10
    if total == 0 && chars.len() == 1 && chars[0] == '十' {
        return Some(10);
    }
    if total > 0 {
        Some(total)
    } else {
        None
    }
}

/// Extract chapter number from a filename stem. Returns (`chapter_number`, `remaining_text_after_marker`).
fn extract_chapter_number(stem: &str) -> (Option<i32>, String) {
    // Remove volume prefix first: "第一卷 第二章 标题" → "第二章 标题"
    let clean = RE_VOLUME_PREFIX.replace(stem, "");
    let clean = clean.trim();

    // Try Arabic numeral first: 第123章
    if let Some(caps) = RE_CH_ARABIC.captures(clean)
        && let Some(n) = caps.get(1).and_then(|m| m.as_str().parse::<i32>().ok()) {
            let after = clean[caps.get(0).unwrap().end()..].trim_start().to_string();
            return (Some(n), after);
        }

    // Try Chinese numeral: 第一百零三章
    if let Some(caps) = RE_CH_CHINESE.captures(clean)
        && let Some(n) = caps.get(1).and_then(|m| chinese_num_to_i32(m.as_str())) {
            let after = clean[caps.get(0).unwrap().end()..].trim_start().to_string();
            return (Some(n), after);
        }

    // Try English: Chapter 123
    if let Some(caps) = RE_CH_ENGLISH.captures(clean)
        && let Some(n) = caps.get(1).and_then(|m| m.as_str().parse::<i32>().ok()) {
            let after = clean[caps.get(0).unwrap().end()..].trim_start().to_string();
            return (Some(n), after);
        }

    // Try leading number: 001 标题
    if let Some(caps) = RE_CH_LEADING.captures(clean)
        && let Some(n) = caps.get(1).and_then(|m| m.as_str().parse::<i32>().ok()) {
            let after = clean[caps.get(0).unwrap().end()..].trim_start().to_string();
            return (Some(n), after);
        }

    // Try bare number: just "001"
    if let Some(caps) = RE_CH_BARE.captures(clean)
        && let Some(n) = caps.get(1).and_then(|m| m.as_str().parse::<i32>().ok()) {
            return (Some(n), String::new());
        }

    (None, clean.to_string())
}

/// Extract the chapter title from remaining text after the chapter marker.
/// Handles double-numbering: "第二百零六章 标题" → "标题"
fn extract_chapter_title(remaining: &str) -> Option<String> {
    if remaining.is_empty() {
        return None;
    }
    // If remaining starts with another chapter marker (double numbering: "第二百零六章 标题"),
    // skip it and take the rest as title
    let text = RE_CH_ARABIC.replace(remaining, "").to_string();
    let text = RE_CH_CHINESE.replace(&text, "").to_string();
    let text = text.trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Parse chapter files from JSON payload into `ChapterInfo` structs.
fn parse_chapter_files(files: &[JsonValue]) -> Vec<ChapterInfo> {
    let mut result = Vec::with_capacity(files.len());

    for (idx, cf) in files.iter().enumerate() {
        let fp = cf.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
        if fp.is_empty() {
            continue;
        }
        let filename = fp.rsplit('/').next().unwrap_or(fp);
        let stem = strip_ext(filename).trim();

        let (number_opt, remaining) = extract_chapter_number(stem);
        let number = number_opt.unwrap_or((idx + 1) as i32);
        let title = extract_chapter_title(&remaining);

        result.push(ChapterInfo {
            number,
            title,
            file_path: fp.to_string(),
        });
    }

    result
}

/// Insert a `novel_chapters` record.
async fn insert_novel_chapter(
    db: &impl ConnectionTrait,
    novel_id: Uuid,
    ch: &ChapterInfo,
) -> Result<(), BoxError> {
    let now = chrono::Utc::now().fixed_offset();
    let model = novel_chapters::ActiveModel {
        id: Set(Uuid::new_v4()),
        novel_id: Set(novel_id),
        chapter_number: Set(ch.number),
        title: Set(ch.title.clone()),
        file_path: Set(Some(ch.file_path.clone())),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        ..Default::default()
    };
    novel_chapters::Entity::insert(model).exec(db).await?;
    Ok(())
}

/// Insert a media file record for a standalone novel file (epub/mobi/pdf/etc).
async fn insert_novel_media_file(
    db: &impl ConnectionTrait,
    source_uuid: Uuid,
    novel_id: Uuid,
    file_path: &str,
    filename: &str,
    file_size: i64,
    checksum: &str,
) -> Result<(), BoxError> {
    let mf_id = Uuid::new_v4();
    let now = chrono::Utc::now().fixed_offset();
    let ext = StdPath::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let mime = novel_mime(ext);
    let model = novel_files::ActiveModel {
        id: Set(mf_id),
        source_id: Set(Some(source_uuid)),
        path: Set(file_path.to_string()),
        filename: Set(filename.to_string()),
        size: Set(if file_size > 0 { Some(file_size) } else { None }),
        checksum: Set(Some(checksum.to_string())),
        mime_type: Set(Some(mime.to_string())),
        novel_id: Set(Some(novel_id)),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        ..Default::default()
    };
    novel_files::Entity::insert(model).exec(db).await?;
    Ok(())
}

/// Create a `DoubanClient` from config (same pattern as TMDB for movies).
async fn create_douban_client(
    db: &DatabaseConnection,
    http_client: reqwest::Client,
) -> Option<DoubanClient> {
    let settings = SystemConfigRepo::get::<DoubanSettings>(db).await.ok()?;
    if settings.cookie.is_none() && settings.api_key.is_none() {
        // Scraping mode (no cookie) still works for book detail pages
        return Some(DoubanClient::new(DoubanConfig {
            cookie: None,
            api_key: None,
            proxy_url: None,
            cache_ttl: None,
            http_client,
        }));
    }
    Some(DoubanClient::new(DoubanConfig {
        cookie: settings.cookie,
        api_key: settings.api_key,
        proxy_url: None,
        cache_ttl: None,
        http_client,
    }))
}

/// Create a `QidianClient` (no special config needed — just HTTP client).
fn create_qidian_client(http_client: reqwest::Client) -> QidianClient {
    QidianClient::new(QidianConfig {
        http_client,
        cache_ttl: None,
    })
}

/// Scrape novel metadata from Douban + Qidian (dual-source, like TMDB + IMDB for movies).
///
/// Tries both sources and merges results:
/// - Douban: rating, ISBN, publisher, year, overview, cover
/// - Qidian: `serial_status`, `word_count`, `qidian_id`
async fn scrape_metadata(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    novel_id: Uuid,
    title: &str,
    author: Option<&str>,
) -> Result<(), BoxError> {
    let http = state.http_client.clone();

    // Try Douban
    let douban_result = scrape_from_douban(db, state, novel_id, title, author).await;
    if let Err(ref e) = douban_result {
        warn!("[novel_scrape] Douban scrape failed for \"{title}\": {e}");
    }

    // Try Qidian
    let qidian_result = scrape_from_qidian(db, state, novel_id, title, author, http.clone()).await;
    if let Err(ref e) = qidian_result {
        warn!("[novel_scrape] Qidian scrape failed for \"{title}\": {e}");
    }

    let douban_ok = douban_result.is_ok();
    let qidian_ok = qidian_result.is_ok();

    if douban_ok || qidian_ok {
        info!(
            "[novel_scrape] Metadata scrape for \"{title}\": douban={}, qidian={}",
            if douban_ok { "ok" } else { "fail" },
            if qidian_ok { "ok" } else { "fail" },
        );
    }

    Ok(())
}

/// Scrape novel metadata from Douban Books — search → match → fetch detail → update.
async fn scrape_from_douban(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    novel_id: Uuid,
    title: &str,
    author: Option<&str>,
) -> Result<(), BoxError> {
    let Some(douban) = create_douban_client(db, state.http_client.clone()).await else {
        debug!("[novel_scrape] Douban client not configured, skipping scrape");
        return Ok(());
    };

    // Search Douban Books
    let candidates =
        match tokio::time::timeout(Duration::from_secs(10), douban.search_books(title)).await {
            Ok(Ok(items)) => items,
            Ok(Err(e)) => {
                warn!("[novel_scrape] Douban search failed: {e}");
                return Ok(());
            }
            Err(_) => {
                warn!("[novel_scrape] Douban search timed out for \"{title}\"");
                return Ok(());
            }
        };

    if candidates.is_empty() {
        info!("[novel_scrape] No Douban results for \"{title}\"");
        return Ok(());
    }

    // Score candidates — match by title and author
    let norm_title = normalize_for_matching(title);
    let norm_author = author.map(normalize_for_matching).unwrap_or_default();

    let mut best: Option<(
        &rust_client_api::metadata_providers::douban::DoubanSearchItem,
        i32,
    )> = None;
    for c in &candidates {
        let mut score = 0i32;
        let ct = normalize_for_matching(&c.title);
        if ct == norm_title {
            score += 100;
        } else if ct.contains(&norm_title) || norm_title.contains(&ct) {
            score += 50;
        } else {
            continue;
        }

        if !norm_author.is_empty()
            && let Some(ref subtitle) = c.original_title {
                let cs = normalize_for_matching(subtitle);
                if cs.contains(&norm_author) || norm_author.contains(&cs) {
                    score += 25;
                }
            }

        match &best {
            Some((_, bs)) if score <= *bs => {}
            _ => best = Some((c, score)),
        }
    }

    let Some((best_match, _)) = best else {
        info!("[novel_scrape] No matching Douban candidate for \"{title}\"");
        return Ok(());
    };

    info!(
        "[novel_scrape] Douban match for \"{title}\": {} ({})",
        best_match.title, best_match.douban_id
    );

    // Fetch detailed book info
    let book_detail = match tokio::time::timeout(
        Duration::from_secs(15),
        douban.get_book_detail(&best_match.douban_id),
    )
    .await
    {
        Ok(Ok(Some(d))) => d,
        Ok(Ok(None)) => {
            warn!(
                "[novel_scrape] Douban detail returned empty for {}",
                best_match.douban_id
            );
            return Ok(());
        }
        Ok(Err(e)) => {
            warn!("[novel_scrape] Douban get_book_detail failed: {e}");
            return Ok(());
        }
        Err(_) => {
            warn!("[novel_scrape] Douban get_book_detail timed out");
            return Ok(());
        }
    };

    // Update novel record with Douban metadata
    update_novel_from_douban(db, novel_id, &book_detail).await?;

    // Download and upload cover image
    if let Some(ref cover_url) = book_detail.cover_url
        && !cover_url.is_empty() {
            match download_and_upload_cover(state, novel_id, cover_url).await {
                Ok(cover_path) => {
                    let mut active: novels::ActiveModel = novels::Entity::find_by_id(novel_id)
                        .one(db)
                        .await?
                        .ok_or("Novel disappeared during cover upload")?
                        .into();
                    active.cover_path = Set(Some(cover_path.clone()));
                    active.update(db).await?;
                    info!("[novel_scrape] Uploaded cover for \"{title}\": {cover_path}");
                }
                Err(e) => {
                    warn!("[novel_scrape] Cover download failed: {e}");
                }
            }
        }

    info!("[novel_scrape] Douban scrape complete for \"{title}\"");
    Ok(())
}

/// Update a Novel record with data from Douban Books.
async fn update_novel_from_douban(
    db: &DatabaseConnection,
    novel_id: Uuid,
    detail: &DoubanBookDetail,
) -> Result<(), BoxError> {
    let mut active: novels::ActiveModel = novels::Entity::find_by_id(novel_id)
        .one(db)
        .await?
        .ok_or("Novel disappeared during Douban scrape")?
        .into();

    if let Some(ref author) = detail.author {
        active.author = Set(Some(author.clone()));
    }
    if let Some(ref overview) = detail.overview {
        active.overview = Set(Some(overview.clone()));
    }
    if let Some(ref original_title) = detail.original_title {
        active.original_title = Set(Some(original_title.clone()));
    }
    if let Some(ref publisher) = detail.publisher {
        active.publisher = Set(Some(publisher.clone()));
    }
    if let Some(ref isbn) = detail.isbn {
        active.isbn = Set(Some(isbn.clone()));
    }
    if let Some(ref year) = detail.year {
        // Extract 4-digit year from date string like "2003-8"
        if let Ok(y) = year.chars().take(4).collect::<String>().parse::<i32>() {
            active.year = Set(Some(y));
        }
    }
    active.douban_id = Set(Some(detail.douban_id.clone()));
    if let Some(rating) = detail.rating {
        active.douban_rating = Set(Some(rating));
    }
    active.source_provider = Set(Some("douban".to_string()));
    active.source_book_id = Set(Some(detail.douban_id.clone()));
    active.source_url = Set(Some(format!(
        "https://book.douban.com/subject/{}/",
        detail.douban_id
    )));
    active.scraped_at = Set(Some(chrono::Utc::now().fixed_offset()));
    active.updated_at = Set(Some(chrono::Utc::now().fixed_offset()));
    active.update(db).await?;

    Ok(())
}

/// Scrape novel metadata from Qidian (起点中文网) — search → match → detail → update.
///
/// Supplements Douban with `serial_status`, `word_count`, and `qidian_id`.
async fn scrape_from_qidian(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    novel_id: Uuid,
    title: &str,
    author: Option<&str>,
    http_client: reqwest::Client,
) -> Result<(), BoxError> {
    let qidian = create_qidian_client(http_client);

    // Search Qidian
    let candidates =
        match tokio::time::timeout(Duration::from_secs(10), qidian.search_books(title)).await {
            Ok(Ok(items)) => items,
            Ok(Err(e)) => {
                warn!("[novel_scrape] Qidian search failed: {e}");
                return Ok(());
            }
            Err(_) => {
                warn!("[novel_scrape] Qidian search timed out for \"{title}\"");
                return Ok(());
            }
        };

    if candidates.is_empty() {
        info!("[novel_scrape] No Qidian results for \"{title}\"");
        return Ok(());
    }

    // Score candidates — match by title and optionally author
    let norm_title = normalize_for_matching(title);
    let norm_author = author.map(normalize_for_matching).unwrap_or_default();

    let mut best: Option<(&QidianSearchItem, i32)> = None;
    for c in &candidates {
        let mut score = 0i32;
        let ct = normalize_for_matching(&c.title);
        if ct == norm_title {
            score += 100;
        } else if ct.contains(&norm_title) || norm_title.contains(&ct) {
            score += 50;
        } else {
            continue;
        }

        if !norm_author.is_empty()
            && let Some(ref a) = c.author {
                let ca = normalize_for_matching(a);
                if ca == norm_author || ca.contains(&norm_author) || norm_author.contains(&ca) {
                    score += 25;
                }
            }

        match &best {
            Some((_, bs)) if score <= *bs => {}
            _ => best = Some((c, score)),
        }
    }

    let Some((best_match, _)) = best else {
        info!("[novel_scrape] No matching Qidian candidate for \"{title}\"");
        return Ok(());
    };

    info!(
        "[novel_scrape] Qidian match for \"{title}\": {} ({})",
        best_match.title, best_match.qidian_id
    );

    // Fetch detailed book info
    let book_detail = match tokio::time::timeout(
        Duration::from_secs(15),
        qidian.get_book_detail(&best_match.qidian_id),
    )
    .await
    {
        Ok(Ok(Some(d))) => d,
        Ok(Ok(None)) => {
            // Fall back to using search result data
            info!(
                "[novel_scrape] Qidian detail page unavailable, using search data for {}",
                best_match.qidian_id
            );
            update_novel_from_qidian_search(db, novel_id, best_match).await?;
            return Ok(());
        }
        Ok(Err(e)) => {
            warn!("[novel_scrape] Qidian get_book_detail failed: {e}");
            // Still use search result data as fallback
            update_novel_from_qidian_search(db, novel_id, best_match).await?;
            return Ok(());
        }
        Err(_) => {
            warn!("[novel_scrape] Qidian get_book_detail timed out");
            update_novel_from_qidian_search(db, novel_id, best_match).await?;
            return Ok(());
        }
    };

    // Update novel record with Qidian metadata (supplements Douban, doesn't overwrite)
    update_novel_from_qidian(db, novel_id, &book_detail).await?;

    // If no cover yet, try Qidian cover
    let novel = novels::Entity::find_by_id(novel_id).one(db).await?;
    if let Some(novel) = novel
        && novel.cover_path.is_none()
            && let Some(ref cover_url) = book_detail.cover_url
                && !cover_url.is_empty() {
                    match download_and_upload_cover(state, novel_id, cover_url).await {
                        Ok(cover_path) => {
                            let mut active: novels::ActiveModel = novel.into();
                            active.cover_path = Set(Some(cover_path.clone()));
                            active.update(db).await?;
                            info!(
                                "[novel_scrape] Uploaded Qidian cover for \"{title}\": {cover_path}"
                            );
                        }
                        Err(e) => {
                            warn!("[novel_scrape] Qidian cover download failed: {e}");
                        }
                    }
                }

    info!("[novel_scrape] Qidian scrape complete for \"{title}\"");
    Ok(())
}

/// Update a Novel record with Qidian metadata.
/// Only fills fields that are currently empty (supplements Douban, doesn't overwrite).
async fn update_novel_from_qidian(
    db: &DatabaseConnection,
    novel_id: Uuid,
    detail: &QidianBookDetail,
) -> Result<(), BoxError> {
    let novel = novels::Entity::find_by_id(novel_id)
        .one(db)
        .await?
        .ok_or("Novel disappeared during Qidian scrape")?;
    let mut active: novels::ActiveModel = novel.clone().into();

    active.qidian_id = Set(Some(detail.qidian_id.clone()));

    // Only fill empty fields — don't overwrite Douban data
    if novel.author.is_none()
        && let Some(ref author) = detail.author {
            active.author = Set(Some(author.clone()));
        }
    if novel.overview.is_none()
        && let Some(ref intro) = detail.intro {
            active.overview = Set(Some(intro.clone()));
        }
    if novel.serial_status.is_none()
        && let Some(ref status) = detail.serial_status {
            let normalized = normalize_serial_status(status);
            active.serial_status = Set(Some(normalized));
        }
    if novel.word_count.is_none()
        && let Some(ref wc) = detail.word_count
            && let Some(count) = parse_word_count(wc) {
                active.word_count = Set(Some(count));
            }

    active.updated_at = Set(Some(chrono::Utc::now().fixed_offset()));
    active.update(db).await?;
    Ok(())
}

/// Update from Qidian search result (fallback when detail page is unavailable).
async fn update_novel_from_qidian_search(
    db: &DatabaseConnection,
    novel_id: Uuid,
    item: &QidianSearchItem,
) -> Result<(), BoxError> {
    let novel = novels::Entity::find_by_id(novel_id)
        .one(db)
        .await?
        .ok_or("Novel disappeared during Qidian scrape")?;
    let mut active: novels::ActiveModel = novel.clone().into();

    active.qidian_id = Set(Some(item.qidian_id.clone()));

    if novel.author.is_none()
        && let Some(ref author) = item.author {
            active.author = Set(Some(author.clone()));
        }
    if novel.serial_status.is_none()
        && let Some(ref status) = item.serial_status {
            let normalized = normalize_serial_status(status);
            active.serial_status = Set(Some(normalized));
        }
    if novel.word_count.is_none()
        && let Some(ref wc) = item.word_count
            && let Some(count) = parse_word_count(wc) {
                active.word_count = Set(Some(count));
            }

    active.updated_at = Set(Some(chrono::Utc::now().fixed_offset()));
    active.update(db).await?;
    Ok(())
}

/// Normalize Qidian serial status to our standard values.
fn normalize_serial_status(status: &str) -> String {
    if status.contains("完本") || status.contains("完结") {
        "completed".to_string()
    } else if status.contains("连载") {
        "ongoing".to_string()
    } else {
        "unknown".to_string()
    }
}

/// Parse word count string like "530万字", "5309891字", "530万" into integer.
fn parse_word_count(s: &str) -> Option<i32> {
    let s = s.trim().replace('字', "");
    if s.contains('万') {
        let num_str = s.replace('万', "");
        let n: f64 = num_str.trim().parse().ok()?;
        Some((n * 10000.0) as i32)
    } else {
        s.trim().parse::<i32>().ok()
    }
}

/// Download a cover image and upload to object storage.
async fn download_and_upload_cover(
    state: &Arc<AppState>,
    novel_id: Uuid,
    cover_url: &str,
) -> Result<String, BoxError> {
    // Use appropriate Referer based on the cover URL domain
    let referer = if cover_url.contains("douban") {
        "https://book.douban.com/"
    } else if cover_url.contains("qidian") || cover_url.contains("yuewen") {
        "https://www.qidian.com/"
    } else {
        ""
    };

    let mut req = state
        .http_client
        .get(cover_url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        .timeout(Duration::from_secs(15));

    if !referer.is_empty() {
        req = req.header("Referer", referer);
    }

    let resp = req.send().await?;

    if !resp.status().is_success() {
        return Err(format!("Cover HTTP {}", resp.status()).into());
    }

    let bytes = resp.bytes().await?;

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

    let storage_key = format!("app-images/novels/{novel_id}/cover.{ext}");

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
        .map_err(|e| format!("Storage upload failed: {e}"))?;

    Ok(format!("/storage/{storage_key}"))
}

/// Normalize a string for fuzzy matching — lowercase, alphanumeric + CJK only
fn normalize_for_matching(s: &str) -> String {
    s.trim()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

/// Map novel file extension to MIME type.
fn novel_mime(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "epub" => "application/epub+zip",
        "mobi" => "application/x-mobipocket-ebook",
        "azw3" => "application/vnd.amazon.ebook",
        "pdf" => "application/pdf",
        "cbz" => "application/x-cbz",
        "txt" => "text/plain",
        _ => "application/octet-stream",
    }
}
