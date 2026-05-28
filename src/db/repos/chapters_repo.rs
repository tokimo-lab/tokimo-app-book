use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, Set};
use uuid::Uuid;

use crate::{
    db::entities::chapters::{self, ActiveModel as ChaptersActive, Entity as Chapters},
    error::AppError,
};

pub struct ChaptersRepo;

pub struct CreateChapterParams {
    pub item_id: Uuid,
    pub idx: i32,
    pub title: String,
    pub content: String,
}

impl ChaptersRepo {
    pub async fn get_by_item_and_idx<C: ConnectionTrait>(
        db: &C,
        item_id: Uuid,
        idx: i32,
    ) -> Result<Option<chapters::Model>, AppError> {
        Ok(Chapters::find()
            .filter(chapters::Column::ItemId.eq(item_id))
            .filter(chapters::Column::Idx.eq(idx))
            .one(db)
            .await?)
    }

    pub async fn list_by_item<C: ConnectionTrait>(db: &C, item_id: Uuid) -> Result<Vec<chapters::Model>, AppError> {
        Ok(Chapters::find()
            .filter(chapters::Column::ItemId.eq(item_id))
            .order_by_asc(chapters::Column::Idx)
            .all(db)
            .await?)
    }

    pub async fn create<C: ConnectionTrait>(db: &C, params: CreateChapterParams) -> Result<chapters::Model, AppError> {
        let now = chrono::Utc::now().into();
        let am = ChaptersActive {
            item_id: Set(params.item_id),
            idx: Set(params.idx),
            title: Set(params.title),
            content: Set(params.content),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        Ok(Chapters::insert(am).exec_with_returning(db).await?)
    }
}
