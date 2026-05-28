//! Library facade — exposes modules for testing.

const MANIFEST: &str = include_str!("../tokimo-app.toml");

pub mod ctx;
pub mod db;
pub mod error;
pub mod handlers;
