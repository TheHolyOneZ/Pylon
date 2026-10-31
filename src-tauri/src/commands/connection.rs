use tauri::{AppHandle, Manager};

use super::blocking;
use crate::{
    error::PylonError,
    fs_watcher::WatcherRegistry,
    known_hosts::{self, HostKeyStatus},
    session::{self, ConnectOutcome, ConnectionInfo, SessionRegistry},
    ssh::{self, AuthParams},
    ssh_config::{self, SshConfigHost},
    terminal::TerminalRegistry,
    watcher_store::{PersistedWatcherConfig, SuspendedWatcherRegistry, WatcherStore},
};

fn outcome_json(o: ConnectOutcome) -> serde_json::Value {
    match o {
        ConnectOutcome::Connected(info) => serde_json::json!({ "status": "connected", "info": info }),
        ConnectOutcome::NeedsHostKey(v) => {
            let status = if v.status == "changed" { "host_key_changed" } else { "host_key_unknown" };
            serde_json::json!({ "status": status, "verification": v })
        }
    }
}

fn auth_from(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    key_passphrase: Option<String>,
) -> AuthParams {
    AuthParams {
        host,
        port,
        username,
        password: password.filter(|p| !p.is_empty()),
        private_key: private_key.filter(|k| !k.trim().is_empty()),
        key_passphrase: key_passphrase.filter(|p| !p.is_empty()),
        expected_fingerprint: None,
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn connect(
    app: AppHandle,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    key_passphrase: Option<String>,
    label: String,
) -> Result<serde_json::Value, PylonError> {
    blocking(move || {
        let auth = auth_from(host, port, username, password, private_key, key_passphrase);
        let reg = app.state::<SessionRegistry>();
        session::establish(&app, &reg, auth, &label, false, None, None).map(outcome_json)
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn accept_host_key_and_connect(
    app: AppHandle,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    key_passphrase: Option<String>,
    label: String,
    fingerprint: String,
    permanent: bool,
) -> Result<ConnectionInfo, PylonError> {
    blocking(move || {
        let auth = auth_from(host, port, username, password, private_key, key_passphrase);
        let reg = app.state::<SessionRegistry>();
        match session::establish(&app, &reg, auth, &label, false, None, Some((fingerprint, permanent)))? {
            ConnectOutcome::Connected(info) => Ok(info),
            ConnectOutcome::NeedsHostKey(_) => Err(PylonError::Ssh("Host key verification failed".into())),
        }
    })
    .await
}

pub fn teardown_session(app: &AppHandle, session_id: &str) {
    let watcher_registry = app.state::<WatcherRegistry>();
    let watcher_store = app.state::<WatcherStore>();
    let suspended = app.state::<SuspendedWatcherRegistry>();
    for config in watcher_registry.on_session_removed(session_id) {
        let persisted = PersistedWatcherConfig::from(&config);
        let _ = watcher_store.save(&persisted);
        suspended.push(persisted.clone());
        let _ = tauri::Emitter::emit(app, "sync://suspended", &persisted);
    }
    app.state::<TerminalRegistry>().close_for_session(session_id);
    app.state::<SessionRegistry>().remove(session_id);
}

#[tauri::command]
pub async fn disconnect(app: AppHandle, session_id: String) -> Result<(), PylonError> {
    blocking(move || {
        teardown_session(&app, &session_id);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn list_connections(app: AppHandle) -> Result<Vec<ConnectionInfo>, PylonError> {
    Ok(app.state::<SessionRegistry>().list_infos())
}

#[tauri::command]
pub async fn test_connection(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    key_passphrase: Option<String>,
) -> Result<serde_json::Value, PylonError> {
    blocking(move || {
        let auth = auth_from(host, port, username, password, private_key, key_passphrase);
        let start = std::time::Instant::now();
        let (sess, key) = ssh::handshake(&auth.host, auth.port)?;
        let handshake_ms = start.elapsed().as_millis();
        match known_hosts::check_host_key(&auth.host, auth.port, &key.key)? {
            HostKeyStatus::Known => {}
            HostKeyStatus::Unknown { .. } => {
                return Ok(serde_json::json!({
                    "success": false, "reason": "host_key_unknown",
                    "fingerprint": key.fingerprint, "key_type": key.key_type,
                    "latency_ms": handshake_ms,
                }));
            }
            HostKeyStatus::Changed { .. } => {
                return Ok(serde_json::json!({
                    "success": false, "reason": "host_key_changed",
                    "fingerprint": key.fingerprint, "key_type": key.key_type,
                    "latency_ms": handshake_ms,
                }));
            }
        }
        ssh::authenticate(&sess, &auth)?;
        let _ = sess.disconnect(None, "test", None);
        Ok(serde_json::json!({
            "success": true,
            "latency_ms": handshake_ms,
            "server_version": sess.banner(),
        }))
    })
    .await
}

#[tauri::command]
pub async fn get_connection_status(app: AppHandle, session_id: String) -> Result<ConnectionInfo, PylonError> {
    app.state::<SessionRegistry>()
        .get_info(&session_id)
        .ok_or(PylonError::SessionNotFound(session_id))
}

#[tauri::command]
pub async fn list_ssh_config_hosts() -> Result<Vec<SshConfigHost>, PylonError> {
    blocking(|| Ok(ssh_config::list_ssh_config_hosts())).await
}
