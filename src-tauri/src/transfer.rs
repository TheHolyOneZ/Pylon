use std::{
    collections::HashMap,
    fs::OpenOptions,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::{
    error::{PylonError, PylonResult},
    metadata,
    sftp::{self as rsftp},
    ssh::{is_not_found, sftp_error, SshConn},
};

pub const DEFAULT_CHUNK: usize = 256 * 1024;
pub const STRIP_MAX_BYTES: u64 = 256 * 1024 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(125);
pub const PARTIAL_SUFFIX: &str = ".pylon-part";

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TransferDirection {
    Upload,
    Download,
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
    rate_limit: AtomicU64,
}

impl ControlFlags {
    fn new(rate: Option<u64>) -> Arc<Self> {
        Arc::new(Self { state: AtomicU8::new(RUNNING), rate_limit: AtomicU64::new(rate.unwrap_or(0)) })
    }
    fn is_cancelled(&self) -> bool {
        self.state.load(Ordering::Relaxed) == CANCELLED
    }
    fn is_paused(&self) -> bool {
        self.state.load(Ordering::Relaxed) == PAUSED
    }
}

#[derive(Clone, Default)]
pub struct TransferRegistry {
    transfers: Arc<Mutex<HashMap<String, TransferRecord>>>,
    controls: Arc<Mutex<HashMap<String, Arc<ControlFlags>>>>,
    batches: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl TransferRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn register(&self, record: TransferRecord) -> Arc<ControlFlags> {
        let flags = ControlFlags::new(record.rate_limit_bps);
        let id = record.id.clone();
        self.transfers.lock().unwrap().insert(id.clone(), record);
        self.controls.lock().unwrap().insert(id, flags.clone());
        flags
    }

    fn update(&self, id: &str, f: impl FnOnce(&mut TransferRecord)) {
        if let Some(r) = self.transfers.lock().unwrap().get_mut(id) {
            f(r);
        }
    }

    fn finish(&self, id: &str, state: TransferState, sha256: Option<String>) {
        self.update(id, |r| {
            r.state = state;
            r.finished_at = Some(chrono::Utc::now().to_rfc3339());
            if sha256.is_some() {
                r.sha256_local = sha256;
            }
        });
        self.controls.lock().unwrap().remove(id);
    }

    pub fn cancel(&self, id: &str) {
        if let Some(f) = self.controls.lock().unwrap().get(id) {
            f.state.store(CANCELLED, Ordering::Relaxed);
        }
    }

    pub fn pause(&self, id: &str) {
        if let Some(f) = self.controls.lock().unwrap().get(id) {
            let _ = f.state.compare_exchange(RUNNING, PAUSED, Ordering::Relaxed, Ordering::Relaxed);
        }
    }

    pub fn resume_transfer(&self, id: &str) {
        if let Some(f) = self.controls.lock().unwrap().get(id) {
            let _ = f.state.compare_exchange(PAUSED, RUNNING, Ordering::Relaxed, Ordering::Relaxed);
        }
    }

    pub fn set_rate_limit(&self, id: &str, bps: Option<u64>) {
        if let Some(f) = self.controls.lock().unwrap().get(id) {
            f.rate_limit.store(bps.unwrap_or(0), Ordering::Relaxed);
        }
        self.update(id, |r| r.rate_limit_bps = bps);
    }

    pub fn get_record(&self, id: &str) -> Option<TransferRecord> {
        self.transfers.lock().unwrap().get(id).cloned()
    }

    pub fn list(&self) -> Vec<TransferRecord> {
        let mut v: Vec<TransferRecord> = self.transfers.lock().unwrap().values().cloned().collect();
        v.sort_by(|a, b| a.started_at.cmp(&b.started_at));
        v
    }

    pub fn clear_finished(&self) {
        self.transfers
            .lock()
            .unwrap()
            .retain(|_, r| matches!(r.state, TransferState::Running | TransferState::Paused | TransferState::Queued));
    }

    pub fn new_batch(&self) -> (String, Arc<AtomicBool>) {
        let id = Uuid::new_v4().to_string();
        let flag = Arc::new(AtomicBool::new(false));
        self.batches.lock().unwrap().insert(id.clone(), flag.clone());
        (id, flag)
    }

    pub fn end_batch(&self, id: &str) {
        self.batches.lock().unwrap().remove(id);
    }

    pub fn cancel_batch(&self, batch_id: &str) {
        if let Some(f) = self.batches.lock().unwrap().get(batch_id) {
            f.store(true, Ordering::Relaxed);
        }
        let ids: Vec<String> = self
            .transfers
            .lock()
            .unwrap()
            .values()
            .filter(|r| r.batch_id.as_deref() == Some(batch_id))
            .map(|r| r.id.clone())
            .collect();
        for id in ids {
            self.cancel(&id);
        }
    }
}

#[derive(Clone, Debug)]
pub struct TransferOpts {
    pub strip_metadata: bool,
    pub rate_limit_bps: Option<u64>,
    pub chunk_size: usize,
    pub batch_id: Option<String>,
    pub verify: bool,
}

const VERIFY_MIN_BYTES: u64 = 1024 * 1024;

fn remote_sha256(conn: &SshConn, path: &str) -> Option<String> {
    let q = format!("'{}'", path.replace('\'', "'\\''"));
    let cmd = format!("sha256sum -- {q} 2>/dev/null || shasum -a 256 -- {q} 2>/dev/null");
    let mut ch = conn.sess.channel_session().ok()?;
    ch.exec(&cmd).ok()?;
    let mut out = String::new();
    let _ = ch.read_to_string(&mut out);
    let _ = ch.wait_close();
    let hex = out.split_whitespace().next()?.to_lowercase();
    (hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit())).then_some(hex)
}

