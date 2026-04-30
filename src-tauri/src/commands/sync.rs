use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{
    error::PylonError,
    fs_watcher::{SyncConfig, SyncRule, WatcherRegistry},
    session::SessionRegistry,
    watcher_store::{PersistedWatcherConfig, SuspendedWatcherRegistry, WatcherStore},
};

fn sync_config_to_persisted(c: &SyncConfig) -> PersistedWatcherConfig {
    PersistedWatcherConfig::from(c)
}

#[tauri::command]
pub async fn start_sync(
    app: AppHandle,
    session_registry: State<'_, SessionRegistry>,
    watcher_registry: State<'_, WatcherRegistry>,
    watcher_store: State<'_, WatcherStore>,
    session_id: String,
    local_root: String,
    remote_root: String,
    label: String,
    strip_metadata: bool,
    preserve_timestamps: bool,
    mirror_permissions: bool,
    exclude_patterns: Vec<String>,
    rule: Option<SyncRule>,

    protected_patterns: Option<Vec<String>>,
    dry_run: Option<bool>,
    max_file_size_kb: Option<u64>,
    sync_deletes: Option<bool>,
    initial_sync_only: Option<bool>,
) -> Result<SyncConfig, PylonError> {
    let (expected_host, expected_port, from_vault, expected_fingerprint) = session_registry
        .get_info(&session_id)
        .map(|info| (
            info.host,
            info.port,
            info.from_vault,
            info.server_fingerprint.unwrap_or_default(),
        ))
        .unwrap_or_default();

    if !from_vault {
        return Err(PylonError::PermissionDenied(
            "Sync watchers require a ZVault connection".into(),
        ));
    }

    let credential_id = session_registry
        .get_credential_id(&session_id)
        .unwrap_or_default();

    let sess = session_registry.get_session_arc(&session_id)?;

    let config = SyncConfig {
        id: Uuid::new_v4().to_string(),
        label,
        local_root,
        remote_root,
        session_id,
        strip_metadata,
        active: true,
        events_processed: 0,
        bytes_synced: 0,
        exclude_patterns,
        preserve_timestamps,
        mirror_permissions,
        rule: rule.unwrap_or_default(),
        from_vault,
        expected_host,
        expected_port,
        keep_on_disconnect: false,
        credential_id: credential_id.clone(),
        expected_fingerprint: expected_fingerprint.clone(),
        protected_patterns: protected_patterns.unwrap_or_default(),
        dry_run: dry_run.unwrap_or(false),
        max_file_size_kb,
        sync_deletes: sync_deletes.unwrap_or(false),
        initial_sync_only: initial_sync_only.unwrap_or(false),
    };

    watcher_registry.start(app, config.clone(), sess)?;

    let _ = watcher_store.save(&PersistedWatcherConfig::from(&config));

    Ok(config)
}

#[tauri::command]
pub async fn update_sync_dry_run(
    watcher_registry: State<'_, WatcherRegistry>,
    watcher_store: State<'_, WatcherStore>,
    sync_id: String,
    dry_run: bool,
) -> Result<(), PylonError> {
    watcher_registry.update_dry_run(&sync_id, dry_run)?;
    if let Some(config) = watcher_registry.get_config(&sync_id) {
        let _ = watcher_store.save(&sync_config_to_persisted(&config));
    }
    Ok(())
}

#[tauri::command]
pub async fn stop_sync(
    watcher_registry: State<'_, WatcherRegistry>,
    watcher_store: State<'_, WatcherStore>,
    sync_id: String,
) -> Result<(), PylonError> {
    watcher_registry.stop(&sync_id)?;
    let _ = watcher_store.remove(&sync_id);
    Ok(())
}

#[tauri::command]
pub async fn list_syncs(
    watcher_registry: State<'_, WatcherRegistry>,
) -> Result<Vec<SyncConfig>, PylonError> {
    Ok(watcher_registry.list())
}

#[tauri::command]
pub async fn update_sync_config(
    watcher_registry: State<'_, WatcherRegistry>,
    sync_id: String,
    exclude_patterns: Vec<String>,
    strip_metadata: bool,
) -> Result<(), PylonError> {
    watcher_registry.update_config(&sync_id, exclude_patterns, strip_metadata)
}

#[tauri::command]
pub async fn update_sync_rule(
    watcher_registry: State<'_, WatcherRegistry>,
    watcher_store: State<'_, WatcherStore>,
    sync_id: String,
    rule: SyncRule,
) -> Result<(), PylonError> {
    watcher_registry.update_rule(&sync_id, rule)?;
    if let Some(config) = watcher_registry.get_config(&sync_id) {
        let _ = watcher_store.save(&sync_config_to_persisted(&config));
    }
    Ok(())
}

#[tauri::command]
pub async fn update_sync_keep_on_disconnect(
    watcher_registry: State<'_, WatcherRegistry>,
    watcher_store: State<'_, WatcherStore>,
    sync_id: String,
    keep: bool,
) -> Result<(), PylonError> {
    watcher_registry.update_keep_on_disconnect(&sync_id, keep)?;
    if let Some(config) = watcher_registry.get_config(&sync_id) {
        let _ = watcher_store.save(&sync_config_to_persisted(&config));
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_suspended_sync(
    suspended_registry: State<'_, SuspendedWatcherRegistry>,
    watcher_store: State<'_, WatcherStore>,
    sync_id: String,
) -> Result<(), PylonError> {
    suspended_registry.remove(&sync_id);
    let _ = watcher_store.remove(&sync_id);
    Ok(())
}

#[tauri::command]
pub async fn confirm_sync_operation(
    watcher_registry: State<'_, WatcherRegistry>,
    request_id: String,
    approved: bool,
) -> Result<(), PylonError> {
    watcher_registry.confirm(&request_id, approved);
    Ok(())
}

#[tauri::command]
pub async fn list_suspended_syncs(
    suspended_registry: State<'_, SuspendedWatcherRegistry>,
) -> Result<Vec<PersistedWatcherConfig>, PylonError> {
    Ok(suspended_registry.list())
}
