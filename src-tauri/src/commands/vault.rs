use std::sync::{Arc, atomic::AtomicBool};
use tauri::{Emitter, State};

use crate::{
    error::PylonError,
    fs_watcher::{SyncConfig, WatcherRegistry},
    known_hosts,
    session::{self, LiveSession, SessionRegistry, TermAuthParams},
    vault::{self, AuthType, Credential},
    vault_manager::{VaultManager, VaultProfile},
    watcher_store::{PersistedWatcherConfig, SuspendedWatcherRegistry},
};

#[tauri::command]
pub async fn vault_list_profiles(manager: State<'_, VaultManager>) -> Result<Vec<VaultProfile>, PylonError> {
    Ok(manager.list_profiles())
}

#[tauri::command]
pub async fn vault_active_profile_id(manager: State<'_, VaultManager>) -> Result<String, PylonError> {
    Ok(manager.active_profile_id())
}

#[tauri::command]
pub async fn vault_select_profile(
    manager: State<'_, VaultManager>,
    profile_id: String,
) -> Result<(), PylonError> {
    manager.select_profile(&profile_id)
}

#[tauri::command]
pub async fn vault_create_profile(
    manager: State<'_, VaultManager>,
    name: String,
    color: String,
    icon: String,
) -> Result<VaultProfile, PylonError> {
    manager.create_profile(name, color, icon)
}

#[tauri::command]
pub async fn vault_delete_profile(
    manager: State<'_, VaultManager>,
    profile_id: String,
) -> Result<(), PylonError> {
    manager.delete_profile(&profile_id)
}

#[tauri::command]
pub async fn vault_rename_profile(
    manager: State<'_, VaultManager>,
    profile_id: String,
    name: String,
    color: String,
    icon: String,
) -> Result<(), PylonError> {
    manager.rename_profile(&profile_id, name, color, icon)
}

#[tauri::command]
pub async fn vault_unlock(
    manager: State<'_, VaultManager>,
    passphrase: String,
) -> Result<(), PylonError> {
    manager.unlock(&passphrase)
}

#[tauri::command]
pub async fn vault_lock(manager: State<'_, VaultManager>) -> Result<(), PylonError> {
    manager.lock();
    Ok(())
}

#[tauri::command]
pub async fn vault_is_unlocked(manager: State<'_, VaultManager>) -> Result<bool, PylonError> {
    Ok(manager.is_unlocked())
}

#[tauri::command]
pub async fn vault_reset(manager: State<'_, VaultManager>) -> Result<(), PylonError> {
    manager.reset()
}

#[tauri::command]
pub async fn vault_add_credential(
    manager: State<'_, VaultManager>,
    passphrase: String,
    label: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    auth_type: AuthType,
) -> Result<String, PylonError> {
    let cred = vault::new_credential(label, host, port, username, password, private_key, auth_type);
    manager.add_credential_returning_id(&passphrase, cred)
}

#[tauri::command]
pub async fn vault_update_credential(
    manager: State<'_, VaultManager>,
    passphrase: String,
    id: String,
    label: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    auth_type: AuthType,
) -> Result<(), PylonError> {
    let cred = Credential {
        id,
        label,
        host,
        port,
        username,
        password,
        private_key,
        auth_type,
        created_at: chrono::Utc::now().to_rfc3339(),
        last_used: None,
    };
    manager.update_credential(&passphrase, cred)
}

#[tauri::command]
pub async fn vault_get_credential(
    manager: State<'_, VaultManager>,
    id: String,
) -> Result<Credential, PylonError> {
    manager.get_credential(&id)
}

#[tauri::command]
pub async fn vault_list_credentials(manager: State<'_, VaultManager>) -> Result<Vec<Credential>, PylonError> {
    manager.list_credentials()
}

#[tauri::command]
pub async fn vault_delete_credential(
    manager: State<'_, VaultManager>,
    passphrase: String,
    id: String,
) -> Result<(), PylonError> {
    manager.delete_credential(&passphrase, &id)
}

