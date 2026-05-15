

use std::{
    io::{Read, Write},
    path::Path,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use ssh2::{FileStat, Session};

use crate::error::{PylonError, PylonResult};

pub const CHUNK_SIZE: usize = 512 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: Option<u64>,
    pub modified: Option<u64>,
    pub permissions: Option<u32>,
    pub owner: Option<u32>,
    pub group: Option<u32>,

    pub symlink_target: Option<String>,
}

pub fn list_dir(session: &Arc<Mutex<Session>>, path: &str) -> PylonResult<Vec<RemoteEntry>> {
    let sess = session.lock().unwrap();
    let sftp = sess.sftp().map_err(|e| PylonError::Sftp(e.to_string()))?;
    let entries = sftp
        .readdir(Path::new(path))
        .map_err(|e| PylonError::Sftp(format!("readdir {path}: {e}")))?;

    let mut result = Vec::with_capacity(entries.len());
    for (pb, stat) in entries {
        let name = pb.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let full_path = pb.to_string_lossy().into_owned();
        let is_symlink = stat.file_type().is_symlink();

        let symlink_target = if is_symlink {
            sftp.readlink(Path::new(&full_path))
                .ok()
                .map(|p| p.to_string_lossy().into_owned())
        } else {
            None
        };

        result.push(RemoteEntry {
            name,
            path: full_path,
            is_dir: stat.is_dir(),
            is_symlink,
            size: stat.size,
            modified: stat.mtime,
            permissions: stat.perm,
            owner: stat.uid,
            group: stat.gid,
            symlink_target,
        });
    }

    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(result)
}

pub fn stat(session: &Arc<Mutex<Session>>, path: &str) -> PylonResult<RemoteEntry> {
    let sess = session.lock().unwrap();
    let sftp = sess.sftp().map_err(|e| PylonError::Sftp(e.to_string()))?;
    let stat = sftp.stat(Path::new(path)).map_err(|e| PylonError::Sftp(format!("stat {path}: {e}")))?;
    let name = Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let is_symlink = stat.file_type().is_symlink();
    let symlink_target = if is_symlink {
        sftp.readlink(Path::new(path)).ok().map(|p| p.to_string_lossy().into_owned())
    } else {
        None
    };
    Ok(RemoteEntry {
        name,
        path: path.to_string(),
        is_dir: stat.is_dir(),
        is_symlink,
        size: stat.size,
        modified: stat.mtime,
        permissions: stat.perm,
        owner: stat.uid,
        group: stat.gid,
        symlink_target,
    })
}

pub fn rename(session: &Arc<Mutex<Session>>, from: &str, to: &str) -> PylonResult<()> {
    let sess = session.lock().unwrap();
    let sftp = sess.sftp().map_err(|e| PylonError::Sftp(e.to_string()))?;
    sftp.rename(
        Path::new(from),
        Path::new(to),
        Some(ssh2::RenameFlags::OVERWRITE | ssh2::RenameFlags::ATOMIC),
    )
    .map_err(|e| PylonError::Sftp(format!("rename {from} -> {to}: {e}")))
}

pub fn delete_file(session: &Arc<Mutex<Session>>, path: &str) -> PylonResult<()> {
    let sess = session.lock().unwrap();
    let sftp = sess.sftp().map_err(|e| PylonError::Sftp(e.to_string()))?;
    sftp.unlink(Path::new(path)).map_err(|e| PylonError::Sftp(format!("unlink {path}: {e}")))
}

pub fn delete_dir(session: &Arc<Mutex<Session>>, path: &str) -> PylonResult<()> {
    let sess = session.lock().unwrap();
    let sftp = sess.sftp().map_err(|e| PylonError::Sftp(e.to_string()))?;
    sftp.rmdir(Path::new(path)).map_err(|e| PylonError::Sftp(format!("rmdir {path}: {e}")))
}

pub fn recursive_delete(session: &Arc<Mutex<Session>>, path: &str) -> PylonResult<()> {
    let entries = list_dir(session, path)?;
    for entry in entries {
        if entry.is_dir && !entry.is_symlink {
            recursive_delete(session, &entry.path)?;
        } else {
            delete_file(session, &entry.path)?;
        }
    }
    delete_dir(session, path)
}

pub fn mkdir(session: &Arc<Mutex<Session>>, path: &str, mode: i32) -> PylonResult<()> {
    let sess = session.lock().unwrap();
    let sftp = sess.sftp().map_err(|e| PylonError::Sftp(e.to_string()))?;
    sftp.mkdir(Path::new(path), mode).map_err(|e| PylonError::Sftp(format!("mkdir {path}: {e}")))
}

