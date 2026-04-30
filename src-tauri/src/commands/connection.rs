use std::sync::{Arc, atomic::AtomicBool};

use tauri::{AppHandle, Emitter, State};

use crate::{
    error::PylonError,
    fs_watcher::WatcherRegistry,
    known_hosts,
    session::{self, ConnectionInfo, LiveSession, OpenSessionResult, SessionRegistry, TermAuthParams},
    ssh_config::{self, SshConfigHost},
    watcher_store::{PersistedWatcherConfig, SuspendedWatcherRegistry, WatcherStore},
};

#[tauri::command]
pub async fn connect(
    app: AppHandle,
    registry: State<'_, SessionRegistry>,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    label: String,
) -> Result<serde_json::Value, PylonError> {
    let result = session::open_session(
        &host, port, &username,
        password.as_deref(),
        private_key.as_deref(),
        &label,
    )?;

    match result {
        OpenSessionResult::Ready(sess, info) => {
            let cancel = Arc::new(AtomicBool::new(false));
            let sess_arc = Arc::new(std::sync::Mutex::new(sess));
            session::spawn_keepalive(sess_arc.clone(), cancel.clone(), app.clone(), info.id.clone());
            let term_auth = TermAuthParams {
                host: host.clone(),
                port,
                username: username.clone(),
                password: password.clone(),
                private_key: private_key.clone(),
            };
            let live = LiveSession { info: info.clone(), session: sess_arc, keepalive_cancel: cancel, term_auth };
            registry.add(live);
            Ok(serde_json::json!({ "status": "connected", "info": info }))
        }
        OpenSessionResult::NeedsHostKeyConfirmation(verification, _sess) => {


            let _ = app.emit("ssh://host-key-verify", &verification);
            Ok(serde_json::json!({ "status": "host_key_unknown", "verification": verification }))
        }
        OpenSessionResult::HostKeyChanged(verification) => {
            let _ = app.emit("ssh://host-key-changed", &verification);
            Ok(serde_json::json!({ "status": "host_key_changed", "verification": verification }))
        }
    }
}


#[tauri::command]
pub async fn accept_host_key_and_connect(
    app: AppHandle,
    registry: State<'_, SessionRegistry>,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    label: String,
    permanent: bool,
) -> Result<ConnectionInfo, PylonError> {

    let addr = format!("{host}:{port}");
    let tcp = std::net::TcpStream::connect(&addr)
        .map_err(|e| PylonError::Ssh(format!("TCP connect to {addr}: {e}")))?;

    let mut temp_sess = ssh2::Session::new().map_err(|e| PylonError::Ssh(e.to_string()))?;
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
        known_hosts::add_host_key(&host, port, &key_bytes_owned, key_type_str)?;
    }

    let (sess, info) = session::authenticate_and_build(
        temp_sess, &host, port, &username,
        password.as_deref(), private_key.as_deref(),
        &label, fingerprint, key_type_str.to_string(),
    )?;

    let cancel = Arc::new(AtomicBool::new(false));
    let sess_arc = Arc::new(std::sync::Mutex::new(sess));
    session::spawn_keepalive(sess_arc.clone(), cancel.clone(), app.clone(), info.id.clone());
    let term_auth = TermAuthParams {
        host: host.clone(),
        port,
        username: username.clone(),
        password: password.clone(),
        private_key: private_key.clone(),
    };
    let live = LiveSession { info: info.clone(), session: sess_arc, keepalive_cancel: cancel, term_auth };
    registry.add(live);
    Ok(info)
}

#[tauri::command]
pub async fn disconnect(
    app: AppHandle,
    registry: State<'_, SessionRegistry>,
    watcher_registry: State<'_, WatcherRegistry>,
    watcher_store: State<'_, WatcherStore>,
    suspended_registry: State<'_, SuspendedWatcherRegistry>,
    session_id: String,
) -> Result<(), PylonError> {
    let stopped = watcher_registry.on_session_removed(&session_id);
    for config in stopped {
        let persisted = PersistedWatcherConfig::from(&config);
        let _ = watcher_store.save(&persisted);
        suspended_registry.inner_arc().lock().unwrap().push(persisted.clone());
        let _ = app.emit("sync://suspended", &persisted);
    }
    registry.remove(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn list_connections(
    registry: State<'_, SessionRegistry>,
) -> Result<Vec<ConnectionInfo>, PylonError> {
    Ok(registry.list_infos())
}

#[tauri::command]
pub async fn test_connection(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
) -> Result<serde_json::Value, PylonError> {
    let start = std::time::Instant::now();
    let result = session::open_session(
        &host, port, &username,
        password.as_deref(), private_key.as_deref(),
        "test",
    );
    let latency_ms = start.elapsed().as_millis();
    match result? {
        OpenSessionResult::Ready(_, _) => Ok(serde_json::json!({
            "success": true,
            "latency_ms": latency_ms
        })),
        OpenSessionResult::NeedsHostKeyConfirmation(v, _) => Ok(serde_json::json!({
            "success": false,
            "reason": "host_key_unknown",
            "fingerprint": v.fingerprint
        })),
        OpenSessionResult::HostKeyChanged(v) => Ok(serde_json::json!({
            "success": false,
            "reason": "host_key_changed",
            "fingerprint": v.fingerprint
        })),
    }
}

#[tauri::command]
pub async fn get_connection_status(
    registry: State<'_, SessionRegistry>,
    session_id: String,
) -> Result<ConnectionInfo, PylonError> {
    registry
        .list_infos()
        .into_iter()
        .find(|i| i.id == session_id)
        .ok_or_else(|| PylonError::SessionNotFound(session_id))
}

#[tauri::command]
pub async fn list_ssh_config_hosts() -> Result<Vec<SshConfigHost>, PylonError> {
    Ok(ssh_config::list_ssh_config_hosts())
}
