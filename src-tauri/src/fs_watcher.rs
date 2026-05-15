use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::error::{PylonError, PylonResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SyncRule {
    AlwaysOverwrite,
    NewFilesOnly,
    UpdateExistingOnly,
    ConfirmAll,
    ConfirmOnOverwrite,
}

impl Default for SyncRule {
    fn default() -> Self { SyncRule::AlwaysOverwrite }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    pub id: String,
    pub label: String,
    pub local_root: String,
    pub remote_root: String,
    pub session_id: String,
    pub strip_metadata: bool,
    pub active: bool,
    pub events_processed: u64,
    pub bytes_synced: u64,
    pub exclude_patterns: Vec<String>,
    pub preserve_timestamps: bool,
    pub mirror_permissions: bool,
    pub rule: SyncRule,
    pub from_vault: bool,
    pub expected_host: String,
    pub expected_port: u16,
    #[serde(default)]
    pub keep_on_disconnect: bool,
    #[serde(default)]
    pub credential_id: String,
    #[serde(default)]
    pub expected_fingerprint: String,

    #[serde(default)]
    pub protected_patterns: Vec<String>,

    #[serde(default)]
    pub dry_run: bool,

    #[serde(default)]
    pub max_file_size_kb: Option<u64>,

    #[serde(default)]
    pub sync_deletes: bool,

    #[serde(default)]
    pub initial_sync_only: bool,
}

#[derive(Serialize, Clone)]
pub struct SyncEvent {
    pub sync_id: String,
    pub rel_path: String,
    pub kind: String,
    pub timestamp: String,
    pub skipped: bool,
}

#[derive(Serialize, Clone)]
pub struct SyncConfirmRequest {
    pub request_id: String,
    pub sync_id: String,
    pub sync_label: String,
    pub rel_path: String,
    pub reason: String,
}

#[derive(Serialize, Clone)]
pub struct SyncError {
    pub sync_id: String,
    pub sync_label: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq)]
enum PendingOp {
    Upsert,
    Delete,
}

struct WatchEntry {
    config: SyncConfig,
    _watcher: RecommendedWatcher,
}

