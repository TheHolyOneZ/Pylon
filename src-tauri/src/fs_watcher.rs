use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, RwLock,
    },
    time::{Duration, Instant, UNIX_EPOCH},
};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::{
    error::{PylonError, PylonResult},
    sftp as rsftp,
    ssh::{is_not_found, sftp_error, SshConn},
    transfer::is_partial_name,
};

const DEBOUNCE: Duration = Duration::from_millis(250);
const TICK: Duration = Duration::from_millis(120);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SyncRule {
    #[default]
    AlwaysOverwrite,
    NewFilesOnly,
    UpdateExistingOnly,
    ConfirmAll,
    ConfirmOnOverwrite,
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
    #[serde(default)]
    pub waiting_for_session: bool,
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

type Matcher = Option<ignore::gitignore::Gitignore>;

struct WatchEntry {
    config: Arc<Mutex<SyncConfig>>,
    conn: Arc<RwLock<Option<SshConn>>>,
    stop: Arc<AtomicBool>,
    _watcher: RecommendedWatcher,
}

impl Drop for WatchEntry {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

#[derive(Default)]
pub struct WatcherRegistry {
    entries: Arc<Mutex<HashMap<String, WatchEntry>>>,
    confirm_pending: Arc<Mutex<HashMap<String, Option<bool>>>>,
}

impl WatcherRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn on_session_removed(&self, session_id: &str) -> Vec<SyncConfig> {
        let mut entries = self.entries.lock().unwrap();
        let mut stopped = Vec::new();
        let ids: Vec<String> = entries
            .iter()
            .filter(|(_, e)| e.config.lock().unwrap().session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            let keep = entries[&id].config.lock().unwrap().keep_on_disconnect;
            if keep {
                let e = &entries[&id];
                *e.conn.write().unwrap() = None;
                e.config.lock().unwrap().waiting_for_session = true;
            } else if let Some(e) = entries.remove(&id) {
                stopped.push(e.config.lock().unwrap().clone());
            }
        }
        stopped
    }

    pub fn rebind(&self, credential_id: &str, fingerprint: &str, session_id: &str, conn: &SshConn) -> Vec<String> {
        let entries = self.entries.lock().unwrap();
        let mut ids = Vec::new();
        for (id, e) in entries.iter() {
            let mut cfg = e.config.lock().unwrap();
            if cfg.waiting_for_session && cfg.credential_id == credential_id && cfg.expected_fingerprint == fingerprint {
                cfg.waiting_for_session = false;
                cfg.session_id = session_id.to_string();
                *e.conn.write().unwrap() = Some(conn.clone());
                ids.push(id.clone());
            }
        }
        ids
    }

    fn with_config<T>(&self, id: &str, f: impl FnOnce(&mut SyncConfig) -> T) -> PylonResult<T> {
        let entries = self.entries.lock().unwrap();
        let e = entries.get(id).ok_or_else(|| PylonError::NotFound(format!("Sync {id}")))?;
        let mut cfg = e.config.lock().unwrap();
        Ok(f(&mut cfg))
    }

    pub fn update_keep_on_disconnect(&self, id: &str, keep: bool) -> PylonResult<()> {
        self.with_config(id, |c| c.keep_on_disconnect = keep)
    }

    pub fn update_rule(&self, id: &str, rule: SyncRule) -> PylonResult<()> {
        self.with_config(id, |c| c.rule = rule)
    }

    pub fn update_dry_run(&self, id: &str, dry_run: bool) -> PylonResult<()> {
        self.with_config(id, |c| c.dry_run = dry_run)
    }

    pub fn update_config(&self, id: &str, exclude_patterns: Vec<String>, strip_metadata: bool) -> PylonResult<()> {
        self.with_config(id, |c| {
            c.exclude_patterns = exclude_patterns;
            c.strip_metadata = strip_metadata;
        })
    }

    pub fn confirm(&self, request_id: &str, approved: bool) {
        if let Some(slot) = self.confirm_pending.lock().unwrap().get_mut(request_id) {
            *slot = Some(approved);
        }
    }

    pub fn stop(&self, id: &str) -> PylonResult<()> {
        self.entries.lock().unwrap().remove(id).ok_or_else(|| PylonError::NotFound(format!("Sync {id}")))?;
        Ok(())
    }

    pub fn list(&self) -> Vec<SyncConfig> {
        self.entries.lock().unwrap().values().map(|e| e.config.lock().unwrap().clone()).collect()
    }

    pub fn get_config(&self, id: &str) -> Option<SyncConfig> {
        self.entries.lock().unwrap().get(id).map(|e| e.config.lock().unwrap().clone())
    }

    pub fn start(&self, app: AppHandle, mut config: SyncConfig, conn: SshConn) -> PylonResult<()> {
        let root = dunce::canonicalize(&config.local_root)
            .map_err(|e| PylonError::Watcher(format!("Local folder {}: {e}", config.local_root)))?;
        if !root.is_dir() {
            return Err(PylonError::Watcher(format!("{} is not a folder", config.local_root)));
        }
        config.remote_root = normalise_remote_root(&config.remote_root);
        if config.remote_root == "/" && config.sync_deletes {
            return Err(PylonError::Watcher("Refusing to mirror deletions into the server root (/) — pick a sub-folder".into()));
        }
        if !config.dry_run {
            let sftp = conn.sftp()?;
            rsftp::mkdir_p_with(&sftp, &config.remote_root)?;
        }
        config.active = true;
        config.waiting_for_session = false;

        let id = config.id.clone();
        let matcher = Arc::new(RwLock::new(build_ignore_matcher(&root, &config.exclude_patterns)));
        let protected = build_protected_matcher(&config.remote_root, &config.protected_patterns);
        let pending: Arc<Mutex<HashMap<PathBuf, Instant>>> = Arc::new(Mutex::new(HashMap::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let cfg = Arc::new(Mutex::new(config.clone()));
        let conn_slot = Arc::new(RwLock::new(Some(conn)));

        let (pending_cb, matcher_cb, root_cb, cfg_cb) = (pending.clone(), matcher.clone(), root.clone(), cfg.clone());
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            let Ok(event) = res else { return };
            if matches!(event.kind, EventKind::Access(_)) {
                return;
            }
            let deadline = Instant::now() + DEBOUNCE;
            for path in event.paths {
                if is_ignore_file(&path, &root_cb) {
                    let excl = cfg_cb.lock().unwrap().exclude_patterns.clone();
                    *matcher_cb.write().unwrap() = build_ignore_matcher(&root_cb, &excl);
                }
                if is_ignored(&path, &root_cb, &matcher_cb.read().unwrap()) {
                    continue;
                }
                pending_cb.lock().unwrap().insert(path, deadline);
            }
        })
        .map_err(|e| PylonError::Watcher(e.to_string()))?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| PylonError::Watcher(format!("Watch {}: {e}", root.display())))?;

        if config.initial_sync_only {
            let now = Instant::now();
            let m = matcher.read().unwrap();
            let mut p = pending.lock().unwrap();
            walk_files(&root, &root, &m, &mut |f| {
                p.insert(f, now);
            });
        }

        let ctx = FlushCtx {
            app,
            id: id.clone(),
            root,
            cfg: cfg.clone(),
            conn: conn_slot.clone(),
            pending,
            matcher,
            protected,
            stop: stop.clone(),
            confirm_pending: self.confirm_pending.clone(),
        };
        std::thread::Builder::new()
            .name(format!("pylon-sync-{}", &id[..8.min(id.len())]))
            .spawn(move || ctx.run())
            .map_err(|e| PylonError::Watcher(e.to_string()))?;

        self.entries.lock().unwrap().insert(id, WatchEntry { config: cfg, conn: conn_slot, stop, _watcher: watcher });
        Ok(())
    }
}

