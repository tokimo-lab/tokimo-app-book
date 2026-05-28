use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder};
use uuid::Uuid;

use crate::{
    db::entities::containers::{self, Entity as Containers},
    error::AppError,
};

pub struct ContainersRepo;

impl ContainersRepo {
    pub async fn list_by_user<C: ConnectionTrait>(db: &C, user_id: Uuid) -> Result<Vec<containers::Model>, AppError> {
        Ok(Containers::find()
            .filter(containers::Column::UserId.eq(user_id))
            .order_by_desc(containers::Column::CreatedAt)
            .order_by_asc(containers::Column::Name)
            .order_by_asc(containers::Column::Id)
            .all(db)
            .await?)
    }
}
