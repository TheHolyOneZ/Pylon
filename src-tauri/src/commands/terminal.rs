use tauri::{AppHandle, State};

use crate::{
    error::PylonError,
    session::SessionRegistry,
    terminal::TerminalRegistry,
};

#[tauri::command]
pub async fn create_terminal(
    app: AppHandle,
    session_registry: State<'_, SessionRegistry>,
    terminal_registry: State<'_, TerminalRegistry>,
    session_id: String,
    cols: u32,
    rows: u32,
    shell: Option<String>,
) -> Result<String, PylonError> {
    let auth = session_registry.get_term_auth(&session_id)?;
    terminal_registry.open(app, auth, session_id, cols, rows, shell)
}

#[tauri::command]
pub async fn terminal_input(
    terminal_registry: State<'_, TerminalRegistry>,
    terminal_id: String,
    data: Vec<u8>,
) -> Result<(), PylonError> {
    terminal_registry.write(&terminal_id, &data)
}

#[tauri::command]
pub async fn resize_terminal(
    terminal_registry: State<'_, TerminalRegistry>,
    terminal_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), PylonError> {
    terminal_registry.resize(&terminal_id, cols, rows)
}

#[tauri::command]
pub async fn close_terminal(
    terminal_registry: State<'_, TerminalRegistry>,
    terminal_id: String,
) -> Result<(), PylonError> {
    terminal_registry.close(&terminal_id)
}
