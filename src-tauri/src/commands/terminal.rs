use tauri::{AppHandle, Manager};

use super::blocking;
use crate::{error::PylonError, session::SessionRegistry, terminal::TerminalRegistry};

#[tauri::command]
pub async fn create_terminal(
    app: AppHandle,
    session_id: String,
    cols: u32,
    rows: u32,
    shell: Option<String>,
) -> Result<String, PylonError> {
    blocking(move || {
        let auth = app.state::<SessionRegistry>().get_auth(&session_id)?;
        let reg = app.state::<TerminalRegistry>();
        reg.open(app.clone(), auth, session_id, cols, rows, shell)
    })
    .await
}

#[tauri::command]
pub fn terminal_input(app: AppHandle, terminal_id: String, data: String) -> Result<(), PylonError> {
    app.state::<TerminalRegistry>().write(&terminal_id, data.as_bytes())
}

#[tauri::command]
pub fn resize_terminal(app: AppHandle, terminal_id: String, cols: u32, rows: u32) -> Result<(), PylonError> {
    app.state::<TerminalRegistry>().resize(&terminal_id, cols, rows)
}

#[tauri::command]
pub async fn close_terminal(app: AppHandle, terminal_id: String) -> Result<(), PylonError> {
    app.state::<TerminalRegistry>().close(&terminal_id)
}