fn verify_remote(conn: &SshConn, registry: &TransferRegistry, id: &str, remote: &str, local_sha: &str, size: u64, opts: &TransferOpts) -> PylonResult<()> {
    if !opts.verify || size < VERIFY_MIN_BYTES {
        return Ok(());
    }
    let Some(remote_sha) = remote_sha256(conn, remote) else { return Ok(()) };
    let ok = remote_sha == local_sha;
    registry.update(id, |r| {
        r.sha256_remote = Some(remote_sha.clone());
        r.checksum_verified = Some(ok);
    });
    if !ok {
        return Err(PylonError::Transfer(format!(
            "Checksum mismatch for {remote}: local {}… vs server {}… — the copy is not identical",
            &local_sha[..12], &remote_sha[..12]
        )));
    }
    Ok(())
}

impl TransferOpts {
    pub fn new(strip_metadata: bool, bandwidth_kbps: Option<u64>, chunk_kb: Option<u64>) -> Self {
        Self {
            strip_metadata,
            rate_limit_bps: bandwidth_kbps.filter(|k| *k > 0).map(|k| k * 1024),
            chunk_size: chunk_kb.map(|kb| (kb as usize).clamp(16, 4096) * 1024).unwrap_or(DEFAULT_CHUNK),
            batch_id: None,
            verify: true,
        }
    }
}

fn partial_key(parts: &[&str]) -> String {
    let mut h = Sha256::new();
    for p in parts {
        h.update(p.as_bytes());
        h.update([0]);
    }
    hex::encode(&h.finalize()[..5])
}

fn partial_name(final_name: &str, key: &str) -> String {
    format!(".{final_name}.{key}{PARTIAL_SUFFIX}")
}

pub fn is_partial_name(name: &str) -> bool {
    name.ends_with(PARTIAL_SUFFIX) || name.starts_with(".pylon_tmp")
}

pub fn sanitize_local_component(name: &str) -> String {
    if !cfg!(windows) {
        return name.to_string();
    }
    let mut s: String = name
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || (c as u32) < 32 { '_' } else { c })
        .collect();
    while s.ends_with('.') || s.ends_with(' ') {
        s.pop();
    }
    let upper = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3"];
    if reserved.contains(&upper.as_str()) {
        s.insert(0, '_');
    }
    if s.is_empty() {
        s.push('_');
    }
    s
}

