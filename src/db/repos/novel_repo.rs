use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseConnection,
    EntityTrait, Order, QueryFilter, QueryOrder, Set, Statement,
};
use uuid::Uuid;

use crate::db::entities::{app_file_systems, novel_files, novel_chapters, novel_volumes, novels};
use crate::error::AppError;
use crate::error::OptionExt;

// ── Input structs ────────────────────────────────────────────────────────────

pub struct CreateNovelInput {
    pub id: Uuid,
    pub app_id: Uuid,
    pub title: String,
    pub author: Option<String>,
    pub overview: Option<String>,
    pub serial_status: Option<String>,
    pub word_count: Option<i32>,
    pub year: Option<i32>,
    pub source_provider: Option<String>,
    pub source_book_id: Option<String>,
}

pub struct InsertVolumeInput {
    pub id: Uuid,
    pub novel_id: Uuid,
    pub volume_number: i32,
    pub title: Option<String>,
    pub chapter_count: Option<i32>,
}

pub struct InsertChapterInput {
    pub id: Uuid,
    pub novel_id: Uuid,
    pub volume_id: Option<Uuid>,
    pub chapter_number: i32,
    pub title: Option<String>,
    pub word_count: Option<i32>,
    pub file_path: Option<String>,
    pub is_vip: bool,
}

// ── Helpers ──

fn col<T: sea_orm::TryGetable>(r: &sea_orm::QueryResult, c: &str) -> Result<T, AppError> {
    r.try_get::<T>("", c)
        .map_err(|e| AppError::Internal(format!("col '{c}': {e:?}")))
}

fn opt<T: sea_orm::TryGetable>(r: &sea_orm::QueryResult, c: &str) -> Option<T> {
    r.try_get::<Option<T>>("", c).ok().flatten()
}

fn dir(d: &str) -> &'static str {
    if d.eq_ignore_ascii_case("desc") {
        "DESC"
    } else {
        "ASC"
    }
}

pub struct NovelRepo;

impl NovelRepo {
    /// Paginated novel list for an app, with chapter/volume counts.
    pub async fn list_novels(
        db: &DatabaseConnection,
        app_id: Uuid,
        page: i64,
        page_size: i64,
        sort_by: &str,
        sort_dir: &str,
        search: Option<&str>,
    ) -> Result<(Vec<serde_json::Value>, i64), AppError> {
        let order_col = match sort_by {
            "year" => "n.year",
            "wordCount" => "n.word_count",
            "addedAt" | "createdAt" => "n.created_at",
            "author" => "n.author",
            _ => "n.title",
        };
        let order_dir = dir(sort_dir);

        let mut where_clauses = vec!["n.app_id = $1".to_string()];
        let mut params: Vec<sea_orm::Value> = vec![app_id.into()];
        let mut param_idx = 2u32;

        if let Some(s) = search
            && !s.is_empty() {
                where_clauses.push(format!(
                    "(n.title ILIKE ${param_idx} OR n.author ILIKE ${param_idx})"
                ));
                params.push(format!("%{s}%").into());
                param_idx += 1;
            }

        let where_sql = where_clauses.join(" AND ");

        // Count
        let count_sql = format!("SELECT COUNT(*) as cnt FROM novels n WHERE {where_sql}");
        let count_stmt =
            Statement::from_sql_and_values(DatabaseBackend::Postgres, &count_sql, params.clone());
        let total: i64 = db
            .query_one_raw(count_stmt)
            .await?
            .map(|r| col::<i64>(&r, "cnt").unwrap_or(0))
            .unwrap_or(0);

        // Items
        let limit_param = param_idx;
        let offset_param = param_idx + 1;
        let items_sql = format!(
            r#"SELECT n.id, n.title, n.author, n.overview, n.cover_path, n.serial_status,
                      n.word_count, n.year, n.source_provider, n.is_favorite,
                      n.scraped_at::text as scraped_at, n.created_at,
                      (SELECT COUNT(*) FROM novel_chapters nc WHERE nc.novel_id = n.id) as chapter_count,
                      (SELECT COUNT(*) FROM novel_volumes nv WHERE nv.novel_id = n.id) as volume_count
               FROM novels n
               WHERE {where_sql}
               ORDER BY {order_col} {order_dir} NULLS LAST
               LIMIT ${limit_param} OFFSET ${offset_param}"#
        );
        params.push(page_size.into());
        params.push(((page - 1) * page_size).into());

        let items_stmt =
            Statement::from_sql_and_values(DatabaseBackend::Postgres, &items_sql, params);
        let rows = db.query_all_raw(items_stmt).await?;

        let items: Vec<serde_json::Value> = rows
            .iter()
            .map(|r| {
                serde_json::json!({
                    "id": col::<Uuid>(r, "id").unwrap_or_default().to_string(),
                    "title": col::<String>(r, "title").unwrap_or_default(),
                    "author": opt::<String>(r, "author"),
                    "overview": opt::<String>(r, "overview"),
                    "coverPath": opt::<String>(r, "cover_path"),
                    "serialStatus": opt::<String>(r, "serial_status"),
                    "wordCount": opt::<i32>(r, "word_count"),
                    "year": opt::<i32>(r, "year"),
                    "sourceProvider": opt::<String>(r, "source_provider"),
                    "isFavorite": col::<bool>(r, "is_favorite").unwrap_or(false),
                    "chapterCount": col::<i64>(r, "chapter_count").unwrap_or(0),
                    "volumeCount": col::<i64>(r, "volume_count").unwrap_or(0),
                    "scrapedAt": opt::<String>(r, "scraped_at"),
                    "createdAt": opt::<chrono::DateTime<chrono::FixedOffset>>(r, "created_at")
                        .map(|d| d.to_rfc3339()),
                })
            })
            .collect();

        Ok((items, total))
    }

