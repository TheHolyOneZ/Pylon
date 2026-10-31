use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::{
    error::{PylonError, PylonResult},
    known_hosts::{self, HostKeyStatus},
    ssh::{self, AuthParams, SshConn},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    Connected,
    Disconnected,
    Connecting,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub state: ConnectionState,
    pub connected_at: Option<String>,
    pub server_fingerprint: Option<String>,
    pub server_key_type: Option<String>,
    pub server_version: Option<String>,
    pub home_dir: Option<String>,
    #[serde(default)]
    pub from_vault: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostKeyVerification {
    pub status: String,
    pub fingerprint: String,
    pub old_fingerprint: Option<String>,
    pub key_type: String,
    pub host: String,
    pub port: u16,
}

pub struct LiveSession {
    pub info: ConnectionInfo,
    pub conn: SshConn,
    pub keepalive_cancel: Arc<AtomicBool>,
    pub auth: AuthParams,
    pub credential_id: Option<String>,
}

#[derive(Clone, Default)]
pub struct SessionRegistry {
    sessions: Arc<Mutex<HashMap<String, LiveSession>>>,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, LiveSession>> {
        self.sessions.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn add(&self, session: LiveSession) -> String {
        let id = session.info.id.clone();
        self.lock().insert(id.clone(), session);
        id
    }

    pub fn remove(&self, id: &str) -> bool {
        let removed = self.lock().remove(id);
        match removed {
            Some(s) => {
                s.keepalive_cancel.store(true, Ordering::Relaxed);
                let sess = s.conn.sess.clone();
                std::thread::spawn(move || {
                    let _ = sess.disconnect(None, "Pylon disconnect", None);
                });
                true
            }
            None => false,
        }
    }

    pub fn get_conn(&self, id: &str) -> PylonResult<SshConn> {
        self.lock()
            .get(id)
            .map(|s| s.conn.clone())
            .ok_or_else(|| PylonError::SessionNotFound(id.to_string()))
    }

    pub fn get_info(&self, id: &str) -> Option<ConnectionInfo> {
        self.lock().get(id).map(|s| s.info.clone())
    }

    pub fn list_infos(&self) -> Vec<ConnectionInfo> {
        let mut v: Vec<_> = self.lock().values().map(|s| s.info.clone()).collect();
        v.sort_by(|a, b| a.connected_at.cmp(&b.connected_at));
        v
    }

    pub fn get_auth(&self, id: &str) -> PylonResult<AuthParams> {
        self.lock()
            .get(id)
            .map(|s| s.auth.clone())
            .ok_or_else(|| PylonError::SessionNotFound(id.to_string()))
    }

    pub fn get_credential_id(&self, session_id: &str) -> Option<String> {
        self.lock().get(session_id).and_then(|s| s.credential_id.clone())
    }

    pub fn set_state(&self, id: &str, state: ConnectionState) {
        if let Some(s) = self.lock().get_mut(id) {
            s.info.state = state;
        }
    }
}

pub enum ConnectOutcome {
    Connected(ConnectionInfo),
    NeedsHostKey(HostKeyVerification),
}

pub fn establish(
    app: &AppHandle,
    registry: &SessionRegistry,
    mut auth: AuthParams,
    label: &str,
    from_vault: bool,
    credential_id: Option<String>,
    accept: Option<(String, bool)>,
) -> PylonResult<ConnectOutcome> {
    auth.host = auth.host.trim().to_string();
    auth.username = auth.username.trim().to_string();
    let (sess, key) = ssh::handshake(&auth.host, auth.port)?;

    match accept {
        Some((fp, permanent)) => {
            if fp != key.fingerprint {
                return Err(PylonError::Ssh(format!(
                    "The server's host key changed while you were reviewing it (accepted {fp}, now {}). Not connecting.",
                    key.fingerprint
                )));
            }
            if permanent {
                known_hosts::add_host_key(&auth.host, auth.port, &key.key)?;
            }
        }
        None => match known_hosts::check_host_key(&auth.host, auth.port, &key.key)? {
            HostKeyStatus::Known => {}
            HostKeyStatus::Unknown { fingerprint, key_type } => {
                return Ok(ConnectOutcome::NeedsHostKey(HostKeyVerification {
                    status: "unknown".into(),
                    fingerprint,
                    old_fingerprint: None,
                    key_type,
                    host: auth.host.clone(),
                    port: auth.port,
                }));
            }
            HostKeyStatus::Changed { old_fingerprint, new_fingerprint, key_type } => {
                let v = HostKeyVerification {
                    status: "changed".into(),
                    fingerprint: new_fingerprint,
                    old_fingerprint: Some(old_fingerprint),
                    key_type,
                    host: auth.host.clone(),
                    port: auth.port,
                };
                let _ = app.emit("ssh://host-key-changed", &v);
                return Ok(ConnectOutcome::NeedsHostKey(v));
            }
        },
    }

    ssh::authenticate(&sess, &auth)?;
    auth.expected_fingerprint = Some(key.fingerprint.clone());

    let conn = SshConn::new(sess);
    let home_dir = conn
        .sftp()
        .ok()
        .and_then(|s| s.realpath(std::path::Path::new(".")).ok())
        .map(|p| p.to_string_lossy().replace('\\', "/"));

    let server_version = conn.sess.banner().map(|b| b.trim().to_string());

    let info = ConnectionInfo {
        id: Uuid::new_v4().to_string(),
        label: if label.trim().is_empty() { format!("{}@{}", auth.username, auth.host) } else { label.trim().to_string() },
        host: auth.host.clone(),
        port: auth.port,
        username: auth.username.clone(),
        state: ConnectionState::Connected,
        connected_at: Some(chrono::Utc::now().to_rfc3339()),
        server_fingerprint: Some(key.fingerprint),
        server_key_type: Some(key.key_type),
        server_version,
        home_dir,
        from_vault,
    };

    let cancel = Arc::new(AtomicBool::new(false));
    spawn_keepalive(conn.clone(), cancel.clone(), app.clone(), registry.clone(), info.id.clone());
    registry.add(LiveSession {
        info: info.clone(),
        conn,
        keepalive_cancel: cancel,
        auth,
        credential_id,
    });
    Ok(ConnectOutcome::Connected(info))
}

fn spawn_keepalive(
    conn: SshConn,
    cancel: Arc<AtomicBool>,
    app: AppHandle,
    registry: SessionRegistry,
    session_id: String,
) {
    std::thread::spawn(move || {
        let mut failures: u32 = 0;
        let mut ticks = 0u32;
        loop {
            std::thread::sleep(Duration::from_secs(1));
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            ticks += 1;
            let mut lost = conn.is_dead();
            if !lost && ticks >= 15 {
                ticks = 0;
                match conn.sess.keepalive_send() {
                    Ok(_) => failures = 0,
                    Err(e) => {
                        failures += 1;
                        lost = conn.note(&e) || failures >= 2;
                    }
                }
            }
            if lost && !cancel.load(Ordering::Relaxed) {
                registry.set_state(&session_id, ConnectionState::Error("connection lost".into()));
                let _ = app.emit("ssh://session-died", serde_json::json!({ "session_id": &session_id }));
                break;
            }
        }
    });
}
