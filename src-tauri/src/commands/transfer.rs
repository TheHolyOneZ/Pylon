use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    error::PylonError,
    session::{SessionRegistry, open_transfer_session},
    transfer::{self, TransferRecord, TransferRegistry},
};

#[tauri::command]
pub async fn upload_file(
    app: AppHandle,
    session_registry: State<'_, SessionRegistry>,
    transfer_registry: State<'_, TransferRegistry>,
    session_id: String,
    local_path: String,
    remote_path: String,
    bandwidth_kbps: Option<u64>,
    chunk_kb: Option<u64>,
) -> Result<String, PylonError> {
    let sess = session_registry.get_session_arc(&session_id)?;
    let bps = bandwidth_kbps.map(|k| k * 1024);
    transfer::upload(
        &app, &sess, &transfer_registry,
        session_id, local_path, remote_path,
        false, bps, None, chunk_kb,
    )
}

#[tauri::command]
pub async fn upload_file_clean(
    app: AppHandle,
    session_registry: State<'_, SessionRegistry>,
    transfer_registry: State<'_, TransferRegistry>,
    session_id: String,
    local_path: String,
    remote_path: String,
    bandwidth_kbps: Option<u64>,
    chunk_kb: Option<u64>,
) -> Result<String, PylonError> {
    let sess = session_registry.get_session_arc(&session_id)?;
    let bps = bandwidth_kbps.map(|k| k * 1024);
    transfer::upload(
        &app, &sess, &transfer_registry,
        session_id, local_path, remote_path,
        true, bps, None, chunk_kb,
    )
}

#[tauri::command]
pub async fn download_file(
    app: AppHandle,
    session_registry: State<'_, SessionRegistry>,
    transfer_registry: State<'_, TransferRegistry>,
    session_id: String,
    remote_path: String,
    local_path: String,
    bandwidth_kbps: Option<u64>,
    chunk_kb: Option<u64>,
) -> Result<String, PylonError> {
    let sess = session_registry.get_session_arc(&session_id)?;
    let bps = bandwidth_kbps.map(|k| k * 1024);
    transfer::download(
        &app, &sess, &transfer_registry,
        session_id, remote_path, local_path, None, bps, chunk_kb,
    )
}

#[tauri::command]
pub async fn upload_batch(
    app: AppHandle,
    session_registry: State<'_, SessionRegistry>,
    transfer_registry: State<'_, TransferRegistry>,
    session_id: String,
    files: Vec<(String, String)>,
    strip_metadata: bool,
    bandwidth_kbps: Option<u64>,
    chunk_kb: Option<u64>,
) -> Result<Vec<String>, PylonError> {
    let sess = session_registry.get_session_arc(&session_id)?;
    let bps = bandwidth_kbps.map(|k| k * 1024);
    let mut ids = Vec::new();
    for (local, remote) in files {
        match transfer::upload(
            &app, &sess, &transfer_registry,
            session_id.clone(), local, remote,
            strip_metadata, bps, None, chunk_kb,
        ) {
            Ok(id) => ids.push(id),
            Err(e) => tracing::warn!("batch upload item failed: {e}"),
        }
    }
    Ok(ids)
}