pub fn mkdir_p(session: &Arc<Mutex<Session>>, path: &str) -> PylonResult<()> {
    let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    let mut current = String::new();
    for part in &parts {
        if part.is_empty() { continue; }
        current = format!("{current}/{part}");
        let sess = session.lock().unwrap();
        if let Ok(sftp) = sess.sftp() {
            if sftp.stat(Path::new(&current)).is_err() {
                let _ = sftp.mkdir(Path::new(&current), 0o755);
            }
        }
    }
    Ok(())
}

pub fn read_file(session: &Arc<Mutex<Session>>, path: &str) -> PylonResult<Vec<u8>> {
    let sess = session.lock().unwrap();
    let sftp = sess.sftp().map_err(|e| PylonError::Sftp(e.to_string()))?;
    let mut file = sftp.open(Path::new(path)).map_err(|e| PylonError::Sftp(format!("open {path}: {e}")))?;
    let mut buf = Vec::new();
    let mut chunk = vec![0u8; CHUNK_SIZE];
    loop {
        let n = file.read(&mut chunk)?;
        if n == 0 { break; }
        buf.extend_from_slice(&chunk[..n]);
    }
    Ok(buf)
}

pub fn write_file(session: &Arc<Mutex<Session>>, path: &str, data: &[u8]) -> PylonResult<()> {
    let sess = session.lock().unwrap();
    let sftp = sess.sftp().map_err(|e| PylonError::Sftp(e.to_string()))?;
    let mut file = sftp.create(Path::new(path)).map_err(|e| PylonError::Sftp(format!("create {path}: {e}")))?;
    for chunk in data.chunks(CHUNK_SIZE) {
        file.write_all(chunk)?;
    }
    Ok(())
}

pub fn chmod(session: &Arc<Mutex<Session>>, path: &str, mode: u32) -> PylonResult<()> {
    let sess = session.lock().unwrap();
    let sftp = sess.sftp().map_err(|e| PylonError::Sftp(e.to_string()))?;
    let stat = FileStat {
        size: None,
        uid: None,
        gid: None,
        perm: Some(mode),
        atime: None,
        mtime: None,
    };
    sftp.setstat(Path::new(path), stat)
        .map_err(|e| PylonError::Sftp(format!("chmod {path} {:o}: {e}", mode)))
}

pub fn chown(session: &Arc<Mutex<Session>>, path: &str, uid: u32, gid: u32) -> PylonResult<()> {
    let sess = session.lock().unwrap();
    let sftp = sess.sftp().map_err(|e| PylonError::Sftp(e.to_string()))?;
    let stat = FileStat {
        size: None,
        uid: Some(uid),
        gid: Some(gid),
        perm: None,
        atime: None,
        mtime: None,
    };
    sftp.setstat(Path::new(path), stat)
        .map_err(|e| PylonError::Sftp(format!("chown {path} {uid}:{gid}: {e}")))
}

pub fn set_times(session: &Arc<Mutex<Session>>, path: &str, atime: u64, mtime: u64) -> PylonResult<()> {
    let sess = session.lock().unwrap();
    let sftp = sess.sftp().map_err(|e| PylonError::Sftp(e.to_string()))?;
    let stat = FileStat {
        size: None,
        uid: None,
        gid: None,
        perm: None,
        atime: Some(atime),
        mtime: Some(mtime),
    };
    sftp.setstat(Path::new(path), stat)
        .map_err(|e| PylonError::Sftp(format!("utimes {path}: {e}")))
}

pub fn create_symlink(session: &Arc<Mutex<Session>>, target: &str, linkname: &str) -> PylonResult<()> {
    let sess = session.lock().unwrap();
    let sftp = sess.sftp().map_err(|e| PylonError::Sftp(e.to_string()))?;
    sftp.symlink(Path::new(target), Path::new(linkname))
        .map_err(|e| PylonError::Sftp(format!("symlink {target} -> {linkname}: {e}")))
}

pub fn readlink(session: &Arc<Mutex<Session>>, path: &str) -> PylonResult<String> {
    let sess = session.lock().unwrap();
    let sftp = sess.sftp().map_err(|e| PylonError::Sftp(e.to_string()))?;
    sftp.readlink(Path::new(path))
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| PylonError::Sftp(format!("readlink {path}: {e}")))
}

pub fn realpath(session: &Arc<Mutex<Session>>, path: &str) -> PylonResult<String> {
    let sess = session.lock().unwrap();
    let sftp = sess.sftp().map_err(|e| PylonError::Sftp(e.to_string()))?;
    sftp.realpath(Path::new(path))
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| PylonError::Sftp(format!("realpath {path}: {e}")))
}

pub fn recursive_list(session: &Arc<Mutex<Session>>, path: &str) -> PylonResult<Vec<RemoteEntry>> {
    let mut result = Vec::new();
    let entries = list_dir(session, path)?;
    for entry in entries {
        if entry.is_dir && !entry.is_symlink {
            let sub = recursive_list(session, &entry.path)?;
            result.push(entry);
            result.extend(sub);
        } else {
            result.push(entry);
        }
    }
    Ok(result)
}
