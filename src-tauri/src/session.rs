

use std::{
    collections::HashMap,
    net::TcpStream,
    sync::{Arc, Mutex},
};

use tauri::{AppHandle, Emitter};

use serde::{Deserialize, Serialize};
use ssh2::Session;
use uuid::Uuid;

use crate::{
    error::{PylonError, PylonResult},
    known_hosts::{self, HostKeyStatus},
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
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub server_fingerprint: Option<String>,
    pub server_key_type: Option<String>,
    #[serde(default)]
    pub from_vault: bool,
}


#[derive(Debug, Serialize, Deserialize)]
pub struct HostKeyVerification {
    pub status: String,
    pub fingerprint: String,
    pub old_fingerprint: Option<String>,
    pub key_type: String,
    pub host: String,
    pub port: u16,
}


#[derive(Clone)]
pub struct TermAuthParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
}

pub struct LiveSession {
    pub info: ConnectionInfo,
    pub session: Arc<Mutex<Session>>,

    pub keepalive_cancel: Arc<std::sync::atomic::AtomicBool>,

    pub term_auth: TermAuthParams,
}

pub struct SessionRegistry {
    sessions: Arc<Mutex<HashMap<String, LiveSession>>>,
    credential_ids: Arc<Mutex<HashMap<String, String>>>,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            credential_ids: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn add(&self, session: LiveSession) -> String {
        let id = session.info.id.clone();
        self.sessions.lock().unwrap().insert(id.clone(), session);
        id
    }

    pub fn remove(&self, id: &str) {
        if let Some(s) = self.sessions.lock().unwrap().remove(id) {
            s.keepalive_cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }

    pub fn get_session_arc(&self, id: &str) -> PylonResult<Arc<Mutex<Session>>> {
        self.sessions
            .lock()
            .unwrap()
            .get(id)
            .map(|s| s.session.clone())
            .ok_or_else(|| PylonError::SessionNotFound(id.to_string()))
    }

    pub fn get_info(&self, id: &str) -> Option<ConnectionInfo> {
        self.sessions.lock().ok()?.get(id).map(|s| s.info.clone())
    }

    pub fn list_infos(&self) -> Vec<ConnectionInfo> {
        self.sessions
            .lock()
            .unwrap()
            .values()
            .map(|s| s.info.clone())
            .collect()
    }

    pub fn update_stats(&self, id: &str, sent: u64, received: u64) {
        if let Some(s) = self.sessions.lock().unwrap().get_mut(id) {
            s.info.bytes_sent += sent;
            s.info.bytes_received += received;
        }
    }

    pub fn set_state(&self, id: &str, state: ConnectionState) {
        if let Some(s) = self.sessions.lock().unwrap().get_mut(id) {
            s.info.state = state;
        }
    }

    pub fn get_term_auth(&self, id: &str) -> PylonResult<TermAuthParams> {
        self.sessions
            .lock()
            .unwrap()
            .get(id)
            .map(|s| s.term_auth.clone())
            .ok_or_else(|| PylonError::SessionNotFound(id.to_string()))
    }

    pub fn set_credential_id(&self, session_id: &str, credential_id: &str) {
        self.credential_ids
            .lock()
            .unwrap()
            .insert(session_id.to_string(), credential_id.to_string());
    }

    pub fn get_credential_id(&self, session_id: &str) -> Option<String> {
        self.credential_ids.lock().ok()?.get(session_id).cloned()
    }
}


pub enum OpenSessionResult {

    Ready(Session, ConnectionInfo),

    NeedsHostKeyConfirmation(HostKeyVerification, Session),

    HostKeyChanged(HostKeyVerification),
}


pub fn open_session(
    host: &str,
    port: u16,
    username: &str,
    password: Option<&str>,
    private_key: Option<&str>,
    label: &str,
) -> PylonResult<OpenSessionResult> {
    let addr = format!("{host}:{port}");
    let tcp = TcpStream::connect(&addr)
        .map_err(|e| PylonError::Ssh(format!("TCP connect to {addr}: {e}")))?;
    tcp.set_read_timeout(Some(std::time::Duration::from_secs(30)))?;
    tcp.set_write_timeout(Some(std::time::Duration::from_secs(30)))?;

    let mut sess = Session::new().map_err(|e| PylonError::Ssh(e.to_string()))?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| PylonError::Ssh(format!("Handshake: {e}")))?;


    let (key_type_str, key_bytes, fingerprint) = {
        let (key_bytes, key_type) = sess
            .host_key()
            .ok_or_else(|| PylonError::Ssh("Server provided no host key".into()))?;
        let type_str = match key_type {
            ssh2::HostKeyType::Rsa => "ssh-rsa",
            ssh2::HostKeyType::Dss => "ssh-dss",
            ssh2::HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
            ssh2::HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
            ssh2::HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
            ssh2::HostKeyType::Ed25519 => "ssh-ed25519",
            _ => "unknown",
        };
        let fp = known_hosts::sha256_fingerprint(key_bytes);
        (type_str.to_string(), key_bytes.to_vec(), fp)
    };


