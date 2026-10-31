use std::{
    io::{Read, Write},
    path::Path,
};

use serde::{Deserialize, Serialize};
use ssh2::{FileStat, Sftp};

use crate::{
    error::{PylonError, PylonResult},
    ssh::{is_not_found, sftp_error, SshConn},
};

pub const CHUNK_SIZE: usize = 256 * 1024;

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

pub fn join(parent: &str, name: &str) -> String {
    if parent.is_empty() || parent == "/" {
        format!("/{}", name.trim_start_matches('/'))
    } else {
        format!("{}/{}", parent.trim_end_matches('/'), name.trim_start_matches('/'))
    }
}

pub fn parent(path: &str) -> Option<String> {
    let p = path.trim_end_matches('/');
    let idx = p.rfind('/')?;
    Some(if idx == 0 { "/".to_string() } else { p[..idx].to_string() })
}

fn entry_from(sftp: &Sftp, full_path: String, name: String, stat: &FileStat) -> RemoteEntry {
    let is_symlink = stat.file_type().is_symlink();
    let (mut is_dir, mut size) = (stat.is_dir(), stat.size);
    let mut symlink_target = None;
    if is_symlink {
        symlink_target = sftp.readlink(Path::new(&full_path)).ok().map(|p| p.to_string_lossy().into_owned());
        if let Ok(target) = sftp.stat(Path::new(&full_path)) {
            is_dir = target.is_dir();
            if !is_dir {
                size = target.size;
            }
        }
    }
    RemoteEntry {
        name,
        path: full_path,
        is_dir,
        is_symlink,
        size: if is_dir { None } else { size },
        modified: stat.mtime,
        permissions: stat.perm,
        owner: stat.uid,
        group: stat.gid,
        symlink_target,
    }
}

pub fn list_dir(conn: &SshConn, path: &str) -> PylonResult<Vec<RemoteEntry>> {
    let entries = conn.sftp_op(|| format!("list {path}"), |sftp| sftp.readdir(Path::new(path)))?;
    let sftp = conn.sftp()?;
    let mut result = Vec::with_capacity(entries.len());
    for (pb, stat) in entries {
        let name = pb.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        result.push(entry_from(&sftp, join(path, &name), name, &stat));
    }
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(result)
}

pub fn stat(conn: &SshConn, path: &str) -> PylonResult<RemoteEntry> {
    let st = conn.sftp_op(|| format!("stat {path}"), |sftp| sftp.lstat(Path::new(path)))?;
    let name = path.trim_end_matches('/').rsplit('/').next().unwrap_or(path).to_string();
    let sftp = conn.sftp()?;
    Ok(entry_from(&sftp, path.to_string(), name, &st))
}

pub fn exists(conn: &SshConn, path: &str) -> PylonResult<bool> {
    let sftp = conn.sftp()?;
    match sftp.lstat(Path::new(path)) {
        Ok(_) => Ok(true),
        Err(e) if is_not_found(&e) => Ok(false),
        Err(e) => Err(sftp_error(&format!("stat {path}"), &e)),
    }
}

pub fn rename(conn: &SshConn, from: &str, to: &str) -> PylonResult<()> {
    if from == to {
        return Ok(());
    }
    if exists(conn, to)? {
        return Err(PylonError::AlreadyExists(format!("{to} already exists")));
    }
    conn.sftp_op(|| format!("rename {from} → {to}"), |sftp| sftp.rename(Path::new(from), Path::new(to), None))
}

pub fn delete_file(conn: &SshConn, path: &str) -> PylonResult<()> {
    conn.sftp_op(|| format!("delete {path}"), |sftp| sftp.unlink(Path::new(path)))
}

pub fn delete_dir(conn: &SshConn, path: &str) -> PylonResult<()> {
    conn.sftp_op(|| format!("remove directory {path}"), |sftp| sftp.rmdir(Path::new(path)))
}

pub fn recursive_delete(conn: &SshConn, path: &str) -> PylonResult<()> {
    let sftp = conn.sftp()?;
    recursive_delete_with(&sftp, path)
}

pub fn recursive_delete_with(sftp: &Sftp, path: &str) -> PylonResult<()> {
    let st = sftp.lstat(Path::new(path)).map_err(|e| sftp_error(&format!("stat {path}"), &e))?;
    if !st.is_dir() || st.file_type().is_symlink() {
        return sftp.unlink(Path::new(path)).map_err(|e| sftp_error(&format!("delete {path}"), &e));
    }
    let entries = sftp.readdir(Path::new(path)).map_err(|e| sftp_error(&format!("list {path}"), &e))?;
    for (pb, stat) in entries {
        let name = pb.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        let child = join(path, &name);
        if stat.is_dir() && !stat.file_type().is_symlink() {
            recursive_delete_with(sftp, &child)?;
        } else {
            sftp.unlink(Path::new(&child)).map_err(|e| sftp_error(&format!("delete {child}"), &e))?;
        }
    }
    sftp.rmdir(Path::new(path)).map_err(|e| sftp_error(&format!("remove directory {path}"), &e))
}

