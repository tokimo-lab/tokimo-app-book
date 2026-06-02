use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set, prelude::*,
    sea_query::Expr,
};
use uuid::Uuid;

use crate::{
    db::entities::items::{self, ActiveModel as ItemsActive, Entity as Items},
    error::AppError,
};

pub struct ItemsRepo;

pub struct CreateItemParams {
    pub container_id: Uuid,
    pub title: String,
    pub author: Option<String>,
    pub file_path: String,
    pub format: String,
    pub size_bytes: Option<i64>,
    pub content: Option<String>,
    pub metadata: serde_json::Value,
}

pub struct UpdateItemParams {
    pub title: Option<String>,
    pub author: Option<String>,
    pub file_path: Option<String>,
    pub format: Option<String>,
    pub size_bytes: Option<i64>,
    pub content: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

impl ItemsRepo {
    pub async fn list_by_container<C: ConnectionTrait>(
        db: &C,
        container_id: Uuid,
        page: u64,
        page_size: u64,
        search: Option<&str>,
    ) -> Result<(Vec<items::Model>, u64), AppError> {
        let page = page.max(1);
        let page_size = page_size.clamp(1, 200);
        let offset = (page - 1) * page_size;

        let mut query = Items::find().filter(items::Column::ContainerId.eq(container_id));
        if let Some(search) = search.filter(|s| !s.trim().is_empty()) {
            let pattern = format!("%{}%", search.trim());
            query = query.filter(
                sea_orm::Condition::any()
                    .add(items::Column::Title.like(&pattern))
                    .add(items::Column::Author.like(&pattern)),
            );
        }
        let total = query.clone().count(db).await?;
        let items = query
            .order_by_asc(items::Column::Title)
            .order_by_asc(items::Column::Id)
            .limit(page_size)
            .offset(offset)
            .all(db)
            .await?;

        Ok((items, total))
    }

    pub async fn get_by_id<C: ConnectionTrait>(db: &C, id: Uuid) -> Result<Option<items::Model>, AppError> {
        Ok(Items::find_by_id(id).one(db).await?)
    }

    pub async fn create<C: ConnectionTrait>(db: &C, params: CreateItemParams) -> Result<items::Model, AppError> {
        let now = chrono::Utc::now().into();
        let am = ItemsActive {
            container_id: Set(params.container_id),
            title: Set(params.title),
            author: Set(params.author),
            file_path: Set(params.file_path),
            format: Set(params.format),
            size_bytes: Set(params.size_bytes),
            content: Set(params.content),
            metadata: Set(params.metadata),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        Ok(Items::insert(am).exec_with_returning(db).await?)
    }

    pub async fn update<C: ConnectionTrait>(
        db: &C,
        id: Uuid,
        params: UpdateItemParams,
    ) -> Result<items::Model, AppError> {
        let mut stmt = Items::update_many()
            .filter(items::Column::Id.eq(id))
            .col_expr(items::Column::UpdatedAt, Expr::value(chrono::Utc::now().fixed_offset()));
        if let Some(v) = params.title {
            stmt = stmt.col_expr(items::Column::Title, Expr::value(v));
        }
        if let Some(v) = params.author {
            stmt = stmt.col_expr(items::Column::Author, Expr::value(Some(v)));
        }
        if let Some(v) = params.file_path {
            stmt = stmt.col_expr(items::Column::FilePath, Expr::value(v));
        }
        if let Some(v) = params.format {
            stmt = stmt.col_expr(items::Column::Format, Expr::value(v));
        }
        if let Some(v) = params.size_bytes {
            stmt = stmt.col_expr(items::Column::SizeBytes, Expr::value(Some(v)));
        }
        if let Some(v) = params.content {
            stmt = stmt.col_expr(items::Column::Content, Expr::value(Some(v)));
        }
        if let Some(v) = params.metadata {
            stmt = stmt.col_expr(items::Column::Metadata, Expr::value(v));
        }
        let mut results = stmt.exec_with_returning(db).await?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| AppError::NotFound(format!("item {id} not found")))
    }

    pub async fn get_by_file_path<C: ConnectionTrait>(
        db: &C,
        container_id: Uuid,
        file_path: &str,
    ) -> Result<Option<items::Model>, AppError> {
        Ok(Items::find()
            .filter(items::Column::ContainerId.eq(container_id))
            .filter(items::Column::FilePath.eq(file_path))
            .one(db)
            .await?)
    }

    pub async fn upsert_scanned_file<C: ConnectionTrait>(
        db: &C,
        params: CreateItemParams,
    ) -> Result<items::Model, AppError> {
        if Self::get_by_file_path(db, params.container_id, &params.file_path)
            .await?
            .is_some()
        {
            let mut results = Items::update_many()
                .filter(items::Column::ContainerId.eq(params.container_id))
                .filter(items::Column::FilePath.eq(&params.file_path))
                .col_expr(items::Column::Title, Expr::value(params.title))
                .col_expr(items::Column::Author, Expr::value(params.author))
                .col_expr(items::Column::Format, Expr::value(params.format))
                .col_expr(items::Column::SizeBytes, Expr::value(params.size_bytes))
                .col_expr(items::Column::Content, Expr::value(params.content))
                .col_expr(items::Column::Metadata, Expr::value(params.metadata))
                .col_expr(items::Column::UpdatedAt, Expr::value(chrono::Utc::now().fixed_offset()))
                .exec_with_returning(db)
                .await?;
            return results
                .into_iter()
                .next()
                .ok_or_else(|| AppError::NotFound("item not found".into()));
        }
        Self::create(db, params).await
    }

    pub async fn count_by_container<C: ConnectionTrait>(db: &C, container_id: Uuid) -> Result<i64, AppError> {
        Ok(Items::find()
            .filter(items::Column::ContainerId.eq(container_id))
            .count(db)
            .await? as i64)
    }

    pub async fn delete<C: ConnectionTrait>(db: &C, id: Uuid) -> Result<(), AppError> {
        Items::delete_by_id(id).exec(db).await?;
        Ok(())
    }
}