#[tauri::command]
pub async fn vault_accept_host_key_and_connect(
    app: tauri::AppHandle,
    manager: State<'_, VaultManager>,
    registry: State<'_, SessionRegistry>,
    watcher_registry: State<'_, WatcherRegistry>,
    suspended_registry: State<'_, SuspendedWatcherRegistry>,
    credential_id: String,
    permanent: bool,
) -> Result<session::ConnectionInfo, PylonError> {
    let cred = manager.get_credential_with_secret(&credential_id)?;
    let password = cred.password.as_deref();
    let private_key = cred.private_key.as_deref();

    let addr = format!("{}:{}", cred.host, cred.port);
    let tcp = std::net::TcpStream::connect(&addr)
        .map_err(|e| PylonError::Ssh(format!("TCP connect to {addr}: {e}")))?;

    let mut temp_sess = ssh2::Session::new().map_err(|e| PylonError::Ssh(e.to_string()))?;
    temp_sess.set_blocking(true);
    temp_sess.set_timeout(30_000);
    temp_sess.set_tcp_stream(tcp);
    temp_sess.handshake().map_err(|e| PylonError::Ssh(format!("Handshake: {e}")))?;

    let (key_bytes, key_type) = temp_sess
        .host_key()
        .ok_or_else(|| PylonError::Ssh("Server provided no host key".into()))?;
    let key_type_str = match key_type {
        ssh2::HostKeyType::Rsa => "ssh-rsa",
        ssh2::HostKeyType::Dss => "ssh-dss",
        ssh2::HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
        ssh2::HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
        ssh2::HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
        ssh2::HostKeyType::Ed25519 => "ssh-ed25519",
        _ => "unknown",
    };
    let fingerprint = known_hosts::sha256_fingerprint(key_bytes);
    let key_bytes_owned = key_bytes.to_vec();

    if permanent {
        known_hosts::add_host_key(&cred.host, cred.port, &key_bytes_owned, key_type_str)?;
    }

    let (sess, mut info) = session::authenticate_and_build(
        temp_sess, &cred.host, cred.port, &cred.username,
        password, private_key,
        &cred.label, fingerprint, key_type_str.to_string(),
    )?;

    info.from_vault = true;
    let cancel = Arc::new(AtomicBool::new(false));
    let sess_arc = Arc::new(std::sync::Mutex::new(sess));
    session::spawn_keepalive(sess_arc.clone(), cancel.clone(), app.clone(), info.id.clone());
    let term_auth = TermAuthParams {
        host: cred.host.clone(),
        port: cred.port,
        username: cred.username.clone(),
        password: cred.password.clone(),
        private_key: cred.private_key.clone(),
    };
    let session_id = info.id.clone();
    let live = LiveSession { info: info.clone(), session: sess_arc.clone(), keepalive_cancel: cancel, term_auth };
    registry.add(live);
    registry.set_credential_id(&session_id, &credential_id);
    resume_suspended_watchers(&app, &session_id, &credential_id, &sess_arc, &suspended_registry, &watcher_registry);
    Ok(info)
}