struct Meter<'a> {
    app: &'a AppHandle,
    id: &'a str,
    total: u64,
    start: Instant,
    last_emit: Instant,
    last_bytes: u64,
    speed: f64,
}

impl<'a> Meter<'a> {
    fn new(app: &'a AppHandle, id: &'a str, total: u64, base: u64) -> Self {
        let now = Instant::now();
        Self { app, id, total, start: now, last_emit: now - PROGRESS_INTERVAL, last_bytes: base, speed: 0.0 }
    }

    fn tick(&mut self, done: u64, registry: &TransferRegistry, force: bool) {
        let now = Instant::now();
        let dt = now.duration_since(self.last_emit);
        if !force && dt < PROGRESS_INTERVAL {
            return;
        }
        let secs = dt.as_secs_f64().max(1e-3);
        let inst = (done.saturating_sub(self.last_bytes)) as f64 / secs;
        self.speed = if self.speed == 0.0 { inst } else { self.speed * 0.7 + inst * 0.3 };
        self.last_emit = now;
        self.last_bytes = done;
        registry.update(self.id, |r| {
            r.transferred_bytes = done;
            r.state = TransferState::Running;
        });
        let eta = if self.speed > 1.0 { Some(self.total.saturating_sub(done) as f64 / self.speed) } else { None };
        emit_progress(self.app, self.id, done, self.total, self.speed, eta, TransferState::Running);
    }

    fn throttle(&self, flags: &ControlFlags, sent_since_start: u64) {
        let bps = flags.rate_limit.load(Ordering::Relaxed);
        if bps == 0 {
            return;
        }
        let expected = Duration::from_secs_f64(sent_since_start as f64 / bps as f64);
        let actual = self.start.elapsed();
        if expected > actual {
            std::thread::sleep((expected - actual).min(Duration::from_secs(2)));
        }
    }
}

fn checkpoint(app: &AppHandle, registry: &TransferRegistry, flags: &ControlFlags, id: &str, done: u64, total: u64) -> PylonResult<Duration> {
    let paused_at = Instant::now();
    if flags.is_paused() {
        registry.update(id, |r| r.state = TransferState::Paused);
        emit_progress(app, id, done, total, 0.0, None, TransferState::Paused);
        while flags.is_paused() {
            std::thread::sleep(Duration::from_millis(100));
        }
        if !flags.is_cancelled() {
            registry.update(id, |r| r.state = TransferState::Running);
            emit_progress(app, id, done, total, 0.0, None, TransferState::Running);
        }
    }
    if flags.is_cancelled() {
        return Err(PylonError::Transfer("Cancelled".into()));
    }
    Ok(paused_at.elapsed())
}

fn emit_progress(app: &AppHandle, id: &str, transferred: u64, total: u64, speed_bps: f64, eta_secs: Option<f64>, state: TransferState) {
    let percent = if total > 0 { ((transferred as f64 / total as f64) * 100.0).min(100.0) as f32 } else { 100.0 };
    let _ = app.emit(
        "transfer://progress",
        TransferProgress { id: id.to_string(), transferred_bytes: transferred, total_bytes: total, percent, speed_bps, eta_secs, state },
    );
}

fn mtime_secs(meta: &std::fs::Metadata) -> u64 {
    meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}

fn hash_prefix(path: &Path, len: u64, hasher: &mut Sha256) -> PylonResult<()> {
    let mut f = std::fs::File::open(path)?.take(len);
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(())
}

#[cfg(unix)]
fn local_mode(meta: &std::fs::Metadata) -> i32 {
    use std::os::unix::fs::PermissionsExt;
    (meta.permissions().mode() & 0o777) as i32
}
#[cfg(not(unix))]
fn local_mode(_meta: &std::fs::Metadata) -> i32 {
    0o644
}

