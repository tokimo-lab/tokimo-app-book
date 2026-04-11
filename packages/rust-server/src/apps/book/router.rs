use axum::{
    Router,
    routing::{get, post},
};
use std::sync::Arc;

use crate::AppState;

use super::handlers;

pub fn build_book_app_routes() -> Router<Arc<AppState>> {
    Router::new()
        // Container CRUD
        .route(
            "/api/apps/book",
            get(handlers::list_books).post(handlers::create_book),
        )
        .route("/api/apps/book/reorder", post(handlers::reorder_books))
        // Sync
        .route(
            "/api/apps/book/sync-statuses",
            get(handlers::get_all_book_sync_statuses),
        )
        // Download / search (must come before /{id})
        .route(
            "/api/apps/book/providers",
            get(handlers::list_providers),
        )
        .route("/api/apps/book/search", post(handlers::search_books))
        .route(
            "/api/apps/book/book-info",
            post(handlers::get_book_info),
        )
        .route(
            "/api/apps/book/download",
            post(handlers::download_book),
        )
        // Item-level routes (must come before /{id})
        .route(
            "/api/apps/book/item/{id}",
            get(handlers::get_book_detail),
        )
        .route(
            "/api/apps/book/item/{book_id}/chapters/{chapter_id}/content",
            get(handlers::get_chapter_content),
        )
        // Container parameterized routes (must come last)
        .route(
            "/api/apps/book/{id}",
            get(handlers::get_book)
                .patch(handlers::update_book)
                .delete(handlers::delete_book),
        )
        .route(
            "/api/apps/book/{id}/items",
            get(handlers::list_book_items),
        )
        .route(
            "/api/apps/book/{id}/sync",
            post(handlers::sync_book),
        )
        .route(
            "/api/apps/book/{id}/sync-status",
            get(handlers::get_book_sync_status),
        )
        .route(
            "/api/apps/book/{id}/sync-progress",
            get(handlers::get_book_sync_progress),
        )
}
