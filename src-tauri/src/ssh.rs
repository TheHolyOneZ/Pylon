use std::{
    net::{TcpStream, ToSocketAddrs},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use ssh2::{Prompt, Session, Sftp};

use crate::error::{PylonError, PylonResult};

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(12);
pub const SESSION_TIMEOUT_MS: u32 = 60_000;

#[derive(Clone, Debug, Default)]
pub struct AuthParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub key_passphrase: Option<String>,
    pub expected_fingerprint: Option<String>,
}

#[derive(Clone, Debug)]
pub struct HostKeyInfo {
    pub key: Vec<u8>,
    pub key_type: String,
    pub fingerprint: String,
}

#[derive(Clone)]
pub struct SshConn {
    pub sess: Session,
    sftp: Arc<Mutex<Option<Arc<Sftp>>>>,
    dead: Arc<AtomicBool>,
}

const TRANSPORT_LOST: [i32; 5] = [
    -7,
    -13,
    -30,
    -43,
    -45,
];

pub fn is_transport_lost(e: &ssh2::Error) -> bool {
    matches!(e.code(), ssh2::ErrorCode::Session(c) if TRANSPORT_LOST.contains(&c))
}

const TRANSPORT_LOST_MSGS: [&str; 6] = [
    "draining incoming flow",
    "socket disconnect",
    "unable to send",
    "error waiting on socket",
    "failed sending",
    "connection reset",
];

fn io_looks_transport_lost(e: &std::io::Error) -> bool {
    let m = e.to_string().to_ascii_lowercase();
    matches!(e.kind(), std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::BrokenPipe | std::io::ErrorKind::ConnectionAborted)
        || TRANSPORT_LOST_MSGS.iter().any(|p| m.contains(p))
}

impl SshConn {
    pub fn new(sess: Session) -> Self {
        Self { sess, sftp: Arc::new(Mutex::new(None)), dead: Arc::new(AtomicBool::new(false)) }
    }

    pub fn is_dead(&self) -> bool {
        self.dead.load(Ordering::Relaxed)
    }

    pub fn note(&self, e: &ssh2::Error) -> bool {
        let lost = is_transport_lost(e);
        if lost {
            self.dead.store(true, Ordering::Relaxed);
        }
        lost
    }

    pub fn io_error(&self, ctx: &str, e: &std::io::Error) -> PylonError {
        let by_code = ssh2::Error::last_session_error(&self.sess).map(|le| self.note(&le)).unwrap_or(false);
        if by_code || io_looks_transport_lost(e) {
            self.dead.store(true, Ordering::Relaxed);
            return PylonError::Transfer(format!("{ctx}: connection to the server was lost"));
        }
        PylonError::Transfer(format!("{ctx}: {e}"))
    }

    pub fn sftp(&self) -> PylonResult<Arc<Sftp>> {
        let mut slot = self.sftp.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(s) = slot.as_ref() {
            return Ok(s.clone());
        }
        let s = Arc::new(self.sess.sftp().map_err(|e| {
            if self.note(&e) || self.is_dead() {
                PylonError::Sftp("Connection to the server was lost".into())
            } else {
                PylonError::Sftp(format!("Could not open SFTP channel: {}", describe(&e)))
            }
        })?);
        *slot = Some(s.clone());
        Ok(s)
    }

    pub fn reset_sftp(&self) {
        if let Ok(mut slot) = self.sftp.lock() {
            *slot = None;
        }
    }

    pub fn sftp_op<T>(
        &self,
        ctx: impl Fn() -> String,
        f: impl Fn(&Sftp) -> Result<T, ssh2::Error>,
    ) -> PylonResult<T> {
        let sftp = self.sftp()?;
        match f(&sftp) {
            Ok(v) => Ok(v),
            Err(e) if matches!(e.code(), ssh2::ErrorCode::Session(_)) => {
                if self.note(&e) {
                    return Err(sftp_error(&ctx(), &e));
                }
                self.reset_sftp();
                let sftp = self.sftp()?;
                f(&sftp).map_err(|e| {
                    self.note(&e);
                    sftp_error(&ctx(), &e)
                })
            }
            Err(e) => Err(sftp_error(&ctx(), &e)),
        }
    }
}

