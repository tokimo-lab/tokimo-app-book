use axum::{
    Router,
    routing::{get, post},
};
use std::sync::Arc;

use crate::AppState;

use super::handlers;

pub fn build_novel_app_routes() -> Router<Arc<AppState>> {
    Router::new()
        // Container CRUD
        .route(
            "/api/apps/novel",
            get(handlers::list_novels).post(handlers::create_novel),
        )
        .route("/api/apps/novel/reorder", post(handlers::reorder_novels))
        // Download / search (must come before /{id})
        .route(
            "/api/apps/novel/providers",
            get(handlers::list_providers),
        )
        .route("/api/apps/novel/search", post(handlers::search_novels))
        .route(
            "/api/apps/novel/book-info",
            post(handlers::get_book_info),
        )
        .route(
            "/api/apps/novel/download",
            post(handlers::download_novel),
        )
        // Item-level routes (must come before /{id})
        .route(
            "/api/apps/novel/item/{id}",
            get(handlers::get_novel_detail),
        )
        .route(
            "/api/apps/novel/item/{novel_id}/chapters/{chapter_id}/content",
            get(handlers::get_chapter_content),
        )
        // Container parameterized routes (must come last)
        .route(
            "/api/apps/novel/{id}",
            get(handlers::get_novel)
                .patch(handlers::update_novel)
                .delete(handlers::delete_novel),
        )
        .route(
            "/api/apps/novel/{id}/items",
            get(handlers::list_novel_items),
        )
}
