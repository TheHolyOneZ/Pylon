

use std::{
    collections::HashMap,
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use sha2::{Digest, Sha256};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::{
    error::{PylonError, PylonResult},
    metadata,
};

pub const CHUNK_SIZE: usize = 512 * 1024;

/// Enrich an SFTP error message with a human-readable explanation of the
/// numeric SFTP status code so that users and logs don't see bare "SFTP(N)".
fn sftp_rich_error(op: &str, path: &str, raw: &str) -> String {

    let code_hint = if raw.contains("SFTP(2)") {
        Some("no such file or directory")
    } else if raw.contains("SFTP(3)") {
        Some("permission denied")
    } else if raw.contains("SFTP(4)") {
        Some("permission denied / general failure")
    } else if raw.contains("SFTP(8)") {
        Some("file already exists")
    } else if raw.contains("SFTP(14)") {
        Some("no space left on device")
    } else {
        None
    };
    match code_hint {
        Some(hint) => format!("{op} {path}: {raw} [{hint}]"),
        None => format!("{op} {path}: {raw}"),
    }
}

#[inline]
fn effective_chunk(chunk_kb: Option<u64>) -> usize {
    chunk_kb.map(|kb| (kb as usize).max(16) * 1024).unwrap_or(CHUNK_SIZE)
}


const RUNNING: u8 = 0;
const PAUSED: u8 = 1;
const CANCELLED: u8 = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TransferState {
    Queued,
    Running,
    Paused,
    Completed,
    Failed(String),
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferRecord {
    pub id: String,
    pub session_id: String,
    pub batch_id: Option<String>,
    pub direction: TransferDirection,
    pub local_path: String,
    pub remote_path: String,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub resume_offset: u64,
    pub state: TransferState,
    pub strip_metadata: bool,
    pub rate_limit_bps: Option<u64>,
    pub sha256_local: Option<String>,
    pub sha256_remote: Option<String>,
    pub checksum_verified: Option<bool>,
    pub retry_count: u32,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TransferDirection {
    Upload,
    Download,
}

#[derive(Serialize, Clone)]
pub struct TransferProgress {
    pub id: String,
    pub transferred_bytes: u64,
    pub total_bytes: u64,
    pub percent: f32,
    pub speed_bps: f64,
    pub eta_secs: Option<f64>,
    pub state: TransferState,
}

#[derive(Serialize, Clone)]
pub struct ChecksumResult {
    pub transfer_id: String,
    pub sha256_local: String,
    pub sha256_remote: Option<String>,
    pub verified: bool,
}

pub struct ControlFlags {
    state: AtomicU8,
}

impl ControlFlags {
    fn new() -> Arc<Self> {
        Arc::new(Self { state: AtomicU8::new(RUNNING) })
    }
    fn is_cancelled(&self) -> bool { self.state.load(Ordering::Relaxed) == CANCELLED }
    fn is_paused(&self) -> bool { self.state.load(Ordering::Relaxed) == PAUSED }
    fn cancel(&self) { self.state.store(CANCELLED, Ordering::Relaxed); }
    fn pause(&self) { self.state.store(PAUSED, Ordering::Relaxed); }
    fn resume(&self) { self.state.store(RUNNING, Ordering::Relaxed); }
}

#[derive(Clone)]
pub struct TransferRegistry {
    transfers: Arc<Mutex<HashMap<String, TransferRecord>>>,
    controls: Arc<Mutex<HashMap<String, Arc<ControlFlags>>>>,
}

impl TransferRegistry {
    pub fn new() -> Self {
        Self {
            transfers: Arc::new(Mutex::new(HashMap::new())),
            controls: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn register(&self, record: TransferRecord) -> Arc<ControlFlags> {
        let flags = ControlFlags::new();
        let id = record.id.clone();
        if let Ok(mut map) = self.transfers.lock() { map.insert(id.clone(), record); }
        if let Ok(mut map) = self.controls.lock() { map.insert(id, flags.clone()); }
        flags
    }

    pub fn update_progress(&self, id: &str, transferred: u64, sha256: Option<String>) {
        if let Ok(mut map) = self.transfers.lock() {
            if let Some(r) = map.get_mut(id) {
                r.transferred_bytes = transferred;
                r.state = TransferState::Running;
                if let Some(hash) = sha256 {
                    r.sha256_local = Some(hash);
                }
            }
        }
    }

    pub fn set_paused(&self, id: &str) {
        if let Ok(mut map) = self.transfers.lock() {
            if let Some(r) = map.get_mut(id) {
                r.state = TransferState::Paused;
            }
        }
    }

    pub fn finish(&self, id: &str, sha256: Option<String>, err: Option<String>) {
        if let Ok(mut map) = self.transfers.lock() {
            if let Some(r) = map.get_mut(id) {
                r.state = match err {
                    None => TransferState::Completed,
                    Some(ref e) => TransferState::Failed(e.clone()),
                };
                r.finished_at = Some(chrono::Utc::now().to_rfc3339());
                if let Some(hash) = sha256 {
                    r.sha256_local = Some(hash);
                }
            }
        }
        if let Ok(mut map) = self.controls.lock() { map.remove(id); }
    }

    pub fn cancel(&self, id: &str) {
        if let Ok(map) = self.controls.lock() {
            if let Some(flags) = map.get(id) {
                flags.cancel();
            }
        }
        if let Ok(mut map) = self.transfers.lock() {
            if let Some(r) = map.get_mut(id) {
                r.state = TransferState::Cancelled;
            }
        }
    }

    pub fn pause(&self, id: &str) {
        if let Ok(map) = self.controls.lock() {
            if let Some(flags) = map.get(id) {
                flags.pause();
            }
        }
    }

    pub fn resume_transfer(&self, id: &str) {
        if let Ok(map) = self.controls.lock() {
            if let Some(flags) = map.get(id) {
                flags.resume();
            }
        }
        if let Ok(mut map) = self.transfers.lock() {
            if let Some(r) = map.get_mut(id) {
                r.state = TransferState::Running;
            }
        }
    }

    pub fn set_rate_limit(&self, id: &str, bps: Option<u64>) {
        if let Ok(mut map) = self.transfers.lock() {
            if let Some(r) = map.get_mut(id) {
                r.rate_limit_bps = bps;
            }
        }
    }

    pub fn get_record(&self, id: &str) -> Option<TransferRecord> {
        self.transfers.lock().ok()?.get(id).cloned()
    }

    pub fn set_checksum_verified(&self, id: &str, local: String, verified: bool) {
        if let Ok(mut map) = self.transfers.lock() {
            if let Some(r) = map.get_mut(id) {
                r.sha256_local = Some(local);
                r.checksum_verified = Some(verified);
            }
        }
    }

    pub fn list(&self) -> Vec<TransferRecord> {
        let mut v: Vec<TransferRecord> = self.transfers.lock()
            .map(|m| m.values().cloned().collect())
            .unwrap_or_default();
        v.sort_by(|a, b| a.started_at.cmp(&b.started_at));
        v
    }
}

fn is_safe_to_upload(local_path: &str) -> PylonResult<()> {
    let meta = std::fs::symlink_metadata(local_path)
        .map_err(|e| PylonError::Io(format!("stat {local_path}: {e}")))?;
    if meta.file_type().is_symlink() {
        return Err(PylonError::Transfer(format!(
            "Refusing to upload symlink directly: {local_path}"
        )));
    }
    Ok(())
}

fn unique_tmp_path(final_path: &str) -> String {
    let uid = Uuid::new_v4().simple().to_string();
    let uid_short = &uid[..8];
    if let Some(parent) = Path::new(final_path).parent() {
        let fname = Path::new(final_path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "file".to_string());
        format!("{}/.pylon_tmp_{}_{}", parent.display(), uid_short, fname)
    } else {
        format!("{}.pylon_tmp_{}", final_path, uid_short)
    }
}

/// Upload a local file to a remote path with resume, atomic writes, and SHA-256.
pub fn upload(
    app: &AppHandle,
    session: &Arc<Mutex<ssh2::Session>>,
    registry: &TransferRegistry,
    session_id: String,
    local_path: String,
    remote_path: String,
    strip_metadata: bool,
    rate_limit_bps: Option<u64>,
    batch_id: Option<String>,
    chunk_kb: Option<u64>,
) -> PylonResult<String> {
    let chunk_size = effective_chunk(chunk_kb);
    let id = Uuid::new_v4().to_string();

    is_safe_to_upload(&local_path)?;

    let raw_data = std::fs::read(&local_path)?;

    let data = if strip_metadata {
        match metadata::strip_bytes(&raw_data, Path::new(&local_path)) {
            Ok(clean) => clean,
            Err(e) => {
                tracing::warn!("metadata strip failed for {}: {} — uploading original", local_path, e);
                raw_data
            }
        }
    } else {
        raw_data
    };
    let total = data.len() as u64;

    let resume_offset = {
        if let Ok(sess) = session.lock() {
            if let Ok(sftp) = sess.sftp() {
                sftp.stat(Path::new(&remote_path))
                    .ok()
                    .and_then(|s| s.size)
                    .filter(|&s| s < total)
                    .unwrap_or(0)
            } else {
                0
            }
        } else {
            0
        }
    };

    let tmp_remote = unique_tmp_path(&remote_path);

    let _ = app.emit("transfer://new", serde_json::json!({
        "id": &id,
        "session_id": &session_id,
        "batch_id": &batch_id,
        "direction": "upload",
        "local_path": &local_path,
        "remote_path": &remote_path,
    }));

    let record = TransferRecord {
        id: id.clone(),
        session_id,
        batch_id: batch_id.clone(),
        direction: TransferDirection::Upload,
        local_path: local_path.clone(),
        remote_path: remote_path.clone(),
        total_bytes: total,
        transferred_bytes: resume_offset,
        resume_offset,
        state: TransferState::Running,
        strip_metadata,
        rate_limit_bps,
        sha256_local: None,
        sha256_remote: None,
        checksum_verified: None,
        retry_count: 0,
        started_at: Some(chrono::Utc::now().to_rfc3339()),
        finished_at: None,
    };
    let flags = registry.register(record);

    let mut hasher = Sha256::new();
    let mut written = resume_offset;
    let start_time = Instant::now();

    let result: PylonResult<()> = (|| {
        let sess = session.lock().map_err(|_| PylonError::Transfer("Session lock poisoned".into()))?;
        let sftp = sess.sftp().map_err(|e| PylonError::Sftp(e.to_string()))?;


        if let Some(parent) = Path::new(&remote_path).parent() {
            let parent_str = parent.to_string_lossy();
            if !parent_str.is_empty() && parent_str != "/" {
                let parts: Vec<&str> = parent_str.trim_start_matches('/').split('/').collect();
                let mut current = String::new();
                for part in &parts {
                    if part.is_empty() { continue; }
                    current = format!("{current}/{part}");
                    let stat = sftp.stat(Path::new(&current));
                    match stat {
                        Ok(s) if s.is_dir() => {  }
                        Ok(_) => {

                            return Err(PylonError::Sftp(format!(
                                "remote path component is a file, not a directory: {current}"
                            )));
                        }
                        Err(_) => {
                            sftp.mkdir(Path::new(&current), 0o755).map_err(|e| {
                                PylonError::Sftp(format!("mkdir {current}: {e}"))
                            })?;
                        }
                    }
                }
            }
        }


        let mut actual_offset = resume_offset;
        let mut remote_file = if resume_offset > 0 {


            match sftp.open_mode(
                Path::new(&tmp_remote),
                ssh2::OpenFlags::WRITE | ssh2::OpenFlags::APPEND,
                0o644,
                ssh2::OpenType::File,
            ) {
                Ok(f) => f,
                Err(e) => {
                    let msg = e.to_string();


                    if msg.contains("SFTP(2)") || msg.contains("no such file") || msg.contains("No such file") {
                        tracing::warn!(
                            "resume: temp file {tmp_remote} not found on remote ({}), starting fresh",
                            msg
                        );
                        actual_offset = 0;
                        written = 0;
                        sftp.create(Path::new(&tmp_remote))
                            .map_err(|e2| PylonError::Sftp(sftp_rich_error("create", &tmp_remote, &e2.to_string())))?
                    } else {
                        return Err(PylonError::Sftp(sftp_rich_error("open append", &tmp_remote, &msg)));
                    }
                }
            }
        } else {
            sftp.create(Path::new(&tmp_remote))
                .map_err(|e| PylonError::Sftp(sftp_rich_error("create", &tmp_remote, &e.to_string())))?
        };

        if total == 0 {
            drop(remote_file);
            return Ok(());
        }

        let data_slice = &data[actual_offset as usize..];
        for chunk in data_slice.chunks(chunk_size) {

            while flags.is_paused() {
                registry.set_paused(&id);
                std::thread::sleep(Duration::from_millis(200));
                if flags.is_cancelled() { break; }
            }
            if flags.is_cancelled() {
                return Err(PylonError::Transfer("Cancelled".into()));
            }

            remote_file.write_all(chunk).map_err(|e| {
                let msg = e.to_string();

                if msg.contains("SFTP(14)") || msg.contains("no space") {
                    PylonError::Transfer(format!("write chunk to {tmp_remote}: {msg} [no space left on device]"))
                } else {
                    PylonError::Transfer(format!("write chunk to {tmp_remote}: {msg}"))
                }
            })?;
            hasher.update(chunk);
            written += chunk.len() as u64;

            if let Some(bps) = rate_limit_bps {
                if bps > 0 {
                    let expected = Duration::from_secs_f64(written as f64 / bps as f64);
                    let actual = start_time.elapsed();
                    if expected > actual {
                        std::thread::sleep(expected - actual);
                    }
                }
            }

            let elapsed_total = start_time.elapsed().as_secs_f64();
            let speed = if elapsed_total > 0.0 { written as f64 / elapsed_total } else { 0.0 };
            let remaining = total.saturating_sub(written) as f64;
            let eta = if speed > 0.0 { Some(remaining / speed) } else { None };

            registry.update_progress(&id, written, None);
            emit_progress(app, &id, written, total, speed, eta, TransferState::Running);
        }
        Ok(())
    })();

    let sha256_hex = hex::encode(hasher.finalize());

    match result {
        Ok(()) => {
            let rename_result = {
                if let Ok(sess) = session.lock() {
                    if let Ok(sftp) = sess.sftp() {


                        let _ = sftp.unlink(Path::new(&remote_path));
                        sftp.rename(
                            Path::new(&tmp_remote),
                            Path::new(&remote_path),
                            Some(ssh2::RenameFlags::OVERWRITE | ssh2::RenameFlags::ATOMIC),
                        ).map_err(|e| PylonError::Sftp(sftp_rich_error("rename", &remote_path, &e.to_string())))
                    } else {
                        Err(PylonError::Sftp("sftp channel unavailable for rename".into()))
                    }
                } else {
                    Err(PylonError::Transfer("Session lock poisoned on rename".into()))
                }
            };

            match rename_result {
                Ok(()) => {
                    registry.finish(&id, Some(sha256_hex.clone()), None);
                    emit_progress(app, &id, total, total, 0.0, Some(0.0), TransferState::Completed);
                    let _ = app.emit("transfer://complete", ChecksumResult {
                        transfer_id: id.clone(),
                        sha256_local: sha256_hex,
                        sha256_remote: None,
                        verified: false,
                    });
                    Ok(id)
                }
                Err(e) => {


                    cleanup_remote_temp(session, &tmp_remote);
                    let msg = e.to_string();
                    registry.finish(&id, None, Some(msg.clone()));
                    emit_progress(app, &id, total, total, 0.0, None, TransferState::Failed(msg.clone()));
                    Err(e)
                }
            }
        }
        Err(e) => {

            cleanup_remote_temp(session, &tmp_remote);
            let is_cancel = e.to_string().contains("Cancelled");
            if is_cancel {
                registry.finish(&id, None, Some("Cancelled".into()));
                emit_progress(app, &id, written, total, 0.0, None, TransferState::Cancelled);
                Ok(id)
            } else {
                let msg = e.to_string();
                registry.finish(&id, None, Some(msg.clone()));
                emit_progress(app, &id, written, total, 0.0, None, TransferState::Failed(msg.clone()));
                Err(e)
            }
        }
    }
}

/// Best-effort removal of a remote temp file.  Never panics.
fn cleanup_remote_temp(session: &Arc<Mutex<ssh2::Session>>, tmp_path: &str) {
    if let Ok(sess) = session.lock() {
        if let Ok(sftp) = sess.sftp() {
            let _ = sftp.unlink(Path::new(tmp_path));
        }
    }
}

/// Download a remote file to a local path with resume and atomic writes.
pub fn download(
    app: &AppHandle,
    session: &Arc<Mutex<ssh2::Session>>,
    registry: &TransferRegistry,
    session_id: String,
    remote_path: String,
    local_path: String,
    batch_id: Option<String>,
    rate_limit_bps: Option<u64>,
    chunk_kb: Option<u64>,
) -> PylonResult<String> {
    let chunk_size = effective_chunk(chunk_kb);
    let id = Uuid::new_v4().to_string();

    let (total, resume_offset) = {
        let sess = session.lock().map_err(|_| PylonError::Transfer("Session lock poisoned".into()))?;
        let sftp = sess.sftp().map_err(|e| PylonError::Sftp(e.to_string()))?;
        let stat = sftp.stat(Path::new(&remote_path)).map_err(|e| PylonError::Sftp(e.to_string()))?;
        let total = stat.size.unwrap_or(0);
        let existing_local = Path::new(&local_path).metadata().map(|m| m.len()).unwrap_or(0);
        let resume = if total > 0 && existing_local < total {
            existing_local
        } else {
            0
        };
        (total, resume)
    };

    if let Some(parent) = Path::new(&local_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| PylonError::Io(format!("create dirs for {}: {e}", local_path)))?;
    }

    let tmp_local = {
        let parent = Path::new(&local_path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| ".".to_string());
        let fname = Path::new(&local_path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "file".to_string());
        let uid = Uuid::new_v4().simple().to_string();
        format!("{parent}/.pylon_tmp_{}_{}", &uid[..8], fname)
    };

    let _ = app.emit("transfer://new", serde_json::json!({
        "id": &id,
        "session_id": &session_id,
        "batch_id": &batch_id,
        "direction": "download",
        "local_path": &local_path,
        "remote_path": &remote_path,
    }));

    let record = TransferRecord {
        id: id.clone(),
        session_id,
        batch_id: batch_id.clone(),
        direction: TransferDirection::Download,
        local_path: local_path.clone(),
        remote_path: remote_path.clone(),
        total_bytes: total,
        transferred_bytes: resume_offset,
        resume_offset,
        state: TransferState::Running,
        strip_metadata: false,
        rate_limit_bps,
        sha256_local: None,
        sha256_remote: None,
        checksum_verified: None,
        retry_count: 0,
        started_at: Some(chrono::Utc::now().to_rfc3339()),
        finished_at: None,
    };
    let flags = registry.register(record);

    let mut hasher = Sha256::new();
    let mut received = resume_offset;
    let start_time = Instant::now();

    let result: PylonResult<()> = (|| {
        let sess = session.lock().map_err(|_| PylonError::Transfer("Session lock poisoned".into()))?;
        let sftp = sess.sftp().map_err(|e| PylonError::Sftp(e.to_string()))?;

        let mut remote_file = sftp
            .open(Path::new(&remote_path))
            .map_err(|e| PylonError::Sftp(format!("open {remote_path}: {e}")))?;

        if resume_offset > 0 {
            remote_file.seek(SeekFrom::Start(resume_offset))
                .map_err(|e| PylonError::Transfer(format!("seek remote: {e}")))?;
        }

        let mut local_file = if resume_offset > 0 {
            std::fs::OpenOptions::new()
                .write(true)
                .append(true)
                .open(&tmp_local)
                .or_else(|_| std::fs::File::create(&tmp_local))
                .map_err(|e| PylonError::Io(format!("open tmp {}: {e}", tmp_local)))?
        } else {
            std::fs::File::create(&tmp_local)
                .map_err(|e| PylonError::Io(format!("create tmp {}: {e}", tmp_local)))?
        };

        if total == 0 {
            return Ok(());
        }

        let mut buf = vec![0u8; chunk_size];
        loop {
            while flags.is_paused() {
                registry.set_paused(&id);
                std::thread::sleep(Duration::from_millis(200));
                if flags.is_cancelled() { break; }
            }
            if flags.is_cancelled() {
                return Err(PylonError::Transfer("Cancelled".into()));
            }

            let n = remote_file.read(&mut buf)
                .map_err(|e| PylonError::Transfer(format!("read remote chunk: {e}")))?;
            if n == 0 { break; }

            local_file.write_all(&buf[..n])
                .map_err(|e| PylonError::Io(format!("write local chunk: {e}")))?;
            hasher.update(&buf[..n]);
            received += n as u64;

            if let Some(bps) = rate_limit_bps {
                if bps > 0 {
                    let expected = Duration::from_secs_f64(received as f64 / bps as f64);
                    let actual = start_time.elapsed();
                    if expected > actual {
                        std::thread::sleep(expected - actual);
                    }
                }
            }

            let elapsed_total = start_time.elapsed().as_secs_f64();
            let speed = if elapsed_total > 0.0 { received as f64 / elapsed_total } else { 0.0 };
            let remaining = total.saturating_sub(received) as f64;
            let eta = if speed > 0.0 { Some(remaining / speed) } else { None };

            registry.update_progress(&id, received, None);
            emit_progress(app, &id, received, total, speed, eta, TransferState::Running);
        }
        Ok(())
    })();

    let sha256_hex = hex::encode(hasher.finalize());

    match result {
        Ok(()) => {
            std::fs::rename(&tmp_local, &local_path)
                .map_err(|e| {
                    let _ = std::fs::remove_file(&tmp_local);
                    PylonError::Io(format!("rename tmp to {}: {e}", local_path))
                })?;
            registry.finish(&id, Some(sha256_hex.clone()), None);
            emit_progress(app, &id, total, total, 0.0, Some(0.0), TransferState::Completed);
            let _ = app.emit("transfer://complete", ChecksumResult {
                transfer_id: id.clone(),
                sha256_local: sha256_hex,
                sha256_remote: None,
                verified: false,
            });
            Ok(id)
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp_local);
            let is_cancel = e.to_string().contains("Cancelled");
            if is_cancel {
                registry.finish(&id, None, Some("Cancelled".into()));
                emit_progress(app, &id, received, total, 0.0, None, TransferState::Cancelled);
                Ok(id)
            } else {
                let msg = e.to_string();
                registry.finish(&id, None, Some(msg.clone()));
                emit_progress(app, &id, received, total, 0.0, None, TransferState::Failed(msg.clone()));
                Err(e)
            }
        }
    }
}

fn emit_progress(
    app: &AppHandle,
    id: &str,
    transferred: u64,
    total: u64,
    speed_bps: f64,
    eta_secs: Option<f64>,
    state: TransferState,
) {
    let percent = if total > 0 { (transferred as f32 / total as f32) * 100.0 } else { 100.0 };
    let _ = app.emit(
        "transfer://progress",
        TransferProgress {
            id: id.to_string(),
            transferred_bytes: transferred,
            total_bytes: total,
            percent,
            speed_bps,
            eta_secs,
            state,
        },
    );
}