fn resume_suspended_watchers(
    app: &tauri::AppHandle,
    session_id: &str,
    credential_id: &str,
    session_arc: &Arc<std::sync::Mutex<ssh2::Session>>,
    suspended_registry: &SuspendedWatcherRegistry,
    watcher_registry: &WatcherRegistry,
) {
    let current_fp = session_arc.lock().ok().and_then(|s| {
        s.host_key().map(|(kb, _)| known_hosts::sha256_fingerprint(kb))
    });

    let candidates: Vec<PersistedWatcherConfig> = suspended_registry
        .list()
        .into_iter()
        .filter(|c| c.credential_id == credential_id)
        .collect();

    for cfg in candidates {
        let fp_matches = current_fp
            .as_deref()
            .map(|fp| fp == cfg.expected_fingerprint)
            .unwrap_or(false);

        if !fp_matches {
            continue;
        }

        let sync_config = SyncConfig {
            id: cfg.id.clone(),
            label: cfg.label.clone(),
            local_root: cfg.local_root.clone(),
            remote_root: cfg.remote_root.clone(),
            session_id: session_id.to_string(),
            strip_metadata: cfg.strip_metadata,
            active: true,
            events_processed: 0,
            bytes_synced: 0,
            exclude_patterns: cfg.exclude_patterns.clone(),
            preserve_timestamps: cfg.preserve_timestamps,
            mirror_permissions: cfg.mirror_permissions,
            rule: cfg.rule.clone(),
            from_vault: true,
            expected_host: cfg.expected_host.clone(),
            expected_port: cfg.expected_port,
            keep_on_disconnect: cfg.keep_on_disconnect,
            credential_id: cfg.credential_id.clone(),
            expected_fingerprint: cfg.expected_fingerprint.clone(),
            protected_patterns: cfg.protected_patterns.clone(),
            dry_run: cfg.dry_run,
            max_file_size_kb: cfg.max_file_size_kb,
            sync_deletes: cfg.sync_deletes,
            initial_sync_only: cfg.initial_sync_only,
        };

        if watcher_registry.start(app.clone(), sync_config, session_arc.clone()).is_ok() {
            suspended_registry.remove(&cfg.id);
            let _ = app.emit("sync://resumed", serde_json::json!({
                "sync_id": &cfg.id,
                "label": &cfg.label,
            }));
        }
    }
}

#[tauri::command]
pub async fn vault_connect(
    app: tauri::AppHandle,
    manager: State<'_, VaultManager>,
    registry: State<'_, SessionRegistry>,
    watcher_registry: State<'_, WatcherRegistry>,
    suspended_registry: State<'_, SuspendedWatcherRegistry>,
    credential_id: String,
) -> Result<serde_json::Value, PylonError> {
    let cred = manager.get_credential_with_secret(&credential_id)?;

    match &cred.auth_type {
        crate::vault::AuthType::Password if cred.password.is_none() => {
            return Err(PylonError::Ssh(
                "This credential was saved without a password (old vault format). \
                 Please delete and re-add it in ZVault with the correct password.".into()
            ));
        }
        crate::vault::AuthType::PrivateKey if cred.private_key.is_none() => {
            return Err(PylonError::Ssh(
                "This credential was saved without an SSH key (old vault format). \
                 Please delete and re-add it in ZVault with the correct key.".into()
            ));
        }
        _ => {}
    }

    let password = cred.password.as_deref();
    let private_key = cred.private_key.as_deref();

    let result = session::open_session(
        &cred.host, cred.port, &cred.username,
        password, private_key, &cred.label,
    )?;

    match result {
        session::OpenSessionResult::Ready(sess, info) => {
            let cancel = Arc::new(AtomicBool::new(false));
            let sess_arc = Arc::new(std::sync::Mutex::new(sess));
            session::spawn_keepalive(sess_arc.clone(), cancel.clone(), app.clone(), info.id.clone());
            let term_auth = TermAuthParams {
                host: cred.host.clone(),
                port: cred.port,
                username: cred.username.clone(),
                password: cred.password.clone(),
                private_key: cred.private_key.clone(),
            };
            let mut info = info;
            info.from_vault = true;
            let session_id = info.id.clone();
            let live = LiveSession { info: info.clone(), session: sess_arc.clone(), keepalive_cancel: cancel, term_auth };
            registry.add(live);
            registry.set_credential_id(&session_id, &credential_id);
            resume_suspended_watchers(&app, &session_id, &credential_id, &sess_arc, &suspended_registry, &watcher_registry);
            Ok(serde_json::json!({ "status": "connected", "info": info }))
        }
        session::OpenSessionResult::NeedsHostKeyConfirmation(verification, _) => {
            Ok(serde_json::json!({ "status": "host_key_unknown", "verification": verification }))
        }
        session::OpenSessionResult::HostKeyChanged(verification) => {
            Ok(serde_json::json!({ "status": "host_key_changed", "verification": verification }))
        }
    }
}
