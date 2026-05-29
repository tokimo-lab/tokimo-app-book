//! 内嵌 axum HTTP server，监听本地 UDS socket。
//!
//! 路由布局（server 端 `/api/apps/book/<rest>` 反代到本 sock 的 `/<rest>`）。

use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};
use tokimo_bus_protocol::{BusListener, DataPlaneSocket};
use tracing::{error, info};

use crate::{assets, ctx::AppCtx, handlers};

pub fn spawn(service: &str, ctx: Arc<AppCtx>) -> anyhow::Result<DataPlaneSocket> {
    let (listener, socket) = BusListener::bind_for_app(service)?;
    info!(?socket, "book: app server listening");

    let router = build_router(ctx);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            error!(error = %e, "book: app server stopped");
        }
    });

    Ok(socket)
}

fn build_router(ctx: Arc<AppCtx>) -> Router {
    Router::new()
        // ── Container CRUD ──
        .route("/", get(handlers::list_books).post(handlers::create_container))
        .route("/reorder", post(handlers::reorder_books))
        // ── Sync ──
        .route("/sync-statuses", get(handlers::get_all_book_sync_statuses))
        // ── Download / search (must come before /{id}) ──
        .route("/providers", get(handlers::list_providers))
        .route("/search", post(handlers::search_books))
        .route("/book-info", post(handlers::get_book_info))
        .route("/download", post(handlers::download_book))
        // ── Item-level routes ──
        .route("/item", post(handlers::create_item))
        .route(
            "/item/{id}",
            get(handlers::get_book_detail)
                .patch(handlers::update_item)
                .delete(handlers::delete_item),
        )
        .route(
            "/item/{book_id}/chapters/{chapter_id}/content",
            get(handlers::get_chapter_content),
        )
        // ── Container parameterized routes ──
        .route(
            "/{id}",
            get(handlers::get_book)
                .patch(handlers::update_container)
                .delete(handlers::delete_container),
        )
        .route("/{id}/items", get(handlers::list_book_items))
        .route("/{id}/sync", post(handlers::sync_book))
        .route("/{id}/sync-status", get(handlers::get_book_sync_status))
        // ── Assets ──
        .route("/assets/{*path}", get(assets::serve))
        .with_state(ctx)
}
