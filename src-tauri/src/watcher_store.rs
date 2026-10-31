use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};

use crate::{
    error::PylonResult,
    fs_watcher::{SyncConfig, SyncRule},
};

impl From<&SyncConfig> for PersistedWatcherConfig {
    fn from(c: &SyncConfig) -> Self {
        Self {
            id: c.id.clone(),
            label: c.label.clone(),
            local_root: c.local_root.clone(),
            remote_root: c.remote_root.clone(),
            credential_id: c.credential_id.clone(),
            expected_host: c.expected_host.clone(),
            expected_port: c.expected_port,
            expected_fingerprint: c.expected_fingerprint.clone(),
            strip_metadata: c.strip_metadata,
            preserve_timestamps: c.preserve_timestamps,
            mirror_permissions: c.mirror_permissions,
            exclude_patterns: c.exclude_patterns.clone(),
            rule: c.rule.clone(),
            keep_on_disconnect: c.keep_on_disconnect,
            protected_patterns: c.protected_patterns.clone(),
            dry_run: c.dry_run,
            max_file_size_kb: c.max_file_size_kb,
            sync_deletes: c.sync_deletes,
            initial_sync_only: c.initial_sync_only,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedWatcherConfig {
    pub id: String,
    pub label: String,
    pub local_root: String,
    pub remote_root: String,
    pub credential_id: String,
    pub expected_host: String,
    pub expected_port: u16,
    pub expected_fingerprint: String,
    pub strip_metadata: bool,
    pub preserve_timestamps: bool,
    pub mirror_permissions: bool,
    pub exclude_patterns: Vec<String>,
    pub rule: SyncRule,
    #[serde(default)]
    pub keep_on_disconnect: bool,
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

impl PersistedWatcherConfig {
    pub fn to_sync_config(&self, session_id: &str) -> SyncConfig {
        SyncConfig {
            id: self.id.clone(),
            label: self.label.clone(),
            local_root: self.local_root.clone(),
            remote_root: self.remote_root.clone(),
            session_id: session_id.to_string(),
            strip_metadata: self.strip_metadata,
            active: true,
            events_processed: 0,
            bytes_synced: 0,
            exclude_patterns: self.exclude_patterns.clone(),
            preserve_timestamps: self.preserve_timestamps,
            mirror_permissions: self.mirror_permissions,
            rule: self.rule.clone(),
            from_vault: true,
            expected_host: self.expected_host.clone(),
            expected_port: self.expected_port,
            keep_on_disconnect: self.keep_on_disconnect,
            credential_id: self.credential_id.clone(),
            expected_fingerprint: self.expected_fingerprint.clone(),
            protected_patterns: self.protected_patterns.clone(),
            dry_run: self.dry_run,
            max_file_size_kb: self.max_file_size_kb,
            sync_deletes: self.sync_deletes,
            initial_sync_only: self.initial_sync_only,
            waiting_for_session: false,
        }
    }
}

pub struct WatcherStore {
    path: PathBuf,
}

impl WatcherStore {
    pub fn new(config_dir: &std::path::Path) -> Self {
        Self {
            path: config_dir.join("sync-watchers.json"),
        }
    }

    pub fn load(&self) -> Vec<PersistedWatcherConfig> {
        let Ok(data) = std::fs::read_to_string(&self.path) else {
            return Vec::new();
        };
        serde_json::from_str(&data).unwrap_or_default()
    }

    pub fn save(&self, config: &PersistedWatcherConfig) -> PylonResult<()> {
        let mut configs = self.load();
        configs.retain(|c| c.id != config.id);
        configs.push(config.clone());
        self.write(&configs)
    }

    pub fn remove(&self, id: &str) -> PylonResult<()> {
        let mut configs = self.load();
        configs.retain(|c| c.id != id);
        self.write(&configs)
    }

    fn write(&self, configs: &[PersistedWatcherConfig]) -> PylonResult<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let data = serde_json::to_string_pretty(configs)?;
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, data)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

pub struct SuspendedWatcherRegistry {
    inner: Arc<Mutex<Vec<PersistedWatcherConfig>>>,
}

impl SuspendedWatcherRegistry {
    pub fn new(initial: Vec<PersistedWatcherConfig>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(initial)),
        }
    }

    pub fn list(&self) -> Vec<PersistedWatcherConfig> {
        self.inner.lock().unwrap().clone()
    }

    pub fn remove(&self, id: &str) {
        self.inner.lock().unwrap().retain(|c| c.id != id);
    }

    pub fn push(&self, cfg: PersistedWatcherConfig) {
        let mut v = self.inner.lock().unwrap();
        v.retain(|c| c.id != cfg.id);
        v.push(cfg);
    }
}