pub fn mkdir(conn: &SshConn, path: &str, mode: i32) -> PylonResult<()> {
    if exists(conn, path)? {
        return Err(PylonError::AlreadyExists(format!("{path} already exists")));
    }
    conn.sftp_op(|| format!("create folder {path}"), |sftp| sftp.mkdir(Path::new(path), mode))
}

pub fn mkdir_p_with(sftp: &Sftp, path: &str) -> PylonResult<()> {
    let mut current = String::new();
    for part in path.split('/').filter(|p| !p.is_empty()) {
        current.push('/');
        current.push_str(part);
        match sftp.stat(Path::new(&current)) {
            Ok(s) if s.is_dir() => {}
            Ok(_) => {
                return Err(PylonError::Sftp(format!("{current} exists and is not a directory")));
            }
            Err(e) if is_not_found(&e) => {
                if let Err(e) = sftp.mkdir(Path::new(&current), 0o755) {
                    if !sftp.stat(Path::new(&current)).map(|s| s.is_dir()).unwrap_or(false) {
                        return Err(sftp_error(&format!("create folder {current}"), &e));
                    }
                }
            }
            Err(e) => return Err(sftp_error(&format!("stat {current}"), &e)),
        }
    }
    Ok(())
}

pub fn mkdir_p(conn: &SshConn, path: &str) -> PylonResult<()> {
    let sftp = conn.sftp()?;
    mkdir_p_with(&sftp, path)
}

pub fn read_file(conn: &SshConn, path: &str, max_bytes: u64) -> PylonResult<Vec<u8>> {
    let mut file = conn.sftp_op(|| format!("open {path}"), |sftp| sftp.open(Path::new(path)))?;
    let mut buf = Vec::new();
    let mut chunk = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() as u64 > max_bytes {
            return Err(PylonError::Sftp(format!("{path} is larger than {} KB", max_bytes / 1024)));
        }
    }
    Ok(buf)
}

pub fn write_file(conn: &SshConn, path: &str, data: &[u8]) -> PylonResult<()> {
    let mut file = conn.sftp_op(|| format!("create {path}"), |sftp| sftp.create(Path::new(path)))?;
    for chunk in data.chunks(CHUNK_SIZE) {
        file.write_all(chunk)?;
    }
    Ok(())
}

fn setstat(conn: &SshConn, path: &str, stat: FileStat, what: &str) -> PylonResult<()> {
    conn.sftp_op(|| format!("{what} {path}"), |sftp| sftp.setstat(Path::new(path), stat.clone()))
}

pub fn chmod(conn: &SshConn, path: &str, mode: u32) -> PylonResult<()> {
    let stat = FileStat { size: None, uid: None, gid: None, perm: Some(mode & 0o7777), atime: None, mtime: None };
    setstat(conn, path, stat, "chmod")
}

pub fn chown(conn: &SshConn, path: &str, uid: u32, gid: u32) -> PylonResult<()> {
    let stat = FileStat { size: None, uid: Some(uid), gid: Some(gid), perm: None, atime: None, mtime: None };
    setstat(conn, path, stat, "chown")
}

pub fn create_symlink(conn: &SshConn, target: &str, linkname: &str) -> PylonResult<()> {
    conn.sftp_op(|| format!("symlink {linkname}"), |sftp| sftp.symlink(Path::new(target), Path::new(linkname)))
}

pub fn readlink(conn: &SshConn, path: &str) -> PylonResult<String> {
    conn.sftp_op(|| format!("readlink {path}"), |sftp| sftp.readlink(Path::new(path)))
        .map(|p| p.to_string_lossy().into_owned())
}

pub fn realpath(conn: &SshConn, path: &str) -> PylonResult<String> {
    conn.sftp_op(|| format!("resolve {path}"), |sftp| sftp.realpath(Path::new(path)))
        .map(|p| p.to_string_lossy().into_owned())
}

pub fn recursive_list(conn: &SshConn, path: &str) -> PylonResult<Vec<RemoteEntry>> {
    let mut result = Vec::new();
    let mut stack = vec![path.to_string()];
    while let Some(dir) = stack.pop() {
        for entry in list_dir(conn, &dir)? {
            if entry.is_dir && !entry.is_symlink {
                stack.push(entry.path.clone());
            }
            result.push(entry);
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_and_parent() {
        assert_eq!(join("/", "etc"), "/etc");
        assert_eq!(join("/var/", "log"), "/var/log");
        assert_eq!(parent("/var/log"), Some("/var".into()));
        assert_eq!(parent("/var"), Some("/".into()));
    }
}