pub fn sftp_status_hint(code: i32) -> Option<&'static str> {
    Some(match code {
        2 => "no such file or directory",
        3 => "permission denied",
        4 => "operation failed on the server",
        5 => "bad message",
        6 | 7 => "connection lost",
        8 => "operation not supported by the server",
        11 => "already exists",
        12 => "write-protected",
        14 => "no space left on device",
        15 => "quota exceeded",
        18 => "directory not empty",
        19 => "not a directory",
        21 => "too many symbolic links",
        24 => "invalid file name",
        _ => return None,
    })
}

pub fn sftp_error(ctx: &str, e: &ssh2::Error) -> PylonError {
    match e.code() {
        ssh2::ErrorCode::SFTP(code) => match sftp_status_hint(code) {
            Some(h) => PylonError::Sftp(format!("{ctx}: {h}")),
            None => PylonError::Sftp(format!("{ctx}: {e}")),
        },
        ssh2::ErrorCode::Session(_) => PylonError::Sftp(format!("{ctx}: {}", describe(e))),
    }
}

pub fn describe(e: &ssh2::Error) -> String {
    match e.code() {
        ssh2::ErrorCode::Session(c) if TRANSPORT_LOST.contains(&c) => "connection to the server was lost".into(),
        ssh2::ErrorCode::Session(-9) => "the server did not respond in time".into(),
        ssh2::ErrorCode::Session(-21) => "the server refused to open a channel (session limit reached or connection closing)".into(),
        _ => e.message().to_string(),
    }
}

pub fn is_not_found(e: &ssh2::Error) -> bool {
    matches!(e.code(), ssh2::ErrorCode::SFTP(2))
}

pub fn tcp_connect(host: &str, port: u16) -> PylonResult<TcpStream> {
    let host_trim = host.trim().trim_start_matches('[').trim_end_matches(']');
    if host_trim.is_empty() {
        return Err(PylonError::Ssh("Host is empty".into()));
    }
    let addrs: Vec<_> = (host_trim, port)
        .to_socket_addrs()
        .map_err(|e| PylonError::Ssh(format!("Cannot resolve {host_trim}: {e}")))?
        .collect();
    if addrs.is_empty() {
        return Err(PylonError::Ssh(format!("Cannot resolve {host_trim}")));
    }
    let mut last_err = None;
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
            Ok(s) => {
                let _ = s.set_nodelay(true);
                return Ok(s);
            }
            Err(e) => last_err = Some((addr, e)),
        }
    }
    let (addr, e) = last_err.unwrap();
    let hint = match e.kind() {
        std::io::ErrorKind::TimedOut => " (timed out — host unreachable or port filtered)",
        std::io::ErrorKind::ConnectionRefused => " (connection refused — is SSH running on that port?)",
        _ => "",
    };
    Err(PylonError::Ssh(format!("TCP connect to {addr} failed: {e}{hint}")))
}

pub fn handshake(host: &str, port: u16) -> PylonResult<(Session, HostKeyInfo)> {
    let tcp = tcp_connect(host, port)?;
    let mut sess = Session::new().map_err(|e| PylonError::Ssh(e.to_string()))?;
    sess.set_blocking(true);
    sess.set_timeout(SESSION_TIMEOUT_MS);
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| PylonError::Ssh(format!("SSH handshake with {host}:{port} failed: {e}")))?;
    let info = host_key_info(&sess)?;
    Ok((sess, info))
}

