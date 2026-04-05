use axum::{
    routing::{get, post},
    Router,
};
use std::sync::Arc;

use crate::handlers::novel;
use crate::AppState;

pub fn build_novel_routes() -> Router<Arc<AppState>> {
    Router::new()
        // App-scoped novel list (previously in build_app_routes)
        .route("/api/apps/{id}/novels", get(novel::list_novels))
        .route("/api/apps/novel/providers", get(novel::list_providers))
        .route("/api/apps/novel/search", post(novel::search_novels))
        .route("/api/apps/novel/book-info", post(novel::get_book_info))
        .route("/api/apps/novel/download", post(novel::download_novel))
        .route(
            "/api/apps/novel/{id}",
            get(novel::get_novel_detail),
        )
        .route(
            "/api/apps/novel/{novel_id}/chapters/{chapter_id}/content",
            get(novel::get_chapter_content),
        )
}
