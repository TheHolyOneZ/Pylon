use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::blocking;
use crate::{
    error::{PylonError, PylonResult},
    session::SessionRegistry,
    sftp as rsftp,
    ssh::{self, SshConn},
    transfer::{self, sanitize_local_component, TransferOpts, TransferRecord, TransferRegistry},
};

#[derive(Serialize, Clone)]
pub struct BatchResult {
    pub batch_id: String,
    pub ids: Vec<String>,
    pub total_files: usize,
    pub failed: usize,
    pub cancelled: bool,
    pub errors: Vec<String>,
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn upload_file(
    app: AppHandle,
    session_id: String,
    local_path: String,
    remote_path: String,
    strip_metadata: Option<bool>,
    bandwidth_kbps: Option<u64>,
    chunk_kb: Option<u64>,
    verify: Option<bool>,
) -> Result<String, PylonError> {
    blocking(move || {
        let conn = app.state::<SessionRegistry>().get_conn(&session_id)?;
        let reg = app.state::<TransferRegistry>();
        let mut opts = TransferOpts::new(strip_metadata.unwrap_or(false), bandwidth_kbps, chunk_kb);
        opts.verify = verify.unwrap_or(true);
        transfer::upload(&app, &conn, &reg, &session_id, &local_path, &remote_path, &opts)
    })
    .await
}

#[tauri::command]
pub async fn upload_file_clean(
    app: AppHandle,
    session_id: String,
    local_path: String,
    remote_path: String,
    bandwidth_kbps: Option<u64>,
    chunk_kb: Option<u64>,
) -> Result<String, PylonError> {
    upload_file(app, session_id, local_path, remote_path, Some(true), bandwidth_kbps, chunk_kb, None).await
}

#[tauri::command]
pub async fn download_file(
    app: AppHandle,
    session_id: String,
    remote_path: String,
    local_path: String,
    bandwidth_kbps: Option<u64>,
    chunk_kb: Option<u64>,
    verify: Option<bool>,
) -> Result<String, PylonError> {
    blocking(move || {
        let conn = app.state::<SessionRegistry>().get_conn(&session_id)?;
        let reg = app.state::<TransferRegistry>();
        let mut opts = TransferOpts::new(false, bandwidth_kbps, chunk_kb);
        opts.verify = verify.unwrap_or(true);
        transfer::download(&app, &conn, &reg, &session_id, &remote_path, &local_path, &opts)
    })
    .await
}

#[tauri::command]
pub async fn upload_batch(
    app: AppHandle,
    session_id: String,
    files: Vec<(String, String)>,
    strip_metadata: bool,
    bandwidth_kbps: Option<u64>,
    chunk_kb: Option<u64>,
) -> Result<Vec<String>, PylonError> {
    blocking(move || {
        let conn = app.state::<SessionRegistry>().get_conn(&session_id)?;
        let reg = app.state::<TransferRegistry>();
        let opts = TransferOpts::new(strip_metadata, bandwidth_kbps, chunk_kb);
        let mut ids = Vec::new();
        let mut errors = Vec::new();
        for (local, remote) in files {
            match transfer::upload(&app, &conn, &reg, &session_id, &local, &remote, &opts) {
                Ok(id) => ids.push(id),
                Err(e) => errors.push(e.to_string()),
            }
        }
        if !errors.is_empty() && ids.is_empty() {
            return Err(PylonError::Transfer(errors.join("; ")));
        }
        Ok(ids)
    })
    .await
}

fn run_pool<J: Send + 'static>(
    primary: SshConn,
    auth: ssh::AuthParams,
    workers: usize,
    jobs: Vec<J>,
    cancel: Arc<AtomicBool>,
    work: impl Fn(&SshConn, J) -> PylonResult<String> + Send + Sync + 'static,
) -> (Vec<String>, Vec<String>) {
    let total = jobs.len();
    let queue = Arc::new(Mutex::new(jobs.into_iter().collect::<std::collections::VecDeque<J>>()));
    let ids = Arc::new(Mutex::new(Vec::new()));
    let errors = Arc::new(Mutex::new(Vec::new()));
    let work = Arc::new(work);
    let n = workers.clamp(1, 16).min(total.max(1));

    let handles: Vec<_> = (0..n)
        .map(|i| {
            let (queue, ids, errors, work, cancel) = (queue.clone(), ids.clone(), errors.clone(), work.clone(), cancel.clone());
            let primary = primary.clone();
            let auth = auth.clone();
            std::thread::spawn(move || {
                let conn = if i == 0 {
                    primary
                } else {
                    match ssh::open_pinned(&auth) {
                        Ok(c) => c,
                        Err(e) => {
                            tracing::warn!("transfer worker {i} could not connect: {e}");
                            return;
                        }
                    }
                };
                loop {
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }
                    let Some(job) = queue.lock().unwrap().pop_front() else { break };
                    match work(&conn, job) {
                        Ok(id) => ids.lock().unwrap().push(id),
                        Err(e) => errors.lock().unwrap().push(e.to_string()),
                    }
                }
                if i != 0 {
                    let _ = conn.sess.disconnect(None, "done", None);
                }
            })
        })
        .collect();
    for h in handles {
        let _ = h.join();
    }
    let ids = std::mem::take(&mut *ids.lock().unwrap());
    let errors = std::mem::take(&mut *errors.lock().unwrap());
    (ids, errors)
}

