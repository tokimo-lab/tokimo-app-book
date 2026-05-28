use sea_orm::{ConnectionTrait, EntityTrait, Set};
use uuid::Uuid;

use crate::{
    db::entities::download_tasks::{self, ActiveModel as DownloadTasksActive, Entity as DownloadTasks},
    error::AppError,
};

pub struct DownloadTasksRepo;

impl DownloadTasksRepo {
    pub async fn insert<C: ConnectionTrait>(
        db: &C,
        user_id: Option<Uuid>,
        provider: String,
        query: String,
        external_id: Option<String>,
        status: String,
        item_id: Option<Uuid>,
        error: Option<String>,
    ) -> Result<download_tasks::Model, AppError> {
        let now = chrono::Utc::now().into();
        let am = DownloadTasksActive {
            user_id: Set(user_id),
            provider: Set(provider),
            query: Set(query),
            external_id: Set(external_id),
            status: Set(status),
            item_id: Set(item_id),
            error: Set(error),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        Ok(DownloadTasks::insert(am).exec_with_returning(db).await?)
    }
}
