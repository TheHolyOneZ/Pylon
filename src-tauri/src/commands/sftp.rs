use tauri::State;

use crate::{
    error::PylonError,
    session::SessionRegistry,
    sftp::{self, RemoteEntry},
};

#[tauri::command]
pub async fn list_remote_dir(
    registry: State<'_, SessionRegistry>,
    session_id: String,
    path: String,
) -> Result<Vec<RemoteEntry>, PylonError> {
    let sess = registry.get_session_arc(&session_id)?;
    sftp::list_dir(&sess, &path)
}

#[tauri::command]
pub async fn read_remote_file(
    registry: State<'_, SessionRegistry>,
    session_id: String,
    path: String,
) -> Result<Vec<u8>, PylonError> {
    let sess = registry.get_session_arc(&session_id)?;
    sftp::read_file(&sess, &path)
}

#[tauri::command]
pub async fn write_remote_file(
    registry: State<'_, SessionRegistry>,
    session_id: String,
    path: String,
    data: Vec<u8>,
) -> Result<(), PylonError> {
    let sess = registry.get_session_arc(&session_id)?;
    sftp::write_file(&sess, &path, &data)
}

#[tauri::command]
pub async fn delete_remote(
    registry: State<'_, SessionRegistry>,
    session_id: String,
    path: String,
    is_dir: bool,
    recursive: bool,
) -> Result<(), PylonError> {
    let sess = registry.get_session_arc(&session_id)?;
    if is_dir {
        if recursive {
            sftp::recursive_delete(&sess, &path)
        } else {
            sftp::delete_dir(&sess, &path)
        }
    } else {
        sftp::delete_file(&sess, &path)
    }
}


#[tauri::command]
pub async fn delete_batch(
    registry: State<'_, SessionRegistry>,
    session_id: String,
    paths: Vec<(String, bool)>,
) -> Result<(), PylonError> {
    if paths.is_empty() { return Ok(()); }
    let auth = registry.get_term_auth(&session_id)?;

    let n_workers = paths.len().min(4);
    let (tx, rx) = std::sync::mpsc::channel::<(String, bool)>();
    for item in paths { tx.send(item).unwrap(); }
    drop(tx);
    let rx = std::sync::Arc::new(std::sync::Mutex::new(rx));
    let mut handles: Vec<std::thread::JoinHandle<()>> = Vec::new();

    for _ in 0..n_workers {
        let auth_c = auth.clone();
        let rx_c = rx.clone();
        handles.push(std::thread::spawn(move || {
            let sess = match crate::session::open_transfer_session(&auth_c) {
                Ok(s) => s,
                Err(_) => return,
            };
            loop {
                let (path, is_dir) = match rx_c.lock().unwrap().recv() {
                    Ok(i) => i,
                    Err(_) => break,
                };
                let _ = if is_dir {
                    crate::sftp::recursive_delete(&sess, &path)
                } else {
                    crate::sftp::delete_file(&sess, &path)
                };
            }
        }));
    }
    for h in handles { let _ = h.join(); }
    Ok(())
}

#[tauri::command]
pub async fn rename_remote(
    registry: State<'_, SessionRegistry>,
    session_id: String,
    from: String,
    to: String,
) -> Result<(), PylonError> {
    let sess = registry.get_session_arc(&session_id)?;
    sftp::rename(&sess, &from, &to)
}

#[tauri::command]
pub async fn create_remote_dir(
    registry: State<'_, SessionRegistry>,
    session_id: String,
    path: String,
) -> Result<(), PylonError> {
    let sess = registry.get_session_arc(&session_id)?;
    sftp::mkdir(&sess, &path, 0o755)
}

#[tauri::command]
pub async fn create_remote_dir_recursive(
    registry: State<'_, SessionRegistry>,
    session_id: String,
    path: String,
) -> Result<(), PylonError> {
    let sess = registry.get_session_arc(&session_id)?;
    sftp::mkdir_p(&sess, &path)
}

#[tauri::command]
pub async fn stat_remote(
    registry: State<'_, SessionRegistry>,
    session_id: String,
    path: String,
) -> Result<RemoteEntry, PylonError> {
    let sess = registry.get_session_arc(&session_id)?;
    sftp::stat(&sess, &path)
}

#[tauri::command]
pub async fn chmod_remote(
    registry: State<'_, SessionRegistry>,
    session_id: String,
    path: String,
    mode: u32,
) -> Result<(), PylonError> {
    let sess = registry.get_session_arc(&session_id)?;
    sftp::chmod(&sess, &path, mode)
}

#[tauri::command]
pub async fn chown_remote(
    registry: State<'_, SessionRegistry>,
    session_id: String,
    path: String,
    uid: u32,
    gid: u32,
) -> Result<(), PylonError> {
    let sess = registry.get_session_arc(&session_id)?;
    sftp::chown(&sess, &path, uid, gid)
}

#[tauri::command]
pub async fn create_symlink_remote(
    registry: State<'_, SessionRegistry>,
    session_id: String,
    target: String,
    linkname: String,
) -> Result<(), PylonError> {
    let sess = registry.get_session_arc(&session_id)?;
    sftp::create_symlink(&sess, &target, &linkname)
}

#[tauri::command]
pub async fn read_symlink_remote(
    registry: State<'_, SessionRegistry>,
    session_id: String,
    path: String,
) -> Result<String, PylonError> {
    let sess = registry.get_session_arc(&session_id)?;
    sftp::readlink(&sess, &path)
}

#[tauri::command]
pub async fn resolve_path_remote(
    registry: State<'_, SessionRegistry>,
    session_id: String,
    path: String,
) -> Result<String, PylonError> {
    let sess = registry.get_session_arc(&session_id)?;
    sftp::realpath(&sess, &path)
}

#[tauri::command]
pub async fn list_remote_recursive(
    registry: State<'_, SessionRegistry>,
    session_id: String,
    path: String,
) -> Result<Vec<RemoteEntry>, PylonError> {
    let sess = registry.get_session_arc(&session_id)?;
    sftp::recursive_list(&sess, &path)
}