#[tauri::command]
pub async fn upload_directory(
    app: AppHandle,
    session_registry: State<'_, SessionRegistry>,
    transfer_registry: State<'_, TransferRegistry>,
    session_id: String,
    local_dir: String,
    remote_dir: String,
    strip_metadata: bool,
    max_workers: Option<usize>,
    bandwidth_kbps: Option<u64>,
    chunk_kb: Option<u64>,
) -> Result<Vec<String>, PylonError> {
    let auth = session_registry.get_term_auth(&session_id)?;
    let n_max = max_workers.unwrap_or(4).max(1).min(16);
    let bps = bandwidth_kbps.map(|k| k * 1024);

    fn collect_files(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
        let mut files = Vec::new();
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let meta = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let path = entry.path();
                if meta.is_symlink() {
                    continue;
                }
                if meta.is_dir() {
                    files.extend(collect_files(&path));
                } else if meta.is_file() {
                    files.push(path);
                }
            }
        }
        files
    }

    let local_base = std::path::Path::new(&local_dir);
    let all_files = collect_files(local_base);
    let total_files = all_files.len();

    let batch_id = Uuid::new_v4().to_string();
    let dir_name = local_base
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| local_dir.clone());

    let _ = app.emit("transfer://batch-new", serde_json::json!({
        "batch_id": &batch_id,
        "session_id": &session_id,
        "direction": "upload",
        "name": &dir_name,
        "local_dir": &local_dir,
        "remote_dir": &remote_dir,
        "total_files": total_files,
    }));

    if all_files.is_empty() {
        return Ok(vec![]);
    }

    let work_items: Vec<(String, String)> = all_files.iter().map(|lf| {
        let rel = lf.strip_prefix(local_base).unwrap_or(lf)
            .to_string_lossy().replace('\\', "/");
        (lf.to_string_lossy().into_owned(), format!("{remote_dir}/{rel}"))
    }).collect();

    let n_workers = total_files.min(n_max);
    let (tx, rx) = std::sync::mpsc::channel::<(String, String)>();
    for item in work_items {
        if tx.send(item).is_err() {
            break;
        }
    }
    drop(tx);
    let rx = Arc::new(Mutex::new(rx));

    let all_ids = Arc::new(Mutex::new(Vec::<String>::new()));
    let registry = (*transfer_registry).clone();
    let mut handles: Vec<std::thread::JoinHandle<()>> = Vec::new();

    for _ in 0..n_workers {
        let app_c = app.clone();
        let auth_c = auth.clone();
        let sid_c = session_id.clone();
        let bid_c = batch_id.clone();
        let rx_c = rx.clone();
        let ids_c = all_ids.clone();
        let reg_c = registry.clone();

        handles.push(std::thread::spawn(move || {
            let worker_sess = match open_transfer_session(&auth_c) {
                Ok(s) => s,
                Err(_) => return,
            };
            loop {
                let (local, remote) = match rx_c.lock().ok().and_then(|g| g.recv().ok()) {
                    Some(i) => i,
                    None => break,
                };
                if let Ok(id) = transfer::upload(
                    &app_c, &worker_sess, &reg_c,
                    sid_c.clone(), local, remote,
                    strip_metadata, bps, Some(bid_c.clone()), chunk_kb,
                ) {
                    if let Ok(mut ids) = ids_c.lock() { ids.push(id); }
                }
            }
        }));
    }

    for h in handles { let _ = h.join(); }

    let ids = match Arc::try_unwrap(all_ids) {
        Ok(m) => m.into_inner().unwrap_or_default(),
        Err(a) => a.lock().map(|g| g.clone()).unwrap_or_default(),
    };
    Ok(ids)
}