struct FlushCtx {
    app: AppHandle,
    id: String,
    root: PathBuf,
    cfg: Arc<Mutex<SyncConfig>>,
    conn: Arc<RwLock<Option<SshConn>>>,
    pending: Arc<Mutex<HashMap<PathBuf, Instant>>>,
    matcher: Arc<RwLock<Matcher>>,
    protected: Matcher,
    stop: Arc<AtomicBool>,
    confirm_pending: Arc<Mutex<HashMap<String, Option<bool>>>>,
}

enum Outcome {
    Uploaded(u64),
    MadeDir,
    Deleted,
    Skipped(&'static str),
    Nothing,
}

impl FlushCtx {
    fn event(&self, rel: &str, kind: &str, skipped: bool) {
        let _ = self.app.emit(
            "sync://event",
            SyncEvent { sync_id: self.id.clone(), rel_path: rel.to_string(), kind: kind.into(), timestamp: chrono::Utc::now().to_rfc3339(), skipped },
        );
    }

    fn error(&self, reason: String) {
        let label = self.cfg.lock().unwrap().label.clone();
        let _ = self.app.emit("sync://error", SyncError { sync_id: self.id.clone(), sync_label: label, reason });
    }

    fn run(self) {
        let mut had_work = false;
        while !self.stop.load(Ordering::Relaxed) {
            std::thread::sleep(TICK);
            let Some(conn) = self.conn.read().unwrap().clone() else { continue };

            let due: Vec<PathBuf> = {
                let now = Instant::now();
                let mut map = self.pending.lock().unwrap();
                let mut due: Vec<PathBuf> = map.iter().filter(|(_, d)| **d <= now).map(|(p, _)| p.clone()).collect();
                for p in &due {
                    map.remove(p);
                }
                due.sort_by_key(|p| p.components().count());
                due
            };

            if due.is_empty() {
                let initial_only = self.cfg.lock().unwrap().initial_sync_only;
                if initial_only && had_work && self.pending.lock().unwrap().is_empty() {
                    let mut c = self.cfg.lock().unwrap();
                    c.active = false;
                    let label = c.label.clone();
                    drop(c);
                    let _ = self.app.emit("sync://done", serde_json::json!({ "sync_id": &self.id, "sync_label": label }));
                    break;
                }
                continue;
            }
            had_work = true;

            for path in due {
                if self.stop.load(Ordering::Relaxed) {
                    return;
                }
                let Some(rel) = rel_path(&path, &self.root) else { continue };
                if rel.is_empty() {
                    continue;
                }
                match self.process(&conn, &path, &rel) {
                    Ok(Outcome::Uploaded(bytes)) => {
                        let mut c = self.cfg.lock().unwrap();
                        c.events_processed += 1;
                        c.bytes_synced += bytes;
                        drop(c);
                        self.event(&rel, "modified", false);
                    }
                    Ok(Outcome::MadeDir) => self.event(&rel, "created", false),
                    Ok(Outcome::Deleted) => {
                        self.cfg.lock().unwrap().events_processed += 1;
                        self.event(&rel, "deleted", false);
                    }
                    Ok(Outcome::Skipped(kind)) => self.event(&rel, kind, true),
                    Ok(Outcome::Nothing) => {}
                    Err(e) => {
                        self.event(&rel, "error", true);
                        self.error(format!("{rel}: {e}"));
                    }
                }
            }
        }
    }

