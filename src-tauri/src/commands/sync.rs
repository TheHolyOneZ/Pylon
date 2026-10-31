use tauri::{AppHandle, Manager};
use uuid::Uuid;

use super::blocking;
use crate::{
    error::PylonError,
    fs_watcher::{SyncConfig, SyncRule, WatcherRegistry},
    session::SessionRegistry,
    watcher_store::{PersistedWatcherConfig, SuspendedWatcherRegistry, WatcherStore},
};

fn persist(app: &AppHandle, id: &str) {
    if let Some(config) = app.state::<WatcherRegistry>().get_config(id) {
        let _ = app.state::<WatcherStore>().save(&PersistedWatcherConfig::from(&config));
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_sync(
    app: AppHandle,
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
    keep_on_disconnect: Option<bool>,
    replace_id: Option<String>,
) -> Result<SyncConfig, PylonError> {
    blocking(move || {
        let sessions = app.state::<SessionRegistry>();
        let info = sessions.get_info(&session_id).ok_or_else(|| PylonError::SessionNotFound(session_id.clone()))?;
        if !info.from_vault {
            return Err(PylonError::PermissionDenied(
                "Sync watchers need a ZVault connection (so they can resume safely after reconnecting)".into(),
            ));
        }
        let conn = sessions.get_conn(&session_id)?;
        let watchers = app.state::<WatcherRegistry>();
        let id = match replace_id {
            Some(old) => {
                let _ = watchers.stop(&old);
                old
            }
            None => Uuid::new_v4().to_string(),
        };
        let config = SyncConfig {
            id,
            label: if label.trim().is_empty() { "Sync".into() } else { label.trim().to_string() },
            local_root: local_root.trim().to_string(),
            remote_root: remote_root.trim().to_string(),
            session_id: session_id.clone(),
            strip_metadata,
            active: true,
            events_processed: 0,
            bytes_synced: 0,
            exclude_patterns,
            preserve_timestamps,
            mirror_permissions,
            rule: rule.unwrap_or_default(),
            from_vault: true,
            expected_host: info.host.clone(),
            expected_port: info.port,
            keep_on_disconnect: keep_on_disconnect.unwrap_or(false),
            credential_id: sessions.get_credential_id(&session_id).unwrap_or_default(),
            expected_fingerprint: info.server_fingerprint.clone().unwrap_or_default(),
            protected_patterns: protected_patterns.unwrap_or_default(),
            dry_run: dry_run.unwrap_or(false),
            max_file_size_kb,
            sync_deletes: sync_deletes.unwrap_or(false),
            initial_sync_only: initial_sync_only.unwrap_or(false),
            waiting_for_session: false,
        };
        watchers.start(app.clone(), config.clone(), conn)?;
        let config = watchers.get_config(&config.id).unwrap_or(config);
        let _ = app.state::<WatcherStore>().save(&PersistedWatcherConfig::from(&config));
        Ok(config)
    })
    .await
}

#[tauri::command]
pub async fn update_sync_dry_run(app: AppHandle, sync_id: String, dry_run: bool) -> Result<(), PylonError> {
    app.state::<WatcherRegistry>().update_dry_run(&sync_id, dry_run)?;
    persist(&app, &sync_id);
    Ok(())
}

#[tauri::command]
pub async fn stop_sync(app: AppHandle, sync_id: String) -> Result<(), PylonError> {
    let _ = app.state::<WatcherRegistry>().stop(&sync_id);
    app.state::<SuspendedWatcherRegistry>().remove(&sync_id);
    let _ = app.state::<WatcherStore>().remove(&sync_id);
    Ok(())
}

#[tauri::command]
pub async fn list_syncs(app: AppHandle) -> Result<Vec<SyncConfig>, PylonError> {
    Ok(app.state::<WatcherRegistry>().list())
}

#[tauri::command]
pub async fn update_sync_config(app: AppHandle, sync_id: String, exclude_patterns: Vec<String>, strip_metadata: bool) -> Result<(), PylonError> {
    app.state::<WatcherRegistry>().update_config(&sync_id, exclude_patterns, strip_metadata)?;
    persist(&app, &sync_id);
    Ok(())
}

#[tauri::command]
pub async fn update_sync_rule(app: AppHandle, sync_id: String, rule: SyncRule) -> Result<(), PylonError> {
    app.state::<WatcherRegistry>().update_rule(&sync_id, rule)?;
    persist(&app, &sync_id);
    Ok(())
}

#[tauri::command]
pub async fn update_sync_keep_on_disconnect(app: AppHandle, sync_id: String, keep: bool) -> Result<(), PylonError> {
    app.state::<WatcherRegistry>().update_keep_on_disconnect(&sync_id, keep)?;
    persist(&app, &sync_id);
    Ok(())
}

#[tauri::command]
pub async fn delete_suspended_sync(app: AppHandle, sync_id: String) -> Result<(), PylonError> {
    app.state::<SuspendedWatcherRegistry>().remove(&sync_id);
    let _ = app.state::<WatcherStore>().remove(&sync_id);
    Ok(())
}

#[tauri::command]
pub async fn confirm_sync_operation(app: AppHandle, request_id: String, approved: bool) -> Result<(), PylonError> {
    app.state::<WatcherRegistry>().confirm(&request_id, approved);
    Ok(())
}

#[tauri::command]
pub async fn list_suspended_syncs(app: AppHandle) -> Result<Vec<PersistedWatcherConfig>, PylonError> {
    Ok(app.state::<SuspendedWatcherRegistry>().list())
}
