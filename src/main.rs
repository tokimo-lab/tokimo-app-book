//! Tokimo Book App — 多进程架构：CLI / Server 双模二进制。

/// Compile-time embedded app manifest; shared with the library crate via lib.rs.
const MANIFEST: &str = include_str!("../tokimo-app.toml");

mod app_server;
mod assets;
mod cli;
mod ctx;
mod db;
#[allow(dead_code)]
mod error;
mod handlers;

use std::sync::{Arc, OnceLock};

use clap::{Parser, Subcommand};
use tokimo_bus_cli::TokimoAuthArgs;
use tokimo_bus_client::{BusClient, ClientConfig};
use tracing::{error, info};

#[derive(Parser, Debug)]
#[command(
    name = "tokimo-app-book",
    about = "Book — Tokimo 图书 CLI",
    long_about = "Tokimo Book CLI — 管理图书库。",
    term_width = 100
)]
struct Cli {
    #[command(flatten)]
    auth: TokimoAuthArgs,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// 运行诊断（服务状态检查）
    Status,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let Cli { command, .. } = Cli::parse();

    match command {
        None if std::env::var_os("TOKIMO_BUS_SOCKET").is_some() => {
            tracing_subscriber::fmt()
                .with_env_filter(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| "info,tokimo_bus_client=info,tokimo_app_book=debug".into()),
                )
                .init();
            if let Err(e) = run_server().await {
                error!(%e, "book: fatal");
                std::process::exit(1);
            }
        }
        None => {
            use clap::CommandFactory;
            let mut cmd = Cli::command();
            tokimo_bus_cli::print_help_unified(&mut cmd);
            std::process::exit(0);
        }
        Some(Command::Status) => {
            cli::run_status();
        }
    }

    Ok(())
}

async fn run_server() -> anyhow::Result<()> {
    let cfg = ClientConfig::from_env().map_err(|e| anyhow::anyhow!("ClientConfig: {e}"))?;
    info!(endpoint = ?cfg.endpoint, "book: connecting to broker");

    let db = db::init_pool().await?;
    let client_slot: Arc<OnceLock<Arc<BusClient>>> = Arc::new(OnceLock::new());
    let context = Arc::new(ctx::AppCtx {
        db,
        client: Arc::clone(&client_slot),
    });

    let app_socket =
        app_server::spawn("book", Arc::clone(&context)).map_err(|e| anyhow::anyhow!("app_server spawn: {e}"))?;

    let client = BusClient::builder(cfg)
        .service("book", env!("CARGO_PKG_VERSION"))
        .data_plane(app_socket)
        .build()
        .await
        .map_err(|e| anyhow::anyhow!("bus build: {e}"))?;
    client_slot
        .set(Arc::clone(&client))
        .map_err(|_| anyhow::anyhow!("client_slot already set"))?;

    info!("book: registered with broker");

    let shutdown = {
        let client = Arc::clone(&client);
        tokio::spawn(async move { client.run_until_shutdown().await })
    };

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("book: SIGINT received");
            client.shutdown();
        }
        _ = shutdown => info!("book: broker sent Shutdown"),
    }

    Ok(())
}