    match known_hosts::check_host_key(host, port, &key_bytes, &key_type_str)? {
        HostKeyStatus::Known => {}
        HostKeyStatus::Unknown { fingerprint, key_type } => {
            return Ok(OpenSessionResult::NeedsHostKeyConfirmation(
                HostKeyVerification {
                    status: "unknown".into(),
                    fingerprint,
                    old_fingerprint: None,
                    key_type,
                    host: host.to_string(),
                    port,
                },
                sess,
            ));
        }
        HostKeyStatus::Changed { old_fingerprint, new_fingerprint, key_type } => {
            return Ok(OpenSessionResult::HostKeyChanged(HostKeyVerification {
                status: "changed".into(),
                fingerprint: new_fingerprint,
                old_fingerprint: Some(old_fingerprint),
                key_type,
                host: host.to_string(),
                port,
            }));
        }
    }

    authenticate_session(sess, host, port, username, password, private_key, label, fingerprint, key_type_str)
        .map(|(s, info)| OpenSessionResult::Ready(s, info))
}


pub fn authenticate_and_build(
    sess: Session,
    host: &str,
    port: u16,
    username: &str,
    password: Option<&str>,
    private_key: Option<&str>,
    label: &str,
    fingerprint: String,
    key_type: String,
) -> PylonResult<(Session, ConnectionInfo)> {
    authenticate_session(sess, host, port, username, password, private_key, label, fingerprint, key_type)
}

fn authenticate_session(
    sess: Session,
    host: &str,
    port: u16,
    username: &str,
    password: Option<&str>,
    private_key: Option<&str>,
    label: &str,
    fingerprint: String,
    key_type: String,
) -> PylonResult<(Session, ConnectionInfo)> {
    if let Some(key_pem) = private_key {
        let tmp = tempfile_from_pem(key_pem)?;
        sess.userauth_pubkey_file(username, None, tmp.as_path(), None)
            .map_err(|e| PylonError::Ssh(format!("PubKey auth: {e}")))?;
        let _ = std::fs::remove_file(&tmp);
    } else if let Some(pw) = password {
        sess.userauth_password(username, pw)
            .map_err(|e| PylonError::Ssh(format!("Password auth: {e}")))?;
    } else {
        sess.userauth_agent(username).map_err(|e| {
            let msg = e.to_string();
            if msg.contains("no auth sock") || msg.contains("SSH_AUTH_SOCK") {
                PylonError::Ssh("SSH agent not available on this machine — try Password or SSH Key auth instead".into())
            } else {
                PylonError::Ssh(format!("Agent auth: {e}"))
            }
        })?;
    }

    if !sess.authenticated() {
        return Err(PylonError::Ssh("Authentication failed".into()));
    }


    sess.set_keepalive(true, 30);

    let info = ConnectionInfo {
        id: Uuid::new_v4().to_string(),
        label: label.to_string(),
        host: host.to_string(),
        port,
        username: username.to_string(),
        state: ConnectionState::Connected,
        connected_at: Some(chrono::Utc::now().to_rfc3339()),
        bytes_sent: 0,
        bytes_received: 0,
        server_fingerprint: Some(fingerprint),
        server_key_type: Some(key_type),
        from_vault: false,
    };

    Ok((sess, info))
}

pub fn spawn_keepalive(
    session: Arc<Mutex<Session>>,
    cancel: Arc<std::sync::atomic::AtomicBool>,
    app: AppHandle,
    session_id: String,
) {
    std::thread::spawn(move || {
        let mut failures: u32 = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(25));
            if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            if let Ok(sess) = session.try_lock() {
                if sess.keepalive_send().is_ok() {
                    failures = 0;
                } else {
                    failures += 1;
                    if failures >= 2 {
                        let _ = app.emit("ssh://session-died", serde_json::json!({ "session_id": &session_id }));
                        break;
                    }
                }
            }
        }
    });
}


pub fn open_transfer_session(auth: &TermAuthParams) -> PylonResult<Arc<Mutex<Session>>> {
    let addr = format!("{}:{}", auth.host, auth.port);
    let tcp = TcpStream::connect(&addr)
        .map_err(|e| PylonError::Ssh(format!("Worker TCP connect {addr}: {e}")))?;
    tcp.set_read_timeout(Some(std::time::Duration::from_secs(30)))?;
    tcp.set_write_timeout(Some(std::time::Duration::from_secs(30)))?;

    let mut sess = Session::new().map_err(|e| PylonError::Ssh(e.to_string()))?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| PylonError::Ssh(format!("Worker handshake: {e}")))?;

    if let Some(ref key_pem) = auth.private_key {
        let tmp = tempfile_from_pem(key_pem)?;
        sess.userauth_pubkey_file(&auth.username, None, tmp.as_path(), None)
            .map_err(|e| PylonError::Ssh(format!("Worker pubkey auth: {e}")))?;
        let _ = std::fs::remove_file(&tmp);
    } else if let Some(ref pw) = auth.password {
        sess.userauth_password(&auth.username, pw)
            .map_err(|e| PylonError::Ssh(format!("Worker password auth: {e}")))?;
    } else {
        sess.userauth_agent(&auth.username)
            .map_err(|e| PylonError::Ssh(format!("Worker agent auth: {e}")))?;
    }

    if !sess.authenticated() {
        return Err(PylonError::Ssh("Worker authentication failed".into()));
    }
    sess.set_keepalive(true, 30);
    Ok(Arc::new(Mutex::new(sess)))
}

fn tempfile_from_pem(pem: &str) -> PylonResult<std::path::PathBuf> {
    let path = std::env::temp_dir().join(format!("pylon_key_{}.pem", Uuid::new_v4()));
    std::fs::write(&path, pem)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(path)
}