pub fn host_key_info(sess: &Session) -> PylonResult<HostKeyInfo> {
    let (key, _) = sess
        .host_key()
        .ok_or_else(|| PylonError::Ssh("Server provided no host key".into()))?;
    Ok(HostKeyInfo {
        key: key.to_vec(),
        key_type: crate::known_hosts::key_type_from_blob(key).unwrap_or_else(|| "unknown".into()),
        fingerprint: crate::known_hosts::sha256_fingerprint(key),
    })
}

fn expand_tilde(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/").or_else(|| p.strip_prefix("~\\")) {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    if p == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    }
    PathBuf::from(p)
}

pub fn resolve_private_key(input: &str) -> PylonResult<String> {
    let t = input.trim();
    if t.contains("PRIVATE KEY-----") {
        return Ok(normalise_key_text(t));
    }
    if t.starts_with("PuTTY-User-Key-File") {
        return Err(PylonError::Ssh(
            "PuTTY .ppk keys are not supported — convert it with PuTTYgen (Conversions → Export OpenSSH key)".into(),
        ));
    }
    let path = expand_tilde(t);
    if path.extension().map(|e| e == "pub").unwrap_or(false) {
        return Err(PylonError::Ssh(format!(
            "{} is a public key — select the private key file (without .pub)",
            path.display()
        )));
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|e| PylonError::Ssh(format!("Cannot read key file {}: {e}", path.display())))?;
    if text.trim_start().starts_with("PuTTY-User-Key-File") {
        return Err(PylonError::Ssh(
            "PuTTY .ppk keys are not supported — convert it with PuTTYgen (Conversions → Export OpenSSH key)".into(),
        ));
    }
    if !text.contains("PRIVATE KEY-----") {
        return Err(PylonError::Ssh(format!("{} does not look like a private key", path.display())));
    }
    Ok(normalise_key_text(&text))
}

fn normalise_key_text(t: &str) -> String {
    let mut s = t.replace("\r\n", "\n").trim().to_string();
    s.push('\n');
    s
}

struct PasswordResponder<'a>(&'a str);
impl ssh2::KeyboardInteractivePrompt for PasswordResponder<'_> {
    fn prompt<'b>(&mut self, _username: &str, _instructions: &str, prompts: &[Prompt<'b>]) -> Vec<String> {
        prompts
            .iter()
            .map(|p| if p.echo { String::new() } else { self.0.to_string() })
            .collect()
    }
}

pub fn authenticate(sess: &Session, auth: &AuthParams) -> PylonResult<()> {
    let user = auth.username.trim();
    if user.is_empty() {
        return Err(PylonError::Ssh("Username is empty".into()));
    }
    let methods = sess.auth_methods(user).unwrap_or("").to_string();
    if sess.authenticated() {
        return Ok(());
    }

    if let Some(key_input) = auth.private_key.as_deref().filter(|k| !k.trim().is_empty()) {
        let key = resolve_private_key(key_input)?;
        let pass = auth.key_passphrase.as_deref().filter(|p| !p.is_empty());
        if let Err(e) = sess.userauth_pubkey_memory(user, None, &key, pass) {
            let msg = e.to_string();
            let encrypted = key.contains("ENCRYPTED") || is_encrypted_openssh_key(&key);
            if encrypted && pass.is_none() {
                return Err(PylonError::Ssh("This private key is protected by a passphrase — enter it in the Key passphrase field".into()));
            }
            if encrypted {
                return Err(PylonError::Ssh(format!("Key rejected — wrong passphrase or the server does not accept this key ({msg})")));
            }
            return Err(PylonError::Ssh(format!("Server rejected the private key for {user}: {msg}")));
        }
    } else if let Some(pw) = auth.password.as_deref() {
        let password_allowed = methods.is_empty() || methods.split(',').any(|m| m == "password");
        let kbd_allowed = methods.split(',').any(|m| m == "keyboard-interactive");
        let mut last_err = None;
        if password_allowed {
            match sess.userauth_password(user, pw) {
                Ok(()) => {}
                Err(e) => last_err = Some(e.to_string()),
            }
        }
        if !sess.authenticated() && kbd_allowed {
            match sess.userauth_keyboard_interactive(user, &mut PasswordResponder(pw)) {
                Ok(()) => {}
                Err(e) => last_err = Some(e.to_string()),
            }
        }
        if !sess.authenticated() {
            if !password_allowed && !kbd_allowed {
                return Err(PylonError::Ssh(format!(
                    "Server does not accept password authentication (offers: {methods}) — use an SSH key"
                )));
            }
            return Err(PylonError::Ssh(format!(
                "Password rejected for {user}{}",
                last_err.map(|e| format!(" ({e})")).unwrap_or_default()
            )));
        }
    } else {
        sess.userauth_agent(user).map_err(|e| {
            let msg = e.to_string();
            if msg.to_lowercase().contains("sock") || msg.contains("connect") || msg.contains("agent") && msg.contains("fail") {
                PylonError::Ssh(format!("SSH agent not available or has no usable key ({msg}) — use Password or SSH Key auth"))
            } else {
                PylonError::Ssh(format!("SSH agent authentication failed: {msg}"))
            }
        })?;
    }

    if !sess.authenticated() {
        return Err(PylonError::Ssh("Authentication failed".into()));
    }
    sess.set_keepalive(true, 30);
    Ok(())
}

