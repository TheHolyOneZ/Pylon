pub mod connection;
pub mod local_fs;
pub mod metadata;
pub mod sftp;
pub mod snippets;
pub mod sync;
pub mod terminal;
pub mod transfer;
pub mod vault;

use crate::error::{PylonError, PylonResult};

pub async fn blocking<T, F>(f: F) -> PylonResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> PylonResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| PylonError::Other(format!("background task failed: {e}")))?
}