#[allow(clippy::too_many_arguments)]
fn new_record(
    id: &str,
    session_id: &str,
    direction: TransferDirection,
    local: &str,
    remote: &str,
    total: u64,
    offset: u64,
    opts: &TransferOpts,
) -> TransferRecord {
    TransferRecord {
        id: id.to_string(),
        session_id: session_id.to_string(),
        batch_id: opts.batch_id.clone(),
        direction,
        local_path: local.to_string(),
        remote_path: remote.to_string(),
        total_bytes: total,
        transferred_bytes: offset,
        resume_offset: offset,
        state: TransferState::Running,
        strip_metadata: opts.strip_metadata,
        rate_limit_bps: opts.rate_limit_bps,
        sha256_local: None,
        sha256_remote: None,
        checksum_verified: None,
        retry_count: 0,
        started_at: Some(chrono::Utc::now().to_rfc3339()),
        finished_at: None,
    }
}

fn conclude(
    app: &AppHandle,
    registry: &TransferRegistry,
    flags: &ControlFlags,
    id: &str,
    result: PylonResult<(u64, String)>,
    total: u64,
) -> PylonResult<String> {
    match result {
        Ok((done, sha)) => {
            registry.finish(id, TransferState::Completed, Some(sha.clone()));
            emit_progress(app, id, done, total.max(done), 0.0, Some(0.0), TransferState::Completed);
            let rec = registry.get_record(id);
            let _ = app.emit("transfer://complete", ChecksumResult {
                transfer_id: id.to_string(),
                sha256_local: sha,
                sha256_remote: rec.as_ref().and_then(|r| r.sha256_remote.clone()),
                verified: rec.and_then(|r| r.checksum_verified).unwrap_or(false),
            });
            Ok(id.to_string())
        }
        Err(_) if flags.is_cancelled() => {
            let done = registry.get_record(id).map(|r| r.transferred_bytes).unwrap_or(0);
            registry.finish(id, TransferState::Cancelled, None);
            emit_progress(app, id, done, total, 0.0, None, TransferState::Cancelled);
            Ok(id.to_string())
        }
        Err(e) => {
            let done = registry.get_record(id).map(|r| r.transferred_bytes).unwrap_or(0);
            let msg = e.to_string();
            registry.finish(id, TransferState::Failed(msg.clone()), None);
            emit_progress(app, id, done, total, 0.0, None, TransferState::Failed(msg));
            Err(e)
        }
    }
}