    fn process(&self, conn: &SshConn, path: &Path, rel: &str) -> PylonResult<Outcome> {
        let cfg = self.cfg.lock().unwrap().clone();
        let remote = rsftp::join(&cfg.remote_root, rel);
        if is_protected(rel, &self.protected) {
            return Ok(Outcome::Skipped("protected"));
        }
        let meta = std::fs::symlink_metadata(path).ok();

        match meta {
            Some(m) if m.is_dir() => {
                if cfg.dry_run {
                    return Ok(Outcome::Skipped("dry_run_upload"));
                }
                let sftp = conn.sftp()?;
                rsftp::mkdir_p_with(&sftp, &remote)?;
                let now = Instant::now();
                let m = self.matcher.read().unwrap();
                let mut p = self.pending.lock().unwrap();
                walk_files(path, &self.root, &m, &mut |f| {
                    p.entry(f).or_insert(now);
                });
                Ok(Outcome::MadeDir)
            }
            Some(m) if m.is_file() || (m.file_type().is_symlink() && path.is_file()) => {
                let meta = std::fs::metadata(path)?;
                if let Some(max_kb) = cfg.max_file_size_kb {
                    if meta.len() / 1024 > max_kb {
                        return Ok(Outcome::Skipped("size_limit"));
                    }
                }
                let sftp = conn.sftp()?;
                let exists = match sftp.lstat(Path::new(&remote)) {
                    Ok(_) => true,
                    Err(e) if is_not_found(&e) => false,
                    Err(e) => return Err(sftp_error(&format!("stat {remote}"), &e)),
                };
                let proceed = match cfg.rule {
                    SyncRule::AlwaysOverwrite => true,
                    SyncRule::NewFilesOnly => !exists,
                    SyncRule::UpdateExistingOnly => exists,
                    SyncRule::ConfirmAll => self.confirm(rel, if exists { "overwrite" } else { "new_file" }),
                    SyncRule::ConfirmOnOverwrite => !exists || self.confirm(rel, "overwrite"),
                };
                if !proceed {
                    return Ok(Outcome::Skipped("skipped"));
                }
                if cfg.dry_run {
                    return Ok(Outcome::Skipped("dry_run_upload"));
                }
                push_file(conn, path, &meta, &remote, &cfg).map(Outcome::Uploaded)
            }
            Some(_) => Ok(Outcome::Nothing),
            None => {
                if !cfg.sync_deletes {
                    return Ok(Outcome::Skipped("skipped"));
                }
                let proceed = match cfg.rule {
                    SyncRule::NewFilesOnly => false,
                    SyncRule::ConfirmAll | SyncRule::ConfirmOnOverwrite => self.confirm(rel, "delete"),
                    _ => true,
                };
                if !proceed {
                    return Ok(Outcome::Skipped("skipped"));
                }
                if cfg.dry_run {
                    return Ok(Outcome::Skipped("dry_run_delete"));
                }
                let sftp = conn.sftp()?;
                match sftp.lstat(Path::new(&remote)) {
                    Err(e) if is_not_found(&e) => Ok(Outcome::Nothing),
                    Err(e) => Err(sftp_error(&format!("stat {remote}"), &e)),
                    Ok(_) => {
                        rsftp::recursive_delete_with(&sftp, &remote)?;
                        Ok(Outcome::Deleted)
                    }
                }
            }
        }
    }

