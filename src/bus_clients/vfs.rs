use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tokimo_bus_client::BusClient;
use tokimo_bus_protocol::CallerCtx;
use uuid::Uuid;

use crate::error::AppError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetDriverConfigRequest {
    pub source_id: Uuid,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverConfig {
    pub driver_name: String,
    pub config: JsonValue,
}

fn book_caller() -> CallerCtx {
    CallerCtx {
        user_id: None,
        request_id: Uuid::new_v4().to_string(),
        workspace: None,
        caller_app_id: Some("book".to_string()),
    }
}

pub async fn get_driver_config(client: &BusClient, source_id: Uuid) -> Result<DriverConfig, AppError> {
    let payload = serde_json::to_vec(&GetDriverConfigRequest { source_id })
        .map_err(|error| AppError::Internal(format!("vfs.get_driver_config encode: {error}")))?;
    let response = client
        .invoke("vfs", "get_driver_config", payload, book_caller())
        .await
        .map_err(|error| AppError::Internal(format!("vfs.get_driver_config via bus: {error}")))?;
    serde_json::from_slice(&response)
        .map_err(|error| AppError::Internal(format!("vfs.get_driver_config decode: {error}")))
}
