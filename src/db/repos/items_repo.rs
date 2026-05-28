use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect};
use uuid::Uuid;

use crate::{
    db::entities::items::{self, Entity as Items},
    error::AppError,
};

pub struct ItemsRepo;

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
}
