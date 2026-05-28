use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};
use uuid::Uuid;

use crate::{
    db::entities::chapters::{self, Entity as Chapters},
    error::AppError,
};

pub struct ChaptersRepo;

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
}