pub fn upload(
    app: &AppHandle,
    conn: &SshConn,
    registry: &TransferRegistry,
    session_id: &str,
    local_path: &str,
    remote_path: &str,
    opts: &TransferOpts,
) -> PylonResult<String> {
    let id = Uuid::new_v4().to_string();
    let local = PathBuf::from(local_path);
    let meta = std::fs::metadata(&local).map_err(|e| PylonError::Io(format!("{local_path}: {e}")))?;
    if meta.is_dir() {
        return Err(PylonError::Transfer(format!("{local_path} is a folder — use folder upload")));
    }

    let mut stripped: Option<Vec<u8>> = None;
    if opts.strip_metadata && metadata::is_strippable(&local) {
        if meta.len() <= STRIP_MAX_BYTES {
            let raw = std::fs::read(&local)?;
            stripped = Some(match metadata::strip_bytes(&raw, &local) {
                Ok(clean) => clean,
                Err(e) => {
                    tracing::warn!("metadata strip failed for {local_path}: {e} — uploading original");
                    raw
                }
            });
        } else {
            tracing::warn!("{local_path} too large to strip metadata in memory; uploading original");
        }
    }
    let total = stripped.as_ref().map(|d| d.len() as u64).unwrap_or(meta.len());
    let final_name = remote_path.rsplit('/').next().unwrap_or("file").to_string();
    let parent_dir = rsftp::parent(remote_path).unwrap_or_else(|| "/".into());
    let key = partial_key(&[local_path, &meta.len().to_string(), &mtime_secs(&meta).to_string(), &stripped.is_some().to_string()]);
    let tmp_remote = rsftp::join(&parent_dir, &partial_name(&final_name, &key));
    let resumable = stripped.is_none();

    let record = new_record(&id, session_id, TransferDirection::Upload, local_path, remote_path, total, 0, opts);
    let flags = registry.register(record.clone());
    let _ = app.emit("transfer://new", &record);

    let result = (|| -> PylonResult<(u64, String)> {
        let sftp = conn.sftp()?;
        rsftp::mkdir_p_with(&sftp, &parent_dir)?;

        let existing_perm = match sftp.stat(Path::new(remote_path)) {
            Ok(st) if st.is_dir() => {
                return Err(PylonError::Transfer(format!("{remote_path} is a folder on the server")));
            }
            Ok(st) => st.perm.map(|p| p & 0o7777),
            Err(e) if is_not_found(&e) => None,
            Err(e) => return Err(sftp_error(&format!("stat {remote_path}"), &e)),
        };

        let mut offset = 0u64;
        if resumable {
            if let Ok(st) = sftp.stat(Path::new(&tmp_remote)) {
                if let Some(sz) = st.size.filter(|s| *s <= total) {
                    offset = sz;
                }
            }
        }

        let mut hasher = Sha256::new();
        let mut source: Box<dyn Read + '_> = match &stripped {
            Some(data) => Box::new(&data[..]),
            None => {
                let mut f = std::fs::File::open(&local)?;
                if offset > 0 {
                    hash_prefix(&local, offset, &mut hasher)?;
                    f.seek(SeekFrom::Start(offset))?;
                }
                Box::new(f)
            }
        };

        let flags_w = ssh2::OpenFlags::WRITE | ssh2::OpenFlags::CREATE | if offset == 0 { ssh2::OpenFlags::TRUNCATE } else { ssh2::OpenFlags::empty() };
        let mut remote_file = sftp
            .open_mode(Path::new(&tmp_remote), flags_w, 0o600, ssh2::OpenType::File)
            .map_err(|e| sftp_error(&format!("create {tmp_remote}"), &e))?;
        if offset > 0 {
            remote_file.seek(SeekFrom::Start(offset))?;
            registry.update(&id, |r| {
                r.resume_offset = offset;
                r.transferred_bytes = offset;
            });
        }

        let mut meter = Meter::new(app, &id, total, offset);
        let mut done = offset;
        let mut buf = vec![0u8; opts.chunk_size];
        loop {
            meter.start += checkpoint(app, registry, &flags, &id, done, total)?;
            let n = source.read(&mut buf)?;
            if n == 0 {
                break;
            }
            remote_file.write_all(&buf[..n]).map_err(|e| conn.io_error("Upload interrupted", &e))?;
            hasher.update(&buf[..n]);
            done += n as u64;
            meter.throttle(&flags, done - offset);
            meter.tick(done, registry, false);
        }
        drop(remote_file);
        checkpoint(app, registry, &flags, &id, done, total)?;

        if existing_perm.is_some() {
            sftp.unlink(Path::new(remote_path)).map_err(|e| sftp_error(&format!("replace {remote_path}"), &e))?;
        }
        sftp.rename(Path::new(&tmp_remote), Path::new(remote_path), None)
            .map_err(|e| sftp_error(&format!("rename into {remote_path}"), &e))?;
        let perm = existing_perm.unwrap_or(local_mode(&meta) as u32);
        let _ = sftp.setstat(
            Path::new(remote_path),
            ssh2::FileStat { size: None, uid: None, gid: None, perm: Some(perm), atime: None, mtime: None },
        );
        meter.tick(done, registry, true);
        let sha = hex::encode(hasher.finalize());
        verify_remote(conn, registry, &id, remote_path, &sha, done, opts)?;
        Ok((done, sha))
    })();

    if result.is_err() && (flags.is_cancelled() || !resumable) {
        if let Ok(sftp) = conn.sftp() {
            let _ = sftp.unlink(Path::new(&tmp_remote));
        }
    }
    conclude(app, registry, &flags, &id, result, total)
}

