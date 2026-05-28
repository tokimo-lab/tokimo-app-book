//! AppCtx — 延迟绑定的 BusClient。

use std::sync::{Arc, OnceLock};

use tokimo_bus_client::BusClient;

pub struct AppCtx {
    #[allow(dead_code)]
    pub client: Arc<OnceLock<Arc<BusClient>>>,
}