fn is_encrypted_openssh_key(key: &str) -> bool {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    if !key.contains("BEGIN OPENSSH PRIVATE KEY") {
        return false;
    }
    let body: String = key.lines().filter(|l| !l.starts_with("-----")).collect();
    let Ok(bytes) = B64.decode(body.trim()) else { return false };
    let magic = b"openssh-key-v1\0";
    if bytes.len() < magic.len() + 4 || &bytes[..magic.len()] != magic {
        return false;
    }
    let off = magic.len();
    let n = u32::from_be_bytes([bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]]) as usize;
    let name = bytes.get(off + 4..off + 4 + n).unwrap_or(b"none");
    name != b"none"
}

pub fn open_pinned(auth: &AuthParams) -> PylonResult<SshConn> {
    let (sess, key) = handshake(&auth.host, auth.port)?;
    if let Some(expected) = auth.expected_fingerprint.as_deref() {
        if !expected.is_empty() && expected != key.fingerprint {
            return Err(PylonError::Ssh(format!(
                "Host key for {}:{} changed mid-session (expected {expected}, got {}) — refusing to connect",
                auth.host, auth.port, key.fingerprint
            )));
        }
    }
    authenticate(&sess, auth)?;
    Ok(SshConn::new(sess))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_text_is_normalised() {
        let k = "-----BEGIN OPENSSH PRIVATE KEY-----\r\nabc\r\n-----END OPENSSH PRIVATE KEY-----";
        let r = resolve_private_key(k).unwrap();
        assert!(!r.contains('\r'));
        assert!(r.ends_with("-----\n"));
    }

    #[test]
    fn public_key_path_is_rejected() {
        let e = resolve_private_key("/tmp/id_ed25519.pub").unwrap_err().to_string();
        assert!(e.contains("public key"));
    }

    #[test]
    fn transport_loss_is_classified() {
        let lost = ssh2::Error::new(ssh2::ErrorCode::Session(-43), "Failure while draining incoming flow");
        assert!(is_transport_lost(&lost));
        assert_eq!(describe(&lost), "connection to the server was lost");
        let enoent = ssh2::Error::new(ssh2::ErrorCode::SFTP(2), "no such file");
        assert!(!is_transport_lost(&enoent));

        let io: std::io::Error = lost.into();
        assert!(io_looks_transport_lost(&io));
        let other = std::io::Error::new(std::io::ErrorKind::Other, "permission denied");
        assert!(!io_looks_transport_lost(&other));
    }
}
