use tauri::{AppHandle, Manager};

use super::blocking;
use crate::{
    error::PylonError,
    session::SessionRegistry,
    sftp::{self, RemoteEntry},
    ssh::SshConn,
};

fn conn(app: &AppHandle, session_id: &str) -> Result<SshConn, PylonError> {
    app.state::<SessionRegistry>().get_conn(session_id)
}

#[tauri::command]
pub async fn list_remote_dir(app: AppHandle, session_id: String, path: String) -> Result<Vec<RemoteEntry>, PylonError> {
    blocking(move || sftp::list_dir(&conn(&app, &session_id)?, &path)).await
}

#[tauri::command]
pub async fn read_remote_file(app: AppHandle, session_id: String, path: String) -> Result<tauri::ipc::Response, PylonError> {
    let data = blocking(move || sftp::read_file(&conn(&app, &session_id)?, &path, 8 * 1024 * 1024)).await?;
    Ok(tauri::ipc::Response::new(data))
}

#[tauri::command]
pub async fn write_remote_file(app: AppHandle, session_id: String, path: String, data: Vec<u8>) -> Result<(), PylonError> {
    blocking(move || sftp::write_file(&conn(&app, &session_id)?, &path, &data)).await
}

#[tauri::command]
pub async fn delete_remote(
    app: AppHandle,
    session_id: String,
    path: String,
    is_dir: bool,
    recursive: bool,
) -> Result<(), PylonError> {
    blocking(move || {
        let c = conn(&app, &session_id)?;
        if is_dir && recursive {
            sftp::recursive_delete(&c, &path)
        } else if is_dir {
            sftp::delete_dir(&c, &path)
        } else {
            sftp::delete_file(&c, &path)
        }
    })
    .await
}

#[tauri::command]
pub async fn delete_batch(app: AppHandle, session_id: String, paths: Vec<(String, bool)>) -> Result<(), PylonError> {
    blocking(move || {
        let c = conn(&app, &session_id)?;
        let sftp = c.sftp()?;
        let mut failed: Vec<String> = Vec::new();
        for (path, _is_dir) in &paths {
            if let Err(e) = sftp::recursive_delete_with(&sftp, path) {
                failed.push(e.to_string());
            }
        }
        if failed.is_empty() {
            Ok(())
        } else {
            let more = if failed.len() > 3 { format!(" (+{} more)", failed.len() - 3) } else { String::new() };
            Err(PylonError::Sftp(format!(
                "{} of {} item(s) could not be deleted: {}{more}",
                failed.len(),
                paths.len(),
                failed.iter().take(3).cloned().collect::<Vec<_>>().join("; ")
            )))
        }
    })
    .await
}

#[tauri::command]
pub async fn rename_remote(app: AppHandle, session_id: String, from: String, to: String) -> Result<(), PylonError> {
    blocking(move || sftp::rename(&conn(&app, &session_id)?, &from, &to)).await
}

#[tauri::command]
pub async fn create_remote_dir(app: AppHandle, session_id: String, path: String) -> Result<(), PylonError> {
    blocking(move || sftp::mkdir(&conn(&app, &session_id)?, &path, 0o755)).await
}

#[tauri::command]
pub async fn create_remote_dir_recursive(app: AppHandle, session_id: String, path: String) -> Result<(), PylonError> {
    blocking(move || sftp::mkdir_p(&conn(&app, &session_id)?, &path)).await
}

#[tauri::command]
pub async fn stat_remote(app: AppHandle, session_id: String, path: String) -> Result<RemoteEntry, PylonError> {
    blocking(move || sftp::stat(&conn(&app, &session_id)?, &path)).await
}

#[tauri::command]
pub async fn remote_path_exists(app: AppHandle, session_id: String, path: String) -> Result<bool, PylonError> {
    blocking(move || sftp::exists(&conn(&app, &session_id)?, &path)).await
}

#[tauri::command]
pub async fn remote_paths_exist(app: AppHandle, session_id: String, paths: Vec<String>) -> Result<Vec<bool>, PylonError> {
    blocking(move || {
        let c = conn(&app, &session_id)?;
        paths.iter().map(|p| sftp::exists(&c, p)).collect()
    })
    .await
}

#[tauri::command]
pub async fn chmod_remote(app: AppHandle, session_id: String, path: String, mode: u32) -> Result<(), PylonError> {
    blocking(move || sftp::chmod(&conn(&app, &session_id)?, &path, mode)).await
}

#[tauri::command]
pub async fn chown_remote(app: AppHandle, session_id: String, path: String, uid: u32, gid: u32) -> Result<(), PylonError> {
    blocking(move || sftp::chown(&conn(&app, &session_id)?, &path, uid, gid)).await
}

#[tauri::command]
pub async fn create_symlink_remote(app: AppHandle, session_id: String, target: String, linkname: String) -> Result<(), PylonError> {
    blocking(move || sftp::create_symlink(&conn(&app, &session_id)?, &target, &linkname)).await
}

#[tauri::command]
pub async fn read_symlink_remote(app: AppHandle, session_id: String, path: String) -> Result<String, PylonError> {
    blocking(move || sftp::readlink(&conn(&app, &session_id)?, &path)).await
}

#[tauri::command]
pub async fn resolve_path_remote(app: AppHandle, session_id: String, path: String) -> Result<String, PylonError> {
    blocking(move || sftp::realpath(&conn(&app, &session_id)?, &path)).await
}

#[tauri::command]
pub async fn list_remote_recursive(app: AppHandle, session_id: String, path: String) -> Result<Vec<RemoteEntry>, PylonError> {
    blocking(move || sftp::recursive_list(&conn(&app, &session_id)?, &path)).await
}
