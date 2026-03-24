use axum::{
    routing::{get, post},
    Router,
};
use std::sync::Arc;

use crate::handlers::novel;
use crate::AppState;

pub fn build_novel_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/novel/providers", get(novel::list_providers))
        .route("/api/novel/search", post(novel::search_novels))
        .route("/api/novel/book-info", post(novel::get_book_info))
        .route("/api/novel/download", post(novel::download_novel))
        .route(
            "/api/apps/novel/{id}",
            get(novel::get_novel_detail),
        )
        .route(
            "/api/novels/{novel_id}/chapters/{chapter_id}/content",
            get(novel::get_chapter_content),
        )
}
