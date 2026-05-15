

use std::{
    collections::HashMap,
    io::{Read, Write},
    net::TcpStream,
    sync::{
        mpsc::{self, Receiver, SyncSender},
        Arc, Mutex,
    },
    thread,
};

use serde::Serialize;
use ssh2::Session;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::{
    error::{PylonError, PylonResult},
    session::TermAuthParams,
};

#[derive(Serialize, Clone)]
pub struct TerminalOutput {
    pub terminal_id: String,
    pub data: Vec<u8>,
}

enum TermCmd {
    Input(Vec<u8>),
    Resize(u32, u32),
    Close,
}

struct TermEntry {
    cmd_tx: SyncSender<TermCmd>,
    _session_id: String,
}

pub struct TerminalRegistry {
    terminals: Arc<Mutex<HashMap<String, TermEntry>>>,
}

impl TerminalRegistry {
    pub fn new() -> Self {
        Self {
            terminals: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn open(
        &self,
        app: AppHandle,
        auth: TermAuthParams,
        session_id: String,
        cols: u32,
        rows: u32,
        shell: Option<String>,
    ) -> PylonResult<String> {

        let addr = format!("{}:{}", auth.host, auth.port);
        let tcp = TcpStream::connect(&addr)
            .map_err(|e| PylonError::Terminal(format!("TCP: {e}")))?;

        let mut sess = Session::new().map_err(|e| PylonError::Terminal(e.to_string()))?;
        sess.set_blocking(true);
        sess.set_timeout(30_000);
        sess.set_tcp_stream(tcp);
        sess.handshake().map_err(|e| PylonError::Terminal(format!("Handshake: {e}")))?;

        if let Some(ref key_pem) = auth.private_key {
            let tmp = tempfile_from_pem(key_pem)?;
            sess.userauth_pubkey_file(&auth.username, None, tmp.as_path(), None)
                .map_err(|e| PylonError::Terminal(format!("PubKey auth: {e}")))?;
            let _ = std::fs::remove_file(&tmp);
        } else if let Some(ref pw) = auth.password {
            sess.userauth_password(&auth.username, pw)
                .map_err(|e| PylonError::Terminal(format!("Password auth: {e}")))?;
        } else {
            sess.userauth_agent(&auth.username)
                .map_err(|e| PylonError::Terminal(format!("Agent auth: {e}")))?;
        }

        if !sess.authenticated() {
            return Err(PylonError::Terminal("Authentication failed".into()));
        }

        let mut ch = sess.channel_session()
            .map_err(|e| PylonError::Terminal(format!("channel_session: {e}")))?;
        ch.request_pty("xterm-256color", None, Some((cols, rows, 0, 0)))
            .map_err(|e| PylonError::Terminal(format!("pty: {e}")))?;
        if let Some(ref shell_path) = shell {
            ch.exec(shell_path)
                .map_err(|e| PylonError::Terminal(format!("exec shell: {e}")))?;
        } else {
            ch.shell()
                .map_err(|e| PylonError::Terminal(format!("shell: {e}")))?;
        }

        sess.set_blocking(false);

        let id = Uuid::new_v4().to_string();
        let (cmd_tx, cmd_rx): (SyncSender<TermCmd>, Receiver<TermCmd>) = mpsc::sync_channel(256);
        let tid = id.clone();

        thread::spawn(move || {
            pump_terminal(app, sess, ch, cmd_rx, tid);
        });

        self.terminals.lock().unwrap().insert(
            id.clone(),
            TermEntry { cmd_tx, _session_id: session_id },
        );
        Ok(id)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> PylonResult<()> {
        let lock = self.terminals.lock().unwrap();
        match lock.get(id) {
            None => Err(PylonError::Terminal(format!("Terminal {id} not found"))),
            Some(entry) => entry
                .cmd_tx
                .send(TermCmd::Input(data.to_vec()))
                .map_err(|_| PylonError::Terminal("Terminal closed".into())),
        }
    }

    pub fn resize(&self, id: &str, cols: u32, rows: u32) -> PylonResult<()> {
        let lock = self.terminals.lock().unwrap();
        match lock.get(id) {
            None => Err(PylonError::Terminal(format!("Terminal {id} not found"))),
            Some(entry) => entry
                .cmd_tx
                .send(TermCmd::Resize(cols, rows))
                .map_err(|_| PylonError::Terminal("Terminal closed".into())),
        }
    }

    pub fn close(&self, id: &str) -> PylonResult<()> {
        if let Some(entry) = self.terminals.lock().unwrap().remove(id) {
            let _ = entry.cmd_tx.send(TermCmd::Close);
        }
        Ok(())
    }
}

fn pump_terminal(
    app: AppHandle,
    _sess: Session,
    mut ch: ssh2::Channel,
    cmd_rx: Receiver<TermCmd>,
    tid: String,
) {
    let mut buf = vec![0u8; 4096];
    loop {

        loop {
            match cmd_rx.try_recv() {
                Ok(TermCmd::Input(data)) => { let _ = ch.write_all(&data); }
                Ok(TermCmd::Resize(c, r)) => { let _ = ch.request_pty_size(c, r, None, None); }
                Ok(TermCmd::Close) | Err(mpsc::TryRecvError::Disconnected) => {
                    let _ = ch.close();
                    return;
                }
                Err(mpsc::TryRecvError::Empty) => break,
            }
        }

        match ch.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let _ = app.emit(
                    "terminal://output",
                    TerminalOutput { terminal_id: tid.clone(), data: buf[..n].to_vec() },
                );
            }
            Err(e) => {

                let kind = e.kind();
                if kind == std::io::ErrorKind::WouldBlock || kind == std::io::ErrorKind::TimedOut {
                    continue;
                }
                break;
            }
        }
    }
    let _ = ch.close();
    let _ = app.emit("terminal://died", serde_json::json!({ "terminal_id": tid }));
}

fn tempfile_from_pem(pem: &str) -> PylonResult<std::path::PathBuf> {
    let path = std::env::temp_dir().join(format!("pylon_term_{}.pem", Uuid::new_v4()));
    std::fs::write(&path, pem)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(path)
}