pub struct WatcherRegistry {
    entries: Arc<Mutex<HashMap<String, WatchEntry>>>,
    confirm_pending: Arc<Mutex<HashMap<String, Option<bool>>>>,
    pause_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl WatcherRegistry {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(Mutex::new(HashMap::new())),
            confirm_pending: Arc::new(Mutex::new(HashMap::new())),
            pause_flags: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn on_session_removed(&self, session_id: &str) -> Vec<SyncConfig> {
        let mut entries = self.entries.lock().unwrap();
        let mut flags = self.pause_flags.lock().unwrap();

        let mut stopped = Vec::new();
        let mut to_remove = Vec::new();

        for (id, entry) in entries.iter() {
            if entry.config.session_id != session_id { continue; }
            if entry.config.keep_on_disconnect {
                if let Some(flag) = flags.get(id) {
                    flag.store(true, Ordering::Relaxed);
                }
            } else {
                to_remove.push(id.clone());
                stopped.push(entry.config.clone());
            }
        }

        for id in &to_remove {
            entries.remove(id);
            flags.remove(id);
        }

        stopped
    }

    pub fn update_keep_on_disconnect(&self, id: &str, keep: bool) -> PylonResult<()> {
        {
            let mut entries = self.entries.lock().unwrap();
            if let Some(entry) = entries.get_mut(id) {
                entry.config.keep_on_disconnect = keep;
            } else {
                return Err(PylonError::NotFound(format!("Sync {id}")));
            }
        }
        if keep {
            if let Ok(flags) = self.pause_flags.lock() {
                if let Some(flag) = flags.get(id) {
                    flag.store(false, Ordering::Relaxed);
                }
            }
        }
        Ok(())
    }

    pub fn confirm(&self, request_id: &str, approved: bool) {
        if let Ok(mut map) = self.confirm_pending.lock() {
            if let Some(slot) = map.get_mut(request_id) {
                *slot = Some(approved);
            }
        }
    }

    pub fn update_rule(&self, sync_id: &str, rule: SyncRule) -> PylonResult<()> {
        if let Some(entry) = self.entries.lock().unwrap().get_mut(sync_id) {
            entry.config.rule = rule;
            Ok(())
        } else {
            Err(PylonError::NotFound(format!("Sync {sync_id}")))
        }
    }

    pub fn update_dry_run(&self, sync_id: &str, dry_run: bool) -> PylonResult<()> {
        if let Some(entry) = self.entries.lock().unwrap().get_mut(sync_id) {
            entry.config.dry_run = dry_run;
            Ok(())
        } else {
            Err(PylonError::NotFound(format!("Sync {sync_id}")))
        }
    }

    pub fn start(
        &self,
        app: AppHandle,
        config: SyncConfig,
        session: Arc<Mutex<ssh2::Session>>,
    ) -> PylonResult<()> {
        let id = config.id.clone();
        let local_root = config.local_root.clone();
        let remote_root = config.remote_root.clone();
        let strip = config.strip_metadata;
        let preserve_ts = config.preserve_timestamps;
        let mirror_perms = config.mirror_permissions;
        let exclude = config.exclude_patterns.clone();
        let label = config.label.clone();
        let sync_id = id.clone();
        let from_vault = config.from_vault;
        let expected_fingerprint = config.expected_fingerprint.clone();

        let protected_patterns = config.protected_patterns.clone();
        let max_file_size_kb = config.max_file_size_kb;
        let initial_sync_only = config.initial_sync_only;

        let entries_ref = self.entries.clone();
        let confirm_pending = self.confirm_pending.clone();
        let pause_flag = Arc::new(AtomicBool::new(false));
        self.pause_flags.lock().unwrap().insert(id.clone(), pause_flag.clone());
        let pause_flag_flush = pause_flag.clone();
        let ignore_matcher = build_ignore_matcher(&local_root, &exclude);
        let protected_matcher = build_protected_matcher(&remote_root, &protected_patterns);

        let pending: Arc<Mutex<HashMap<PathBuf, (PendingOp, Instant)>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let pending_flush = pending.clone();
        let session_flush = session.clone();
        let local_root_flush = local_root.clone();
        let remote_root_flush = remote_root.clone();
        let app_flush = app.clone();
        let sync_id_flush = sync_id.clone();
        let label_flush = label.clone();
        let entries_flush = entries_ref.clone();

        std::thread::spawn(move || {

            let mut first_flush_done = false;

            loop {
                std::thread::sleep(Duration::from_millis(150));

                if pause_flag_flush.load(Ordering::Relaxed) { continue; }

                let due: Vec<(PathBuf, PendingOp)> = {
                    let now = Instant::now();
                    let mut map = pending_flush.lock().unwrap();
                    let due: Vec<_> = map
                        .iter()
                        .filter(|(_, (_, deadline))| *deadline <= now)
                        .map(|(p, (op, _))| (p.clone(), op.clone()))
                        .collect();
                    for (p, _) in &due { map.remove(p); }
                    due
                };

                if due.is_empty() {

                    if initial_sync_only && first_flush_done {
                        let _ = app_flush.emit("sync://done", serde_json::json!({
                            "sync_id": &sync_id_flush,
                            "sync_label": &label_flush,
                        }));

                        pause_flag_flush.store(true, Ordering::Relaxed);
                    }
                    continue;
                }

                if !expected_fingerprint.is_empty() {
                    let fp_ok = session_flush.lock().ok().map(|s| {
                        s.host_key()
                            .map(|(kb, _)| crate::known_hosts::sha256_fingerprint(kb) == expected_fingerprint)
                            .unwrap_or(false)
                    }).unwrap_or(false);
                    if !fp_ok {
                        let _ = app_flush.emit("sync://error", SyncError {
                            sync_id: sync_id_flush.clone(),
                            sync_label: label_flush.clone(),
                            reason: "host_key_mismatch".to_string(),
                        });
                        continue;
                    }
                }

                let (current_rule, current_dry_run, current_sync_deletes) = entries_flush
                    .lock()
                    .ok()
                    .and_then(|m| m.get(&sync_id_flush).map(|e| (
                        e.config.rule.clone(),
                        e.config.dry_run,
                        e.config.sync_deletes,
                    )))
                    .unwrap_or_else(|| (SyncRule::default(), false, false));

                let sftp_opt = if current_dry_run {
                    None
                } else {
                    let s = session_flush.lock().ok().and_then(|s| s.sftp().ok());
                    if s.is_none() {
                        let _ = app_flush.emit("sync://error", SyncError {
                            sync_id: sync_id_flush.clone(),
                            sync_label: label_flush.clone(),
                            reason: "session_unavailable".to_string(),
                        });
                        continue;
                    }
                    s
                };

                for (local_path, op) in &due {
                    let rel = local_path
                        .strip_prefix(&local_root_flush)
                        .unwrap_or(local_path)
                        .to_string_lossy()
                        .replace('\\', "/");
                    let remote = format!("{remote_root_flush}/{rel}");

                    if is_protected(&remote, &remote_root_flush, &protected_matcher) {
                        let _ = app_flush.emit("sync://event", SyncEvent {
                            sync_id: sync_id_flush.clone(),
                            rel_path: rel,
                            kind: "protected".to_string(),
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            skipped: true,
                        });
                        continue;
                    }

                    if matches!(op, PendingOp::Upsert) {
                        if let Some(max_kb) = max_file_size_kb {
                            if let Ok(meta) = std::fs::metadata(local_path) {
                                let size_kb = meta.len() / 1024;
                                if size_kb > max_kb {
                                    let _ = app_flush.emit("sync://event", SyncEvent {
                                        sync_id: sync_id_flush.clone(),
                                        rel_path: rel.clone(),
                                        kind: "size_limit".to_string(),
                                        timestamp: chrono::Utc::now().to_rfc3339(),
                                        skipped: true,
                                    });
                                    tracing::warn!(
                                        "sync {}: skipping {} ({} KB > {} KB limit)",
                                        sync_id_flush, rel, size_kb, max_kb
                                    );
                                    continue;
                                }
                            }
                        }
                    }

                    if matches!(op, PendingOp::Delete) && !current_sync_deletes {
                        let _ = app_flush.emit("sync://event", SyncEvent {
                            sync_id: sync_id_flush.clone(),
                            rel_path: rel,
                            kind: "skipped".to_string(),
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            skipped: true,
                        });
                        continue;
                    }

                    if current_dry_run {
                        let kind_str = match op {
                            PendingOp::Upsert => "dry_run_upload",
                            PendingOp::Delete => "dry_run_delete",
                        };
                        let _ = app_flush.emit("sync://event", SyncEvent {
                            sync_id: sync_id_flush.clone(),
                            rel_path: rel,
                            kind: kind_str.to_string(),
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            skipped: true,
                        });
                        continue;
                    }

                    let sftp = sftp_opt.as_ref().unwrap();

                    let (proceed, skipped) = match op {
                        PendingOp::Upsert => {
                            let exists = sftp.stat(Path::new(&remote)).is_ok();
                            match current_rule {
                                SyncRule::AlwaysOverwrite => (true, false),
                                SyncRule::NewFilesOnly => (!exists, exists),
                                SyncRule::UpdateExistingOnly => (exists, !exists),
                                SyncRule::ConfirmAll => {
                                    let approved = request_confirm(
                                        &app_flush, &confirm_pending,
                                        &sync_id_flush, &label_flush, &rel,
                                        if exists { "overwrite" } else { "new_file" },
                                        from_vault,
                                    );
                                    (approved, !approved)
                                }
                                SyncRule::ConfirmOnOverwrite => {
                                    if exists {
                                        let approved = request_confirm(
                                            &app_flush, &confirm_pending,
                                            &sync_id_flush, &label_flush, &rel,
                                            "overwrite", from_vault,
                                        );
                                        (approved, !approved)
                                    } else {
                                        (true, false)
                                    }
                                }
                            }
                        }
                        PendingOp::Delete => {
                            match current_rule {
                                SyncRule::AlwaysOverwrite | SyncRule::UpdateExistingOnly => (true, false),
                                SyncRule::NewFilesOnly => (false, true),
                                SyncRule::ConfirmAll | SyncRule::ConfirmOnOverwrite => {
                                    let approved = request_confirm(
                                        &app_flush, &confirm_pending,
                                        &sync_id_flush, &label_flush, &rel,
                                        "delete", from_vault,
                                    );
                                    (approved, !approved)
                                }
                            }
                        }
                    };

                    let kind_str = if skipped {
                        "skipped"
                    } else {
                        match op { PendingOp::Upsert => "modified", PendingOp::Delete => "deleted" }
                    };

                    if proceed {
                        match op {
                            PendingOp::Upsert => {
                                if local_path.is_file() {
                                    if let Err(e) = push_file_via_sftp(
                                        sftp, local_path, &remote,
                                        strip, preserve_ts, mirror_perms,
                                    ) {
                                        let detail = if from_vault {
                                            "upload failed".to_string()
                                        } else {
                                            e.to_string()
                                        };
                                        let _ = app_flush.emit("sync://error", SyncError {
                                            sync_id: sync_id_flush.clone(),
                                            sync_label: label_flush.clone(),
                                            reason: detail,
                                        });
                                    }
                                } else if local_path.is_dir() {
                                    let _ = sftp.mkdir(Path::new(&remote), 0o755);
                                }
                            }
                            PendingOp::Delete => {
                                if sftp.unlink(Path::new(&remote)).is_err() {
                                    let _ = sftp.rmdir(Path::new(&remote));
                                }
                            }
                        }
                    }

                    let _ = app_flush.emit("sync://event", SyncEvent {
                        sync_id: sync_id_flush.clone(),
                        rel_path: rel,
                        kind: kind_str.to_string(),
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        skipped,
                    });
                }

                first_flush_done = true;
            }
        });

        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            let Ok(event) = res else { return };
            let path = event.paths.first().cloned().unwrap_or_default();
            if is_ignored(&path, &ignore_matcher) { return; }
            let op = match event.kind {
                EventKind::Modify(_) | EventKind::Create(_) => PendingOp::Upsert,
                EventKind::Remove(_) => PendingOp::Delete,
                _ => return,
            };
            let deadline = Instant::now() + Duration::from_millis(100);
            pending.lock().unwrap().insert(path, (op, deadline));
        })
        .map_err(|e| PylonError::Watcher(e.to_string()))?;

