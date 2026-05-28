use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, Set};
use uuid::Uuid;

use crate::{
    db::entities::containers::{self, ActiveModel as ContainersActive, Entity as Containers},
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

    pub async fn get_by_id<C: ConnectionTrait>(db: &C, id: Uuid) -> Result<Option<containers::Model>, AppError> {
        Ok(Containers::find_by_id(id).one(db).await?)
    }

    #[allow(dead_code)]
    pub async fn create<C: ConnectionTrait>(
        db: &C,
        user_id: Uuid,
        name: String,
        kind: String,
        root_path: String,
    ) -> Result<containers::Model, AppError> {
        let now = chrono::Utc::now().into();
        let am = ContainersActive {
            user_id: Set(user_id),
            name: Set(name),
            kind: Set(kind),
            root_path: Set(root_path),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        Ok(Containers::insert(am).exec_with_returning(db).await?)
    }

    #[allow(dead_code)]
    pub async fn delete<C: ConnectionTrait>(db: &C, id: Uuid) -> Result<(), AppError> {
        Containers::delete_by_id(id).exec(db).await?;
        Ok(())
    }
}