    /// Get a single novel by ID.
    pub async fn get_by_id(
        db: &DatabaseConnection,
        id: Uuid,
    ) -> Result<Option<novels::Model>, AppError> {
        Ok(novels::Entity::find_by_id(id).one(db).await?)
    }

    /// Get all volumes for a novel, ordered by volume_number.
    pub async fn get_volumes(
        db: &DatabaseConnection,
        novel_id: Uuid,
    ) -> Result<Vec<novel_volumes::Model>, AppError> {
        Ok(novel_volumes::Entity::find()
            .filter(novel_volumes::Column::NovelId.eq(novel_id))
            .order_by_asc(novel_volumes::Column::VolumeNumber)
            .all(db)
            .await?)
    }

    /// Get all chapters for a novel, ordered by chapter_number.
    pub async fn get_chapters(
        db: &DatabaseConnection,
        novel_id: Uuid,
    ) -> Result<Vec<novel_chapters::Model>, AppError> {
        Ok(novel_chapters::Entity::find()
            .filter(novel_chapters::Column::NovelId.eq(novel_id))
            .order_by_asc(novel_chapters::Column::ChapterNumber)
            .all(db)
            .await?)
    }

    /// Get a single chapter by ID.
    pub async fn get_chapter_by_id(
        db: &DatabaseConnection,
        id: Uuid,
    ) -> Result<Option<novel_chapters::Model>, AppError> {
        Ok(novel_chapters::Entity::find_by_id(id).one(db).await?)
    }

    /// Get the previous chapter (by chapter_number) within the same novel.
    pub async fn get_prev_chapter(
        db: &DatabaseConnection,
        novel_id: Uuid,
        chapter_number: i32,
    ) -> Result<Option<novel_chapters::Model>, AppError> {
        Ok(novel_chapters::Entity::find()
            .filter(novel_chapters::Column::NovelId.eq(novel_id))
            .filter(novel_chapters::Column::ChapterNumber.lt(chapter_number))
            .order_by(novel_chapters::Column::ChapterNumber, Order::Desc)
            .one(db)
            .await?)
    }