#[tauri::command]
pub async fn download_directory(
    app: AppHandle,
    session_registry: State<'_, SessionRegistry>,
    transfer_registry: State<'_, TransferRegistry>,
    session_id: String,
    remote_dir: String,
    local_dir: String,
    max_workers: Option<usize>,
    bandwidth_kbps: Option<u64>,
    chunk_kb: Option<u64>,
) -> Result<Vec<String>, PylonError> {
    let auth = session_registry.get_term_auth(&session_id)?;
    let n_max = max_workers.unwrap_or(4).max(1).min(16);
    let bps = bandwidth_kbps.map(|k| k * 1024);

    let primary_sess = session_registry.get_session_arc(&session_id)?;
    let all = crate::sftp::recursive_list(&primary_sess, &remote_dir)?;

    let file_entries: Vec<_> = all.iter().filter(|e| !e.is_dir).collect();
    let total_files = file_entries.len();

    let batch_id = Uuid::new_v4().to_string();
    let dir_name = std::path::Path::new(&remote_dir)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| remote_dir.clone());

    let _ = app.emit("transfer://batch-new", serde_json::json!({
        "batch_id": &batch_id,
        "session_id": &session_id,
        "direction": "download",
        "name": &dir_name,
        "local_dir": &local_dir,
        "remote_dir": &remote_dir,
        "total_files": total_files,
    }));

    for entry in all.iter().filter(|e| e.is_dir) {
        let rel = entry.path.trim_start_matches(&*remote_dir).trim_start_matches('/');

        let dest = std::path::PathBuf::from(&local_dir).join(rel);
        std::fs::create_dir_all(&dest)?;
    }

    if total_files == 0 {
        return Ok(vec![]);
    }

    let work_items: Vec<(String, String)> = all.iter()
        .filter(|e| !e.is_dir)
        .map(|e| {
            let rel = e.path.trim_start_matches(&*remote_dir).trim_start_matches('/');

            let dest = std::path::PathBuf::from(&local_dir).join(rel);
            (e.path.clone(), dest.to_string_lossy().into_owned())
        })
        .collect();

    let n_workers = total_files.min(n_max);
    let (tx, rx) = std::sync::mpsc::channel::<(String, String)>();
    for item in work_items {
        if tx.send(item).is_err() {
            break;
        }
    }
    drop(tx);
    let rx = Arc::new(Mutex::new(rx));

    let all_ids = Arc::new(Mutex::new(Vec::<String>::new()));
    let registry = (*transfer_registry).clone();
    let mut handles: Vec<std::thread::JoinHandle<()>> = Vec::new();

    for _ in 0..n_workers {
        let app_c = app.clone();
        let auth_c = auth.clone();
        let sid_c = session_id.clone();
        let bid_c = batch_id.clone();
        let rx_c = rx.clone();
        let ids_c = all_ids.clone();
        let reg_c = registry.clone();

        handles.push(std::thread::spawn(move || {
            let worker_sess = match open_transfer_session(&auth_c) {
                Ok(s) => s,
                Err(_) => return,
            };
            loop {
                let (remote, local) = match rx_c.lock().ok().and_then(|g| g.recv().ok()) {
                    Some(i) => i,
                    None => break,
                };
                if let Some(parent) = std::path::Path::new(&local).parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if let Ok(id) = transfer::download(
                    &app_c, &worker_sess, &reg_c,
                    sid_c.clone(), remote, local,
                    Some(bid_c.clone()), bps, chunk_kb,
                ) {
                    if let Ok(mut ids) = ids_c.lock() { ids.push(id); }
                }
            }
        }));
    }

    for h in handles { let _ = h.join(); }

    let ids = match Arc::try_unwrap(all_ids) {
        Ok(m) => m.into_inner().unwrap_or_default(),
        Err(a) => a.lock().map(|g| g.clone()).unwrap_or_default(),
    };
    Ok(ids)
}

#[tauri::command]
pub async fn cancel_transfer(
    registry: State<'_, TransferRegistry>,
    transfer_id: String,
) -> Result<(), PylonError> {
    registry.cancel(&transfer_id);
    Ok(())
}

#[tauri::command]
pub async fn pause_transfer(
    registry: State<'_, TransferRegistry>,
    transfer_id: String,
) -> Result<(), PylonError> {
    registry.pause(&transfer_id);
    Ok(())
}

#[tauri::command]
pub async fn resume_transfer_cmd(
    registry: State<'_, TransferRegistry>,
    transfer_id: String,
) -> Result<(), PylonError> {
    registry.resume_transfer(&transfer_id);
    Ok(())
}

#[tauri::command]
pub async fn set_transfer_rate_limit(
    registry: State<'_, TransferRegistry>,
    transfer_id: String,
    bytes_per_sec: Option<u64>,
) -> Result<(), PylonError> {
    registry.set_rate_limit(&transfer_id, bytes_per_sec);
    Ok(())
}

#[tauri::command]
pub async fn list_transfers(
    registry: State<'_, TransferRegistry>,
) -> Result<Vec<TransferRecord>, PylonError> {
    Ok(registry.list())
}
