use sea_orm::{ConnectionTrait, EntityTrait, Set, prelude::*, sea_query::OnConflict};
use uuid::Uuid;

use crate::{
    db::entities::book_sync_status::{self, ActiveModel as BookSyncStatusActive, Entity as BookSyncStatus},
    error::AppError,
};

pub struct BookSyncStatusRepo;

impl BookSyncStatusRepo {
    pub async fn upsert<C: ConnectionTrait>(
        db: &C,
        container_id: Uuid,
        status: String,
        last_sync_at: Option<DateTimeWithTimeZone>,
        last_error: Option<String>,
        progress: Option<serde_json::Value>,
    ) -> Result<book_sync_status::Model, AppError> {
        let now = chrono::Utc::now().into();
        let am = BookSyncStatusActive {
            container_id: Set(container_id),
            status: Set(status),
            last_sync_at: Set(last_sync_at),
            last_error: Set(last_error),
            progress: Set(progress),
            updated_at: Set(now),
        };
        Ok(BookSyncStatus::insert(am)
            .on_conflict(
                OnConflict::columns([book_sync_status::Column::ContainerId])
                    .update_columns([
                        book_sync_status::Column::Status,
                        book_sync_status::Column::LastSyncAt,
                        book_sync_status::Column::LastError,
                        book_sync_status::Column::Progress,
                        book_sync_status::Column::UpdatedAt,
                    ])
                    .to_owned(),
            )
            .exec_with_returning(db)
            .await?)
    }

    pub async fn get_by_container<C: ConnectionTrait>(
        db: &C,
        container_id: Uuid,
    ) -> Result<Option<book_sync_status::Model>, AppError> {
        Ok(BookSyncStatus::find_by_id(container_id).one(db).await?)
    }

    pub async fn list_all<C: ConnectionTrait>(db: &C) -> Result<Vec<book_sync_status::Model>, AppError> {
        Ok(BookSyncStatus::find().all(db).await?)
    }
}