fn finish_batch(app: &AppHandle, reg: &TransferRegistry, batch_id: String, total: usize, ids: Vec<String>, errors: Vec<String>, cancel: &AtomicBool) -> BatchResult {
    reg.end_batch(&batch_id);
    let result = BatchResult {
        batch_id,
        ids,
        total_files: total,
        failed: errors.len(),
        cancelled: cancel.load(Ordering::Relaxed),
        errors: errors.into_iter().take(20).collect(),
    };
    let _ = app.emit("transfer://batch-done", &result);
    result
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn upload_directory(
    app: AppHandle,
    session_id: String,
    local_dir: String,
    remote_dir: String,
    strip_metadata: bool,
    max_workers: Option<usize>,
    bandwidth_kbps: Option<u64>,
    chunk_kb: Option<u64>,
    verify: Option<bool>,
) -> Result<BatchResult, PylonError> {
    blocking(move || {
        let registry = app.state::<SessionRegistry>();
        let primary = registry.get_conn(&session_id)?;
        let auth = registry.get_auth(&session_id)?;
        let treg = (*app.state::<TransferRegistry>()).clone();

        let base = PathBuf::from(&local_dir);
        if !base.is_dir() {
            return Err(PylonError::Transfer(format!("{local_dir} is not a folder")));
        }
        let mut dirs = vec![String::new()];
        let mut files: Vec<(PathBuf, String)> = Vec::new();
        let mut stack = vec![base.clone()];
        while let Some(dir) = stack.pop() {
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for entry in rd.flatten() {
                let path = entry.path();
                let Ok(ft) = entry.file_type() else { continue };
                let rel = path.strip_prefix(&base).unwrap_or(&path).to_string_lossy().replace('\\', "/");
                if ft.is_dir() {
                    dirs.push(rel);
                    stack.push(path);
                } else if ft.is_file() || (ft.is_symlink() && path.is_file()) {
                    if transfer::is_partial_name(&entry.file_name().to_string_lossy()) {
                        continue;
                    }
                    files.push((path, rel));
                }
            }
        }

        let (batch_id, cancel) = treg.new_batch();
        let total_bytes: u64 = files.iter().filter_map(|(p, _)| std::fs::metadata(p).ok()).map(|m| m.len()).sum();
        let name = base.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| local_dir.clone());
        let _ = app.emit("transfer://batch-new", serde_json::json!({
            "batch_id": &batch_id, "session_id": &session_id, "direction": "upload",
            "name": &name, "local_dir": &local_dir, "remote_dir": &remote_dir,
            "total_files": files.len(), "total_bytes": total_bytes,
        }));

        let sftp = primary.sftp()?;
        dirs.sort();
        for d in &dirs {
            let target = if d.is_empty() { remote_dir.clone() } else { rsftp::join(&remote_dir, d) };
            if let Err(e) = rsftp::mkdir_p_with(&sftp, &target) {
                treg.end_batch(&batch_id);
                let _ = app.emit("transfer://batch-done", serde_json::json!({ "batch_id": &batch_id, "failed": files.len(), "total_files": files.len(), "errors": [e.to_string()] }));
                return Err(e);
            }
        }

        let total = files.len();
        let jobs: Vec<(String, String)> = files
            .into_iter()
            .map(|(p, rel)| (p.to_string_lossy().into_owned(), rsftp::join(&remote_dir, &rel)))
            .collect();
        let mut opts = TransferOpts::new(strip_metadata, bandwidth_kbps, chunk_kb);
        opts.batch_id = Some(batch_id.clone());
        opts.verify = verify.unwrap_or(true);
        let (app2, treg2, sid) = (app.clone(), treg.clone(), session_id.clone());
        let (ids, errors) = run_pool(primary, auth, max_workers.unwrap_or(4), jobs, cancel.clone(), move |conn, (local, remote)| {
            transfer::upload(&app2, conn, &treg2, &sid, &local, &remote, &opts)
        });
        Ok(finish_batch(&app, &treg, batch_id, total, ids, errors, &cancel))
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn download_directory(
    app: AppHandle,
    session_id: String,
    remote_dir: String,
    local_dir: String,
    max_workers: Option<usize>,
    bandwidth_kbps: Option<u64>,
    chunk_kb: Option<u64>,
    verify: Option<bool>,
) -> Result<BatchResult, PylonError> {
    blocking(move || {
        let registry = app.state::<SessionRegistry>();
        let primary = registry.get_conn(&session_id)?;
        let auth = registry.get_auth(&session_id)?;
        let treg = (*app.state::<TransferRegistry>()).clone();

        let all = rsftp::recursive_list(&primary, &remote_dir)?;
        let base = remote_dir.trim_end_matches('/').to_string();
        let local_root = PathBuf::from(&local_dir);
        let local_for = |remote: &str| -> PathBuf {
            let rel = remote.strip_prefix(&base).unwrap_or(remote).trim_start_matches('/');
            rel.split('/').filter(|c| !c.is_empty()).fold(local_root.clone(), |acc, c| acc.join(sanitize_local_component(c)))
        };

        std::fs::create_dir_all(&local_root).map_err(|e| PylonError::Io(format!("create {}: {e}", local_root.display())))?;
        for e in all.iter().filter(|e| e.is_dir) {
            let _ = std::fs::create_dir_all(local_for(&e.path));
        }
        let jobs: Vec<(String, String)> = all
            .iter()
            .filter(|e| !e.is_dir && !transfer::is_partial_name(&e.name))
            .map(|e| (e.path.clone(), local_for(&e.path).to_string_lossy().into_owned()))
            .collect();
        let total_bytes: u64 = all.iter().filter(|e| !e.is_dir).filter_map(|e| e.size).sum();

        let (batch_id, cancel) = treg.new_batch();
        let name = Path::new(&base).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| remote_dir.clone());
        let _ = app.emit("transfer://batch-new", serde_json::json!({
            "batch_id": &batch_id, "session_id": &session_id, "direction": "download",
            "name": &name, "local_dir": &local_dir, "remote_dir": &remote_dir,
            "total_files": jobs.len(), "total_bytes": total_bytes,
        }));

        let total = jobs.len();
        let mut opts = TransferOpts::new(false, bandwidth_kbps, chunk_kb);
        opts.batch_id = Some(batch_id.clone());
        opts.verify = verify.unwrap_or(true);
        let (app2, treg2, sid) = (app.clone(), treg.clone(), session_id.clone());
        let (ids, errors) = run_pool(primary, auth, max_workers.unwrap_or(4), jobs, cancel.clone(), move |conn, (remote, local)| {
            transfer::download(&app2, conn, &treg2, &sid, &remote, &local, &opts)
        });
        Ok(finish_batch(&app, &treg, batch_id, total, ids, errors, &cancel))
    })
    .await
}

#[tauri::command]
pub async fn cancel_transfer(app: AppHandle, transfer_id: String) -> Result<(), PylonError> {
    app.state::<TransferRegistry>().cancel(&transfer_id);
    Ok(())
}

#[tauri::command]
pub async fn cancel_batch(app: AppHandle, batch_id: String) -> Result<(), PylonError> {
    app.state::<TransferRegistry>().cancel_batch(&batch_id);
    Ok(())
}

#[tauri::command]
pub async fn pause_transfer(app: AppHandle, transfer_id: String) -> Result<(), PylonError> {
    app.state::<TransferRegistry>().pause(&transfer_id);
    Ok(())
}

#[tauri::command]
pub async fn resume_transfer_cmd(app: AppHandle, transfer_id: String) -> Result<(), PylonError> {
    app.state::<TransferRegistry>().resume_transfer(&transfer_id);
    Ok(())
}

#[tauri::command]
pub async fn set_transfer_rate_limit(app: AppHandle, transfer_id: String, bytes_per_sec: Option<u64>) -> Result<(), PylonError> {
    app.state::<TransferRegistry>().set_rate_limit(&transfer_id, bytes_per_sec);
    Ok(())
}

#[tauri::command]
pub async fn list_transfers(app: AppHandle) -> Result<Vec<TransferRecord>, PylonError> {
    Ok(app.state::<TransferRegistry>().list())
}

#[tauri::command]
pub async fn clear_finished_transfers(app: AppHandle) -> Result<(), PylonError> {
    app.state::<TransferRegistry>().clear_finished();
    Ok(())
}