        watcher
            .watch(Path::new(&config.local_root), RecursiveMode::Recursive)
            .map_err(|e| PylonError::Watcher(format!("Watch {}: {e}", config.local_root)))?;

        self.entries.lock().unwrap().insert(id, WatchEntry { config, _watcher: watcher });
        Ok(())
    }

    pub fn stop(&self, id: &str) -> PylonResult<()> {
        self.entries.lock().unwrap().remove(id)
            .ok_or_else(|| PylonError::NotFound(format!("Sync {id}")))?;
        self.pause_flags.lock().unwrap().remove(id);
        Ok(())
    }

    pub fn list(&self) -> Vec<SyncConfig> {
        self.entries.lock().unwrap().values().map(|e| e.config.clone()).collect()
    }

    pub fn get_config(&self, id: &str) -> Option<SyncConfig> {
        self.entries.lock().unwrap().get(id).map(|e| e.config.clone())
    }

    pub fn update_config(&self, id: &str, exclude_patterns: Vec<String>, strip_metadata: bool) -> PylonResult<()> {
        if let Some(entry) = self.entries.lock().unwrap().get_mut(id) {
            entry.config.exclude_patterns = exclude_patterns;
            entry.config.strip_metadata = strip_metadata;
            Ok(())
        } else {
            Err(PylonError::NotFound(format!("Sync {id}")))
        }
    }
}

