use std::{
    collections::HashMap,
    io::{ErrorKind, Read, Write},
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError, SyncSender},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::{
    error::{PylonError, PylonResult},
    ssh::{self, AuthParams},
};

#[derive(Serialize, Clone)]
pub struct TerminalOutput {
    pub terminal_id: String,
    pub data: String,
}

enum TermCmd {
    Input(Vec<u8>),
    Resize(u32, u32),
    Close,
}

struct TermEntry {
    cmd_tx: SyncSender<TermCmd>,
    session_id: String,
}

#[derive(Default)]
pub struct TerminalRegistry {
    terminals: Arc<Mutex<HashMap<String, TermEntry>>>,
}

fn valid_shell(s: &str) -> bool {
    !s.is_empty() && s.len() < 128 && s.chars().all(|c| c.is_ascii_alphanumeric() || "/._-".contains(c))
}

impl TerminalRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn open(
        &self,
        app: AppHandle,
        auth: AuthParams,
        session_id: String,
        cols: u32,
        rows: u32,
        shell: Option<String>,
    ) -> PylonResult<String> {
        let conn = ssh::open_pinned(&auth).map_err(|e| PylonError::Terminal(e.to_string()))?;
        let sess = conn.sess;

        let mut ch = sess.channel_session().map_err(|e| PylonError::Terminal(format!("open channel: {e}")))?;
        let _ = ch.setenv("COLORTERM", "truecolor");
        ch.request_pty("xterm-256color", None, Some((cols.max(2), rows.max(2), 0, 0)))
            .map_err(|e| PylonError::Terminal(format!("request pty: {e}")))?;

        match shell.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            None => ch.shell().map_err(|e| PylonError::Terminal(format!("start shell: {e}")))?,
            Some(s) if valid_shell(s) => {
                let cmd = format!(
                    "if command -v {s} >/dev/null 2>&1; then exec {s} -l; else echo 'pylon: {s} not found, using login shell' >&2; exec \"${{SHELL:-/bin/sh}}\" -l; fi"
                );
                ch.exec(&cmd).map_err(|e| PylonError::Terminal(format!("start {s}: {e}")))?
            }
            Some(s) => return Err(PylonError::Terminal(format!("Invalid shell setting: {s}"))),
        }

        sess.set_blocking(false);

        let id = Uuid::new_v4().to_string();
        let (cmd_tx, cmd_rx) = mpsc::sync_channel(1024);
        let tid = id.clone();
        thread::spawn(move || pump_terminal(app, sess, ch, cmd_rx, tid));

        self.terminals.lock().unwrap().insert(id.clone(), TermEntry { cmd_tx, session_id });
        Ok(id)
    }

    fn send(&self, id: &str, cmd: TermCmd) -> PylonResult<()> {
        let lock = self.terminals.lock().unwrap();
        let entry = lock.get(id).ok_or_else(|| PylonError::Terminal("Terminal is closed".into()))?;
        entry.cmd_tx.send(cmd).map_err(|_| PylonError::Terminal("Terminal is closed".into()))
    }

    pub fn write(&self, id: &str, data: &[u8]) -> PylonResult<()> {
        self.send(id, TermCmd::Input(data.to_vec()))
    }

    pub fn resize(&self, id: &str, cols: u32, rows: u32) -> PylonResult<()> {
        self.send(id, TermCmd::Resize(cols.max(2), rows.max(2)))
    }

    pub fn close(&self, id: &str) -> PylonResult<()> {
        if let Some(entry) = self.terminals.lock().unwrap().remove(id) {
            let _ = entry.cmd_tx.send(TermCmd::Close);
        }
        Ok(())
    }

    pub fn close_for_session(&self, session_id: &str) {
        let mut map = self.terminals.lock().unwrap();
        let ids: Vec<String> = map.iter().filter(|(_, e)| e.session_id == session_id).map(|(k, _)| k.clone()).collect();
        for id in ids {
            if let Some(e) = map.remove(&id) {
                let _ = e.cmd_tx.send(TermCmd::Close);
            }
        }
    }

    fn forget(&self, id: &str) {
        self.terminals.lock().unwrap().remove(id);
    }
}

fn write_fully(ch: &mut ssh2::Channel, mut data: &[u8]) -> std::io::Result<()> {
    let deadline = Instant::now() + Duration::from_secs(30);
    while !data.is_empty() {
        match ch.write(data) {
            Ok(0) => return Err(std::io::Error::new(ErrorKind::WriteZero, "channel closed")),
            Ok(n) => data = &data[n..],
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err(e);
                }
                thread::sleep(Duration::from_millis(2));
            }
            Err(e) => return Err(e),
        }
    }
    let _ = ch.flush();
    Ok(())
}

fn pump_terminal(app: AppHandle, sess: ssh2::Session, mut ch: ssh2::Channel, cmd_rx: Receiver<TermCmd>, tid: String) {
    let mut buf = vec![0u8; 32 * 1024];
    let mut out: Vec<u8> = Vec::with_capacity(64 * 1024);
    let mut last_keepalive = Instant::now();
    let mut idle_wait = Duration::from_millis(1);
    let mut reason = "closed";

    'outer: loop {
        let first = match cmd_rx.recv_timeout(idle_wait) {
            Ok(c) => Some(c),
            Err(RecvTimeoutError::Timeout) => None,
            Err(RecvTimeoutError::Disconnected) => break,
        };
        let mut pending = first.into_iter().chain(std::iter::from_fn(|| cmd_rx.try_recv().ok()));
        for cmd in &mut pending {
            match cmd {
                TermCmd::Input(data) => {
                    if write_fully(&mut ch, &data).is_err() {
                        reason = "write failed";
                        break 'outer;
                    }
                }
                TermCmd::Resize(c, r) => {
                    let _ = ch.request_pty_size(c, r, None, None);
                }
                TermCmd::Close => {
                    let _ = ch.close();
                    return;
                }
            }
        }

        let mut got = false;
        loop {
            match ch.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    out.extend_from_slice(&buf[..n]);
                    got = true;
                    if out.len() >= 256 * 1024 {
                        break;
                    }
                }
                Err(e) if e.kind() == ErrorKind::WouldBlock => break,
                Err(_) => {
                    reason = "read failed";
                    break 'outer;
                }
            }
        }
        loop {
            match ch.stderr().read(&mut buf) {
                Ok(n) if n > 0 => {
                    out.extend_from_slice(&buf[..n]);
                    got = true;
                }
                _ => break,
            }
        }
        if !out.is_empty() {
            let _ = app.emit("terminal://output", TerminalOutput { terminal_id: tid.clone(), data: B64.encode(&out) });
            out.clear();
        }
        idle_wait = if got { Duration::from_millis(1) } else { (idle_wait * 2).min(Duration::from_millis(15)) };

        if ch.eof() {
            break;
        }
        if last_keepalive.elapsed() > Duration::from_secs(20) {
            let _ = sess.keepalive_send();
            last_keepalive = Instant::now();
        }
    }

    let exit_status = ch.exit_status().ok();
    let _ = ch.close();
    let _ = sess.disconnect(None, "terminal closed", None);
    if let Some(reg) = tauri::Manager::try_state::<TerminalRegistry>(&app) {
        reg.forget(&tid);
    }
    let _ = app.emit(
        "terminal://died",
        serde_json::json!({ "terminal_id": tid, "exit_status": exit_status, "reason": reason }),
    );
}
