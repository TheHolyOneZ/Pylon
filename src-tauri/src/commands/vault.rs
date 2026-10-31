use tauri::{AppHandle, Emitter, Manager};

use super::blocking;
use crate::{
    error::PylonError,
    fs_watcher::WatcherRegistry,
    session::{self, ConnectOutcome, ConnectionInfo, SessionRegistry},
    ssh::AuthParams,
    vault::{self, AuthType, Credential},
    vault_manager::{VaultManager, VaultProfile},
    watcher_store::SuspendedWatcherRegistry,
};

#[tauri::command]
pub async fn vault_list_profiles(app: AppHandle) -> Result<Vec<VaultProfile>, PylonError> {
    Ok(app.state::<VaultManager>().list_profiles())
}

#[tauri::command]
pub async fn vault_active_profile_id(app: AppHandle) -> Result<String, PylonError> {
    Ok(app.state::<VaultManager>().active_profile_id())
}

#[tauri::command]
pub async fn vault_select_profile(app: AppHandle, profile_id: String) -> Result<(), PylonError> {
    let m = app.state::<VaultManager>();
    m.lock_all();
    m.select_profile(&profile_id)
}

#[tauri::command]
pub async fn vault_create_profile(app: AppHandle, name: String, color: String, icon: String) -> Result<VaultProfile, PylonError> {
    app.state::<VaultManager>().create_profile(name, color, icon)
}

#[tauri::command]
pub async fn vault_delete_profile(app: AppHandle, profile_id: String) -> Result<(), PylonError> {
    app.state::<VaultManager>().delete_profile(&profile_id)
}

#[tauri::command]
pub async fn vault_rename_profile(app: AppHandle, profile_id: String, name: String, color: String, icon: String) -> Result<(), PylonError> {
    app.state::<VaultManager>().rename_profile(&profile_id, name, color, icon)
}

#[tauri::command]
pub async fn vault_exists(app: AppHandle) -> Result<bool, PylonError> {
    Ok(app.state::<VaultManager>().exists())
}

#[tauri::command]
pub async fn vault_create(app: AppHandle, passphrase: String) -> Result<(), PylonError> {
    blocking(move || app.state::<VaultManager>().create(&passphrase)).await
}

#[tauri::command]
pub async fn vault_unlock(app: AppHandle, passphrase: String) -> Result<(), PylonError> {
    blocking(move || app.state::<VaultManager>().unlock(&passphrase)).await
}

#[tauri::command]
pub async fn vault_change_passphrase(app: AppHandle, current: String, new_passphrase: String) -> Result<(), PylonError> {
    blocking(move || app.state::<VaultManager>().change_passphrase(&current, &new_passphrase)).await
}

#[tauri::command]
pub async fn vault_lock(app: AppHandle) -> Result<(), PylonError> {
    app.state::<VaultManager>().lock_all();
    Ok(())
}

#[tauri::command]
pub async fn vault_is_unlocked(app: AppHandle) -> Result<bool, PylonError> {
    Ok(app.state::<VaultManager>().is_unlocked())
}

#[tauri::command]
pub async fn vault_reset(app: AppHandle) -> Result<(), PylonError> {
    app.state::<VaultManager>().reset()
}