fn request_confirm(
    app: &AppHandle,
    pending: &Arc<Mutex<HashMap<String, Option<bool>>>>,
    sync_id: &str,
    sync_label: &str,
    rel_path: &str,
    reason: &str,
    _from_vault: bool,
) -> bool {
    let request_id = Uuid::new_v4().to_string();
    pending.lock().unwrap().insert(request_id.clone(), None);

    let _ = app.emit("sync://confirm_request", SyncConfirmRequest {
        request_id: request_id.clone(),
        sync_id: sync_id.to_string(),
        sync_label: sync_label.to_string(),
        rel_path: rel_path.to_string(),
        reason: reason.to_string(),
    });

    let deadline = Instant::now() + Duration::from_secs(30);
    let decision = loop {
        if Instant::now() > deadline {
            let _ = app.emit("sync://confirm_timeout", serde_json::json!({
                "request_id": &request_id,
                "sync_id": sync_id,
            }));
            break false;
        }
        {
            let map = pending.lock().unwrap();
            if let Some(Some(v)) = map.get(&request_id) {
                break *v;
            }
        }
        std::thread::sleep(Duration::from_millis(80));
    };
    pending.lock().unwrap().remove(&request_id);
    decision
}

fn push_file_via_sftp(
    sftp: &ssh2::Sftp,
    local: &Path,
    remote: &str,
    strip: bool,
    preserve_ts: bool,
    mirror_perms: bool,
) -> PylonResult<()> {
    use std::io::Write;
    #[cfg(not(unix))]
    let _ = mirror_perms;

    let local_meta = std::fs::metadata(local)?;
    let raw = std::fs::read(local)?;
    let data = if strip {
        match crate::metadata::strip_bytes(&raw, local) {
            Ok(clean) => clean,
            Err(e) => {
                tracing::warn!("metadata strip failed for {}: {} — uploading original", local.display(), e);
                raw
            }
        }
    } else {
        raw
    };

    if let Some(parent) = Path::new(remote).parent() {
        let parent_str = parent.to_string_lossy();
        if !parent_str.is_empty() && parent_str != "/" {
            let parts: Vec<&str> = parent_str.trim_start_matches('/').split('/').collect();
            let mut current = String::new();
            for part in &parts {
                if part.is_empty() { continue; }
                current = format!("{current}/{part}");
                match sftp.stat(Path::new(&current)) {
                    Ok(s) if s.is_dir() => {}
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

    let _ = sftp.unlink(Path::new(remote));
    let mut f = sftp.create(Path::new(remote))
        .map_err(|e| PylonError::Sftp(format!("create {remote}: {e}")))?;
    for chunk in data.chunks(crate::sftp::CHUNK_SIZE) {
        f.write_all(chunk).map_err(|e| {
            let msg = e.to_string();
            if msg.contains("SFTP(14)") || msg.contains("no space") {
                PylonError::Transfer(format!("write to {remote}: {msg} [no space left on device]"))
            } else {
                PylonError::Transfer(format!("write to {remote}: {msg}"))
            }
        })?;
    }
    drop(f);

    if preserve_ts {
        let mtime = local_meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = sftp.setstat(Path::new(remote), ssh2::FileStat {
            size: None, uid: None, gid: None, perm: None,
            atime: Some(mtime), mtime: Some(mtime),
        });
    }

    #[cfg(unix)]
    if mirror_perms {
        use std::os::unix::fs::PermissionsExt;
        let mode = local_meta.permissions().mode();
        let _ = sftp.setstat(Path::new(remote), ssh2::FileStat {
            size: None, uid: None, gid: None, perm: Some(mode),
            atime: None, mtime: None,
        });
    }

    Ok(())
}

type IgnoreMatcher = Option<ignore::gitignore::Gitignore>;

fn build_ignore_matcher(local_root: &str, extra_patterns: &[String]) -> IgnoreMatcher {
    let mut builder = ignore::gitignore::GitignoreBuilder::new(local_root);
    let syncignore = Path::new(local_root).join(".syncignore");
    if syncignore.exists() { let _ = builder.add(&syncignore); }
    let gitignore = Path::new(local_root).join(".gitignore");
    if gitignore.exists() { let _ = builder.add(&gitignore); }
    for pat in extra_patterns { let _ = builder.add_line(None, pat); }
    builder.build().ok()
}

fn is_ignored(path: &Path, matcher: &IgnoreMatcher) -> bool {
    if path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with(".pylon_tmp"))
        .unwrap_or(false)
    {
        return true;
    }
    if let Some(m) = matcher {
        m.matched(path, path.is_dir()).is_ignore()
    } else {
        false
    }
}

fn build_protected_matcher(remote_root: &str, patterns: &[String]) -> IgnoreMatcher {
    if patterns.is_empty() { return None; }
    let mut builder = ignore::gitignore::GitignoreBuilder::new(remote_root);
    for pat in patterns {
        let _ = builder.add_line(None, pat);
    }
    builder.build().ok()
}

fn is_protected(remote_abs: &str, remote_root: &str, matcher: &IgnoreMatcher) -> bool {
    let m = match matcher {
        Some(m) => m,
        None => return false,
    };

    let rel = remote_abs
        .strip_prefix(remote_root)
        .unwrap_or(remote_abs)
        .trim_start_matches('/');
    let path = Path::new(rel);
    m.matched(path, false).is_ignore() || m.matched(path, true).is_ignore()
}