pub fn download(
    app: &AppHandle,
    conn: &SshConn,
    registry: &TransferRegistry,
    session_id: &str,
    remote_path: &str,
    local_path: &str,
    opts: &TransferOpts,
) -> PylonResult<String> {
    let id = Uuid::new_v4().to_string();
    let sftp = conn.sftp()?;
    let st = sftp.stat(Path::new(remote_path)).map_err(|e| sftp_error(&format!("stat {remote_path}"), &e))?;
    if st.is_dir() {
        return Err(PylonError::Transfer(format!("{remote_path} is a folder — use folder download")));
    }
    let total = st.size.unwrap_or(0);
    let remote_mtime = st.mtime.unwrap_or(0);

    let requested = PathBuf::from(local_path);
    let parent = requested.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    let file_name = sanitize_local_component(&requested.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into()));
    let final_local = parent.join(&file_name);
    let final_local_str = final_local.to_string_lossy().into_owned();
    let key = partial_key(&[remote_path, &total.to_string(), &remote_mtime.to_string()]);
    let tmp_local = parent.join(partial_name(&file_name, &key));

    let record = new_record(&id, session_id, TransferDirection::Download, &final_local_str, remote_path, total, 0, opts);
    let flags = registry.register(record.clone());
    let _ = app.emit("transfer://new", &record);

    let result = (|| -> PylonResult<(u64, String)> {
        std::fs::create_dir_all(&parent).map_err(|e| PylonError::Io(format!("create {}: {e}", parent.display())))?;
        if final_local.is_dir() {
            return Err(PylonError::Transfer(format!("{} is a folder", final_local.display())));
        }

        let mut offset = std::fs::metadata(&tmp_local).map(|m| m.len()).unwrap_or(0);
        if offset > total {
            offset = 0;
        }
        let mut hasher = Sha256::new();
        if offset > 0 {
            hash_prefix(&tmp_local, offset, &mut hasher)?;
        }

        let mut local_file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(&tmp_local)
            .map_err(|e| PylonError::Io(format!("open {}: {e}", tmp_local.display())))?;
        local_file.set_len(offset)?;
        local_file.seek(SeekFrom::Start(offset))?;

        let mut remote_file = sftp.open(Path::new(remote_path)).map_err(|e| sftp_error(&format!("open {remote_path}"), &e))?;
        if offset > 0 {
            remote_file.seek(SeekFrom::Start(offset))?;
            registry.update(&id, |r| {
                r.resume_offset = offset;
                r.transferred_bytes = offset;
            });
        }

        let mut meter = Meter::new(app, &id, total, offset);
        let mut done = offset;
        let mut buf = vec![0u8; opts.chunk_size];
        loop {
            meter.start += checkpoint(app, registry, &flags, &id, done, total)?;
            let n = remote_file.read(&mut buf).map_err(|e| conn.io_error("Download interrupted", &e))?;
            if n == 0 {
                break;
            }
            local_file.write_all(&buf[..n]).map_err(|e| PylonError::Io(format!("write {}: {e}", tmp_local.display())))?;
            hasher.update(&buf[..n]);
            done += n as u64;
            meter.throttle(&flags, done - offset);
            meter.tick(done, registry, false);
        }
        local_file.flush()?;
        drop(local_file);
        if done < total {
            return Err(PylonError::Transfer(format!(
                "{remote_path} ended early ({done} of {total} bytes) — it may have been truncated on the server"
            )));
        }
        checkpoint(app, registry, &flags, &id, done, total)?;
        let sha = hex::encode(hasher.finalize());
        if let Err(e) = verify_remote(conn, registry, &id, remote_path, &sha, done, opts) {
            let _ = std::fs::remove_file(&tmp_local);
            return Err(e);
        }

        std::fs::rename(&tmp_local, &final_local)
            .map_err(|e| PylonError::Io(format!("move into {}: {e}", final_local.display())))?;
        if remote_mtime > 0 {
            if let Ok(f) = OpenOptions::new().write(true).open(&final_local) {
                let _ = f.set_modified(UNIX_EPOCH + Duration::from_secs(remote_mtime));
            }
        }
        meter.tick(done, registry, true);
        Ok((done, sha))
    })();

    if result.is_err() && flags.is_cancelled() {
        let _ = std::fs::remove_file(&tmp_local);
    }
    conclude(app, registry, &flags, &id, result, total)
}