fn blank_to_none(s: Option<String>) -> Option<String> {
    s.filter(|v| !v.trim().is_empty())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn vault_add_credential(
    app: AppHandle,
    label: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    key_passphrase: Option<String>,
    auth_type: AuthType,
) -> Result<String, PylonError> {
    blocking(move || {
        let cred = vault::new_credential(
            label.trim().to_string(),
            host.trim().to_string(),
            port,
            username.trim().to_string(),
            blank_to_none(password),
            blank_to_none(private_key),
            blank_to_none(key_passphrase),
            auth_type,
        );
        app.state::<VaultManager>().add_credential(cred)
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn vault_update_credential(
    app: AppHandle,
    id: String,
    label: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    key_passphrase: Option<String>,
    auth_type: AuthType,
) -> Result<(), PylonError> {
    blocking(move || {
        let cred = Credential {
            id,
            label: label.trim().to_string(),
            host: host.trim().to_string(),
            port,
            username: username.trim().to_string(),
            password: blank_to_none(password),
            private_key: blank_to_none(private_key),
            key_passphrase: blank_to_none(key_passphrase),
            auth_type,
            created_at: String::new(),
            last_used: None,
        };
        app.state::<VaultManager>().update_credential(cred)
    })
    .await
}

#[tauri::command]
pub async fn vault_get_credential(app: AppHandle, id: String) -> Result<Credential, PylonError> {
    app.state::<VaultManager>().get_credential(&id)
}

#[tauri::command]
pub async fn vault_list_credentials(app: AppHandle) -> Result<Vec<Credential>, PylonError> {
    app.state::<VaultManager>().list_credentials()
}

#[tauri::command]
pub async fn vault_delete_credential(
    app: AppHandle,
    id: String,
) -> Result<(), PylonError> {
    blocking(move || app.state::<VaultManager>().delete_credential(&id)).await
}

fn auth_for(cred: &Credential) -> Result<AuthParams, PylonError> {
    let (password, private_key) = match cred.auth_type {
        AuthType::Password => {
            if cred.password.is_none() {
                return Err(PylonError::Ssh(format!("\"{}\" has no saved password — edit it in ZVault", cred.label)));
            }
            (cred.password.clone(), None)
        }
        AuthType::PrivateKey => {
            if cred.private_key.is_none() {
                return Err(PylonError::Ssh(format!("\"{}\" has no saved key — edit it in ZVault", cred.label)));
            }
            (None, cred.private_key.clone())
        }
        AuthType::Agent => (None, None),
    };
    Ok(AuthParams {
        host: cred.host.clone(),
        port: cred.port,
        username: cred.username.clone(),
        password,
        private_key,
        key_passphrase: cred.key_passphrase.clone(),
        expected_fingerprint: None,
    })
}

fn vault_establish(app: &AppHandle, credential_id: &str, accept: Option<(String, bool)>) -> Result<ConnectOutcome, PylonError> {
    let manager = app.state::<VaultManager>();
    let cred = manager.get_credential_with_secret(credential_id)?;
    let auth = auth_for(&cred)?;
    let reg = app.state::<SessionRegistry>();
    let outcome = session::establish(app, &reg, auth, &cred.label, true, Some(credential_id.to_string()), accept)?;
    if let ConnectOutcome::Connected(info) = &outcome {
        manager.touch(credential_id);
        resume_suspended_watchers(app, &info.id, credential_id, info.server_fingerprint.as_deref().unwrap_or(""));
    }
    Ok(outcome)
}

#[tauri::command]
pub async fn vault_connect(app: AppHandle, credential_id: String) -> Result<serde_json::Value, PylonError> {
    blocking(move || {
        Ok(match vault_establish(&app, &credential_id, None)? {
            ConnectOutcome::Connected(info) => serde_json::json!({ "status": "connected", "info": info }),
            ConnectOutcome::NeedsHostKey(v) => {
                let status = if v.status == "changed" { "host_key_changed" } else { "host_key_unknown" };
                serde_json::json!({ "status": status, "verification": v })
            }
        })
    })
    .await
}

#[tauri::command]
pub async fn vault_accept_host_key_and_connect(
    app: AppHandle,
    credential_id: String,
    fingerprint: String,
    permanent: bool,
) -> Result<ConnectionInfo, PylonError> {
    blocking(move || match vault_establish(&app, &credential_id, Some((fingerprint, permanent)))? {
        ConnectOutcome::Connected(info) => Ok(info),
        ConnectOutcome::NeedsHostKey(_) => Err(PylonError::Ssh("Host key verification failed".into())),
    })
    .await
}

fn resume_suspended_watchers(app: &AppHandle, session_id: &str, credential_id: &str, fingerprint: &str) {
    let Ok(conn) = app.state::<SessionRegistry>().get_conn(session_id) else { return };
    let watchers = app.state::<WatcherRegistry>();
    for id in watchers.rebind(credential_id, fingerprint, session_id, &conn) {
        let _ = app.emit("sync://resumed", serde_json::json!({ "sync_id": id }));
    }

    let suspended = app.state::<SuspendedWatcherRegistry>();
    for cfg in suspended.list().into_iter().filter(|c| c.credential_id == credential_id) {
        if cfg.expected_fingerprint != fingerprint {
            continue;
        }
        let sync_config = cfg.to_sync_config(session_id);
        if watchers.start(app.clone(), sync_config.clone(), conn.clone()).is_ok() {
            suspended.remove(&cfg.id);
            let _ = app.emit("sync://resumed", serde_json::json!({ "sync_id": &cfg.id, "label": &cfg.label, "config": sync_config }));
        }
    }
}