    fn confirm(&self, rel: &str, reason: &str) -> bool {
        let request_id = Uuid::new_v4().to_string();
        self.confirm_pending.lock().unwrap().insert(request_id.clone(), None);
        let label = self.cfg.lock().unwrap().label.clone();
        let _ = self.app.emit(
            "sync://confirm_request",
            SyncConfirmRequest { request_id: request_id.clone(), sync_id: self.id.clone(), sync_label: label, rel_path: rel.to_string(), reason: reason.into() },
        );
        let deadline = Instant::now() + Duration::from_secs(60);
        let decision = loop {
            if self.stop.load(Ordering::Relaxed) {
                break false;
            }
            if Instant::now() > deadline {
                let _ = self.app.emit("sync://confirm_timeout", serde_json::json!({ "request_id": &request_id, "sync_id": &self.id }));
                break false;
            }
            if let Some(Some(v)) = self.confirm_pending.lock().unwrap().get(&request_id) {
                break *v;
            }
            std::thread::sleep(Duration::from_millis(80));
        };
        self.confirm_pending.lock().unwrap().remove(&request_id);
        decision
    }
}

fn normalise_remote_root(r: &str) -> String {
    let t = r.trim().replace('\\', "/");
    let t = t.trim_end_matches('/');
    if t.is_empty() {
        "/".into()
    } else if t.starts_with('/') {
        t.to_string()
    } else {
        format!("/{t}")
    }
}

fn rel_path(path: &Path, root: &Path) -> Option<String> {
    let to_s = |p: &Path| p.to_string_lossy().replace('\\', "/");
    if let Ok(r) = path.strip_prefix(root) {
        return Some(to_s(r));
    }
    let parent = dunce::canonicalize(path.parent()?).ok()?;
    let joined = parent.join(path.file_name()?);
    joined.strip_prefix(root).ok().map(to_s)
}

fn is_ignore_file(path: &Path, root: &Path) -> bool {
    path.parent() == Some(root)
        && matches!(path.file_name().and_then(|n| n.to_str()), Some(".gitignore") | Some(".syncignore"))
}

fn build_ignore_matcher(root: &Path, extra_patterns: &[String]) -> Matcher {
    let mut b = ignore::gitignore::GitignoreBuilder::new(root);
    let _ = b.add_line(None, ".git/");
    let _ = b.add_line(None, "*.pylon-part");
    for name in [".syncignore", ".gitignore"] {
        let f = root.join(name);
        if f.exists() {
            let _ = b.add(&f);
        }
    }
    for pat in extra_patterns {
        let p = pat.trim();
        if !p.is_empty() {
            let _ = b.add_line(None, p);
        }
    }
    b.build().ok()
}

fn is_ignored(path: &Path, root: &Path, matcher: &Matcher) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if is_partial_name(name) || name.ends_with(".pylon-sync-part") {
        return true;
    }
    let Some(m) = matcher else { return false };
    if path.strip_prefix(root).is_err() {
        return false;
    }
    m.matched_path_or_any_parents(path, path.is_dir()).is_ignore()
}

fn build_protected_matcher(remote_root: &str, patterns: &[String]) -> Matcher {
    if patterns.iter().all(|p| p.trim().is_empty()) {
        return None;
    }
    let mut b = ignore::gitignore::GitignoreBuilder::new(remote_root);
    for pat in patterns {
        let _ = b.add_line(None, pat.trim());
    }
    b.build().ok()
}

