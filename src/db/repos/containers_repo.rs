use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, Set,
    TransactionTrait,
};
use uuid::Uuid;

use crate::{
    db::entities::containers::{self, ActiveModel as ContainersActive, Entity as Containers},
    error::AppError,
};

pub struct ContainersRepo;

impl ContainersRepo {
    /// List all containers (MVP: matches music/photo pattern; auth filtering deferred).
    pub async fn list_all<C: ConnectionTrait>(db: &C) -> Result<Vec<containers::Model>, AppError> {
        Ok(Containers::find()
            .order_by_asc(containers::Column::SortOrder)
            .order_by_desc(containers::Column::CreatedAt)
            .order_by_asc(containers::Column::Name)
            .order_by_asc(containers::Column::Id)
            .all(db)
            .await?)
    }

    #[allow(dead_code)]
    pub async fn list_by_user<C: ConnectionTrait>(db: &C, user_id: Uuid) -> Result<Vec<containers::Model>, AppError> {
        Ok(Containers::find()
            .filter(containers::Column::UserId.eq(user_id))
            .order_by_asc(containers::Column::SortOrder)
            .order_by_desc(containers::Column::CreatedAt)
            .order_by_asc(containers::Column::Name)
            .order_by_asc(containers::Column::Id)
            .all(db)
            .await?)
    }

    pub async fn get_by_id<C: ConnectionTrait>(db: &C, id: Uuid) -> Result<Option<containers::Model>, AppError> {
        Ok(Containers::find_by_id(id).one(db).await?)
    }

    pub async fn create<C: ConnectionTrait>(
        db: &C,
        user_id: Uuid,
        name: String,
        kind: String,
        source_id: Option<Uuid>,
        root_path: String,
    ) -> Result<containers::Model, AppError> {
        let now = chrono::Utc::now().into();
        let am = ContainersActive {
            user_id: Set(user_id),
            name: Set(name),
            kind: Set(kind),
            source_id: Set(source_id),
            root_path: Set(root_path),
            sort_order: Set(0),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        Ok(Containers::insert(am).exec_with_returning(db).await?)
    }

    pub async fn update<C: ConnectionTrait>(
        db: &C,
        id: Uuid,
        name: Option<String>,
        kind: Option<String>,
        source_id: Option<Uuid>,
        root_path: Option<String>,
    ) -> Result<Option<containers::Model>, AppError> {
        if Self::get_by_id(db, id).await?.is_none() {
            return Ok(None);
        }
        let mut am = ContainersActive {
            id: Set(id),
            updated_at: Set(chrono::Utc::now().into()),
            ..Default::default()
        };
        if let Some(n) = name {
            am.name = Set(n);
        }
        if let Some(k) = kind {
            am.kind = Set(k);
        }
        if let Some(sid) = source_id {
            am.source_id = Set(Some(sid));
        }
        if let Some(rp) = root_path {
            am.root_path = Set(rp);
        }
        Ok(Some(am.update(db).await?))
    }

    pub async fn reorder(db: &sea_orm::DatabaseConnection, ids: Vec<Uuid>) -> Result<(), AppError> {
        let txn = db.begin().await?;
        for (idx, id) in ids.into_iter().enumerate() {
            Containers::update_many()
                .col_expr(
                    containers::Column::SortOrder,
                    sea_orm::sea_query::Expr::value(idx as i32),
                )
                .col_expr(
                    containers::Column::UpdatedAt,
                    sea_orm::sea_query::Expr::value(chrono::Utc::now().fixed_offset()),
                )
                .filter(containers::Column::Id.eq(id))
                .exec(&txn)
                .await?;
        }
        txn.commit().await?;
        Ok(())
    }

    pub async fn delete<C: ConnectionTrait>(db: &C, id: Uuid) -> Result<(), AppError> {
        Containers::delete_by_id(id).exec(db).await?;
        Ok(())
    }
}
