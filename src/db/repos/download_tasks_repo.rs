use sea_orm::{ActiveModelTrait, ConnectionTrait, EntityTrait, Set};
use uuid::Uuid;

use crate::{
    db::entities::download_tasks::{self, ActiveModel as DownloadTasksActive, Entity as DownloadTasks},
    error::AppError,
};

pub struct DownloadTasksRepo;

pub struct InsertDownloadTaskParams {
    pub user_id: Option<Uuid>,
    pub provider: String,
    pub query: String,
    pub external_id: Option<String>,
    pub status: String,
    pub item_id: Option<Uuid>,
    pub error: Option<String>,
    pub progress: Option<serde_json::Value>,
}

impl DownloadTasksRepo {
    pub async fn insert<C: ConnectionTrait>(
        db: &C,
        params: InsertDownloadTaskParams,
    ) -> Result<download_tasks::Model, AppError> {
        let now = chrono::Utc::now().into();
        let am = DownloadTasksActive {
            user_id: Set(params.user_id),
            provider: Set(params.provider),
            query: Set(params.query),
            external_id: Set(params.external_id),
            status: Set(params.status),
            item_id: Set(params.item_id),
            error: Set(params.error),
            progress: Set(params.progress),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        Ok(DownloadTasks::insert(am).exec_with_returning(db).await?)
    }

    pub async fn update<C: ConnectionTrait>(
        db: &C,
        id: Uuid,
        status: String,
        item_id: Option<Uuid>,
        error: Option<String>,
        progress: Option<serde_json::Value>,
    ) -> Result<download_tasks::Model, AppError> {
        let mut am = DownloadTasksActive {
            id: Set(id),
            status: Set(status),
            error: Set(error),
            progress: Set(progress),
            updated_at: Set(chrono::Utc::now().into()),
            ..Default::default()
        };
        if let Some(item_id) = item_id {
            am.item_id = Set(Some(item_id));
        }
        Ok(am.update(db).await?)
    }
}
