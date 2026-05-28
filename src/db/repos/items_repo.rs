use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set, prelude::*,
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
    ) -> Result<(Vec<items::Model>, u64), AppError> {
        let page = page.max(1);
        let page_size = page_size.clamp(1, 200);
        let offset = (page - 1) * page_size;

        let total = Items::find()
            .filter(items::Column::ContainerId.eq(container_id))
            .count(db)
            .await?;
        let items = Items::find()
            .filter(items::Column::ContainerId.eq(container_id))
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
        let model = Items::find_by_id(id)
            .one(db)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("item {id} not found")))?;
        let mut am: ItemsActive = model.into();
        if let Some(v) = params.title {
            am.title = Set(v);
        }
        if let Some(v) = params.author {
            am.author = Set(Some(v));
        }
        if let Some(v) = params.file_path {
            am.file_path = Set(v);
        }
        if let Some(v) = params.format {
            am.format = Set(v);
        }
        if let Some(v) = params.size_bytes {
            am.size_bytes = Set(Some(v));
        }
        if let Some(v) = params.content {
            am.content = Set(Some(v));
        }
        if let Some(v) = params.metadata {
            am.metadata = Set(v);
        }
        am.updated_at = Set(chrono::Utc::now().into());
        Ok(am.update(db).await?)
    }

    pub async fn delete<C: ConnectionTrait>(db: &C, id: Uuid) -> Result<(), AppError> {
        Items::delete_by_id(id).exec(db).await?;
        Ok(())
    }
}