fn is_protected(rel: &str, matcher: &Matcher) -> bool {
    let Some(m) = matcher else { return false };
    let p = Path::new(rel);
    m.matched_path_or_any_parents(p, false).is_ignore() || m.matched_path_or_any_parents(p, true).is_ignore()
}

fn walk_files(dir: &Path, root: &Path, matcher: &Matcher, f: &mut dyn FnMut(PathBuf)) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let path = entry.path();
        if is_ignored(&path, root, matcher) {
            continue;
        }
        match entry.file_type() {
            Ok(ft) if ft.is_dir() => {
                f(path.clone());
                walk_files(&path, root, matcher, f);
            }
            Ok(_) => f(path),
            Err(_) => {}
        }
    }
}

fn push_file(conn: &SshConn, local: &Path, meta: &std::fs::Metadata, remote: &str, cfg: &SyncConfig) -> PylonResult<u64> {
    let sftp = conn.sftp()?;
    let parent = rsftp::parent(remote).unwrap_or_else(|| "/".into());
    rsftp::mkdir_p_with(&sftp, &parent)?;
    let name = remote.rsplit('/').next().unwrap_or("file");
    let tmp = rsftp::join(&parent, &format!(".{name}.pylon-sync-part"));

    let stripped = if cfg.strip_metadata && crate::metadata::is_strippable(local) && meta.len() <= crate::transfer::STRIP_MAX_BYTES {
        let raw = std::fs::read(local)?;
        Some(crate::metadata::strip_bytes(&raw, local).unwrap_or(raw))
    } else {
        None
    };

    let result = (|| -> PylonResult<u64> {
        let mut f = sftp.create(Path::new(&tmp)).map_err(|e| sftp_error(&format!("create {tmp}"), &e))?;
        let mut written = 0u64;
        match &stripped {
            Some(data) => {
                f.write_all(data)?;
                written = data.len() as u64;
            }
            None => {
                let mut src = std::fs::File::open(local)?;
                let mut buf = vec![0u8; rsftp::CHUNK_SIZE];
                loop {
                    let n = src.read(&mut buf)?;
                    if n == 0 {
                        break;
                    }
                    f.write_all(&buf[..n]).map_err(|e| PylonError::Transfer(format!("write {remote}: {e}")))?;
                    written += n as u64;
                }
            }
        }
        drop(f);
        match sftp.unlink(Path::new(remote)) {
            Ok(()) => {}
            Err(e) if is_not_found(&e) => {}
            Err(e) => return Err(sftp_error(&format!("replace {remote}"), &e)),
        }
        sftp.rename(Path::new(&tmp), Path::new(remote), None)
            .map_err(|e| sftp_error(&format!("rename into {remote}"), &e))?;
        Ok(written)
    })();
    if result.is_err() {
        let _ = sftp.unlink(Path::new(&tmp));
        return result;
    }

    let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs());
    #[cfg(unix)]
    let perm = if cfg.mirror_permissions {
        use std::os::unix::fs::PermissionsExt;
        Some(meta.permissions().mode() & 0o7777)
    } else {
        None
    };
    #[cfg(not(unix))]
    let perm: Option<u32> = None;
    if cfg.preserve_timestamps || perm.is_some() {
        let ts = if cfg.preserve_timestamps { mtime } else { None };
        let _ = sftp.setstat(Path::new(remote), ssh2::FileStat { size: None, uid: None, gid: None, perm, atime: ts, mtime: ts });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_files_inside_ignored_dirs() {
        let dir = std::env::temp_dir().join(format!("pylon-ign-{}", Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("node_modules/pkg")).unwrap();
        std::fs::write(dir.join(".gitignore"), "node_modules/\n*.log\n").unwrap();
        let root = dunce::canonicalize(&dir).unwrap();
        let m = build_ignore_matcher(&root, &["secret.txt".into()]);
        assert!(is_ignored(&root.join("node_modules/pkg/index.js"), &root, &m));
        assert!(is_ignored(&root.join("app.log"), &root, &m));
        assert!(is_ignored(&root.join("secret.txt"), &root, &m));
        assert!(is_ignored(&root.join(".git/HEAD"), &root, &m));
        assert!(!is_ignored(&root.join("src/main.rs"), &root, &m));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn remote_root_normalisation() {
        assert_eq!(normalise_remote_root("var/www/"), "/var/www");
        assert_eq!(normalise_remote_root(""), "/");
    }
}