    /// Get the next chapter (by chapter_number) within the same novel.
    pub async fn get_next_chapter(
        db: &DatabaseConnection,
        novel_id: Uuid,
        chapter_number: i32,
    ) -> Result<Option<novel_chapters::Model>, AppError> {
        Ok(novel_chapters::Entity::find()
            .filter(novel_chapters::Column::NovelId.eq(novel_id))
            .filter(novel_chapters::Column::ChapterNumber.gt(chapter_number))
            .order_by_asc(novel_chapters::Column::ChapterNumber)
            .one(db)
            .await?)
    }

    /// Get files linked to a novel.
    pub async fn get_novel_files(
        db: &DatabaseConnection,
        novel_id: Uuid,
    ) -> Result<Vec<novel_files::Model>, AppError> {
        Ok(novel_files::Entity::find()
            .filter(novel_files::Column::NovelId.eq(novel_id))
            .all(db)
            .await?)
    }

    /// Get the first app_file_system source for an app.
    pub async fn get_app_source(
        db: &DatabaseConnection,
        app_id: Uuid,
    ) -> Result<Option<app_file_systems::Model>, AppError> {
        Ok(app_file_systems::Entity::find()
            .filter(app_file_systems::Column::AppId.eq(app_id))
            .one(db)
            .await?)
    }

    /// Insert a new novel record.
    pub async fn create(db: &DatabaseConnection, input: CreateNovelInput) -> Result<(), AppError> {
        let now = chrono::Utc::now().fixed_offset();
        let active = novels::ActiveModel {
            id: Set(input.id),
            app_id: Set(input.app_id),
            title: Set(input.title),
            author: Set(input.author),
            overview: Set(input.overview),
            serial_status: Set(input.serial_status),
            word_count: Set(input.word_count),
            year: Set(input.year),
            source_provider: Set(input.source_provider),
            source_book_id: Set(input.source_book_id),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            ..Default::default()
        };
        novels::Entity::insert(active).exec(db).await?;
        Ok(())
    }

    /// Update the cover image path for a novel.
    pub async fn update_cover_path(
        db: &DatabaseConnection,
        novel_id: Uuid,
        path: String,
    ) -> Result<(), AppError> {
        let now = chrono::Utc::now().fixed_offset();
        let model = novels::Entity::find_by_id(novel_id)
            .one(db)
            .await?
            .not_found("Novel not found")?;
        let mut active: novels::ActiveModel = model.into();
        active.cover_path = Set(Some(path));
        active.updated_at = Set(Some(now));
        active.update(db).await?;
        Ok(())
    }

    /// Insert a novel volume.
    pub async fn insert_volume(
        db: &DatabaseConnection,
        input: InsertVolumeInput,
    ) -> Result<(), AppError> {
        let now = chrono::Utc::now().fixed_offset();
        let active = novel_volumes::ActiveModel {
            id: Set(input.id),
            novel_id: Set(input.novel_id),
            volume_number: Set(input.volume_number),
            title: Set(input.title),
            chapter_count: Set(input.chapter_count),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            ..Default::default()
        };
        novel_volumes::Entity::insert(active).exec(db).await?;
        Ok(())
    }

    /// Insert a novel chapter.
    pub async fn insert_chapter(
        db: &DatabaseConnection,
        input: InsertChapterInput,
    ) -> Result<(), AppError> {
        let now = chrono::Utc::now().fixed_offset();
        let active = novel_chapters::ActiveModel {
            id: Set(input.id),
            novel_id: Set(input.novel_id),
            volume_id: Set(input.volume_id),
            chapter_number: Set(input.chapter_number),
            title: Set(input.title),
            word_count: Set(input.word_count),
            file_path: Set(input.file_path),
            is_vip: Set(input.is_vip),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            ..Default::default()
        };
        novel_chapters::Entity::insert(active).exec(db).await?;
        Ok(())
    }

    /// Get a single novel volume by ID.
    pub async fn get_volume_by_id(
        db: &DatabaseConnection,
        volume_id: Uuid,
    ) -> Result<Option<novel_volumes::Model>, AppError> {
        Ok(novel_volumes::Entity::find_by_id(volume_id).one(db).await?)
    }
}
