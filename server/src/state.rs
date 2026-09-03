// Shared application state handed to every axum handler.
use crate::db::Pool;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    /// SQLite connection pool (WAL). Cloning a Pool is cheap (Arc inside).
    pub pool: Pool,
    /// Directory holding bundled resources (field-map.json, the template PDF,
    /// seed files). Arc so clones are cheap.
    pub resources_dir: Arc<PathBuf>,
    /// Whether session cookies carry the `Secure` attribute. True in production
    /// (HTTPS via Nginx Proxy Manager); false for plain-HTTP local testing.
    pub cookie_secure: bool,
}
