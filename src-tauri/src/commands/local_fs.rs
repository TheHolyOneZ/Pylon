use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::blocking;
use crate::error::{PylonError, PylonResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: Option<u64>,
    pub modified: Option<u64>,
    pub extension: Option<String>,
    pub hidden: bool,
    #[serde(default)]
    pub permissions: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveInfo {
    pub name: String,
    pub path: String,
    pub available: bool,
}

fn display_path(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn normalise_input(path: &str) -> PathBuf {
    let t = path.trim();
    #[cfg(windows)]
    {
        let b = t.as_bytes();
        if b.len() == 2 && b[1] == b':' {
            return PathBuf::from(format!("{t}\\"));
        }
    }
    if t.is_empty() {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    }
    PathBuf::from(t)
}

#[cfg(windows)]
fn is_hidden(_name: &str, meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
    meta.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0 || _name.starts_with('.')
}
#[cfg(not(windows))]
fn is_hidden(name: &str, _meta: &std::fs::Metadata) -> bool {
    name.starts_with('.')
}

#[cfg(unix)]
fn perms(meta: &std::fs::Metadata) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    Some(meta.permissions().mode() & 0o7777)
}
#[cfg(not(unix))]
fn perms(_meta: &std::fs::Metadata) -> Option<u32> {
    None
}

fn list_dir(path: &Path) -> PylonResult<Vec<LocalEntry>> {
    let rd = std::fs::read_dir(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => PylonError::NotFound(format!("{} does not exist", path.display())),
        std::io::ErrorKind::PermissionDenied => PylonError::PermissionDenied(format!("Cannot open {}", path.display())),
        _ => PylonError::Io(format!("{}: {e}", path.display())),
    })?;
    let mut entries = Vec::new();
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let full = entry.path();
        let lmeta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_symlink = lmeta.file_type().is_symlink();
        let meta = if is_symlink { std::fs::metadata(&full).unwrap_or(lmeta.clone()) } else { lmeta.clone() };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());
        entries.push(LocalEntry {
            hidden: is_hidden(&name, &lmeta),
            extension: if meta.is_dir() { None } else { full.extension().map(|e| e.to_string_lossy().into_owned()) },
            name,
            path: display_path(&full),
            is_dir: meta.is_dir(),
            is_symlink,
            size: if meta.is_file() { Some(meta.len()) } else { None },
            modified,
            permissions: perms(&meta),
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

#[tauri::command]
pub async fn list_local_dir(path: String) -> Result<Vec<LocalEntry>, PylonError> {
    blocking(move || list_dir(&normalise_input(&path))).await
}

#[tauri::command]
pub async fn get_local_drives() -> Result<Vec<DriveInfo>, PylonError> {
    #[cfg(target_os = "windows")]
    {
        Ok(('A'..='Z')
            .filter_map(|c| {
                let path = format!("{c}:\\");
                Path::new(&path).exists().then(|| DriveInfo { name: format!("{c}:"), path, available: true })
            })
            .collect())
    }
    #[cfg(target_os = "macos")]
    {
        let mut v = vec![DriveInfo { name: "Macintosh HD".into(), path: "/".into(), available: true }];
        if let Ok(rd) = std::fs::read_dir("/Volumes") {
            for e in rd.flatten() {
                let p = e.path();
                if std::fs::read_link(&p).map(|t| t == Path::new("/")).unwrap_or(false) {
                    continue;
                }
                v.push(DriveInfo { name: e.file_name().to_string_lossy().into_owned(), path: display_path(&p), available: true });
            }
        }
        Ok(v)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let mut v = vec![DriveInfo { name: "/".into(), path: "/".into(), available: true }];
        let user = std::env::var("USER").unwrap_or_default();
        for base in ["/media", "/run/media", "/mnt"] {
            let dir = if base == "/mnt" { PathBuf::from(base) } else { Path::new(base).join(&user) };
            if let Ok(rd) = std::fs::read_dir(&dir) {
                for e in rd.flatten() {
                    if e.path().is_dir() {
                        v.push(DriveInfo { name: e.file_name().to_string_lossy().into_owned(), path: display_path(&e.path()), available: true });
                    }
                }
            }
        }
        Ok(v)
    }
}

fn spawn_detached(cmd: &mut std::process::Command) -> PylonResult<()> {
    cmd.spawn().map(|_| ()).map_err(|e| PylonError::Other(format!("Could not launch file manager: {e}")))
}

#[tauri::command]
pub async fn open_in_file_manager(path: String) -> Result<(), PylonError> {
    blocking(move || {
        let p = normalise_input(&path);
        if !p.exists() {
            return Err(PylonError::NotFound(format!("{} does not exist", p.display())));
        }
        #[cfg(target_os = "linux")]
        return spawn_detached(std::process::Command::new("xdg-open").arg(&p));
        #[cfg(target_os = "macos")]
        return spawn_detached(std::process::Command::new("open").arg(&p));
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            return spawn_detached(
                std::process::Command::new("cmd")
                    .args(["/C", "start", ""])
                    .arg(&p)
                    .creation_flags(0x0800_0000),
            );
        }
        #[allow(unreachable_code)]
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn reveal_in_file_manager(path: String) -> Result<(), PylonError> {
    blocking(move || {
        let p = normalise_input(&path);
        #[cfg(target_os = "macos")]
        return spawn_detached(std::process::Command::new("open").arg("-R").arg(&p));
        #[cfg(target_os = "windows")]
        {
            let mut arg = std::ffi::OsString::from("/select,");
            arg.push(p.as_os_str());
            return spawn_detached(std::process::Command::new("explorer").arg(arg));
        }
        #[cfg(target_os = "linux")]
        {
            let uri = format!("file://{}", p.display());
            let ok = std::process::Command::new("dbus-send")
                .args([
                    "--session",
                    "--dest=org.freedesktop.FileManager1",
                    "--type=method_call",
                    "/org/freedesktop/FileManager1",
                    "org.freedesktop.FileManager1.ShowItems",
                ])
                .arg(format!("array:string:{uri}"))
                .arg("string:")
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if ok {
                return Ok(());
            }
            let parent = if p.is_dir() { p.clone() } else { p.parent().map(Path::to_path_buf).unwrap_or(p.clone()) };
            return spawn_detached(std::process::Command::new("xdg-open").arg(parent));
        }
        #[allow(unreachable_code)]
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn get_home_dir() -> Result<String, PylonError> {
    Ok(dirs::home_dir()
        .filter(|h| h.exists())
        .map(|h| display_path(&h))
        .unwrap_or_else(|| if cfg!(windows) { "C:\\".into() } else { "/".into() }))
}

#[tauri::command]
pub async fn path_join(parent: String, child: String) -> Result<String, PylonError> {
    Ok(display_path(&normalise_input(&parent).join(child)))
}

#[tauri::command]
pub async fn local_path_exists(path: String) -> Result<bool, PylonError> {
    Ok(std::fs::symlink_metadata(normalise_input(&path)).is_ok())
}

#[tauri::command]
pub async fn local_paths_exist(paths: Vec<String>) -> Result<Vec<bool>, PylonError> {
    Ok(paths.iter().map(|p| std::fs::symlink_metadata(normalise_input(p)).is_ok()).collect())
}

#[tauri::command]
pub async fn local_is_dir(paths: Vec<String>) -> Result<Vec<bool>, PylonError> {
    Ok(paths.iter().map(|p| normalise_input(p).is_dir()).collect())
}

fn delete_path(p: &Path) -> PylonResult<()> {
    let meta = std::fs::symlink_metadata(p).map_err(|e| PylonError::Io(format!("{}: {e}", p.display())))?;
    let ft = meta.file_type();
    let res = if ft.is_symlink() {
        std::fs::remove_file(p).or_else(|_| std::fs::remove_dir(p))
    } else if ft.is_dir() {
        std::fs::remove_dir_all(p)
    } else {
        std::fs::remove_file(p)
    };
    res.map_err(|e| PylonError::Io(format!("delete {}: {e}", p.display())))
}

#[tauri::command]
pub async fn delete_local_path(path: String) -> Result<(), PylonError> {
    blocking(move || delete_path(&normalise_input(&path))).await
}

#[tauri::command]
pub async fn delete_local_batch(paths: Vec<String>) -> Result<(), PylonError> {
    blocking(move || {
        let errors: Vec<String> = paths
            .iter()
            .filter_map(|p| delete_path(&normalise_input(p)).err().map(|e| e.to_string()))
            .collect();
        if errors.is_empty() {
            Ok(())
        } else {
            Err(PylonError::Io(format!("{} item(s) could not be deleted: {}", errors.len(), errors.join("; "))))
        }
    })
    .await
}

fn check_name(name: &str) -> PylonResult<()> {
    let bad = name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || (cfg!(windows) && name.chars().any(|c| "<>:\"\\|?*".contains(c)));
    if bad {
        return Err(PylonError::Other(format!("\"{name}\" is not a valid name")));
    }
    Ok(())
}

#[tauri::command]
pub async fn create_local_dir(parent: String, name: String) -> Result<String, PylonError> {
    blocking(move || {
        check_name(name.trim())?;
        let p = normalise_input(&parent).join(name.trim());
        if p.exists() {
            return Err(PylonError::AlreadyExists(format!("{} already exists", p.display())));
        }
        std::fs::create_dir(&p).map_err(|e| PylonError::Io(format!("create {}: {e}", p.display())))?;
        Ok(display_path(&p))
    })
    .await
}

#[tauri::command]
pub async fn rename_local(path: String, new_name: String) -> Result<String, PylonError> {
    blocking(move || {
        check_name(new_name.trim())?;
        let from = normalise_input(&path);
        let to = from.parent().ok_or_else(|| PylonError::Other("Cannot rename a root".into()))?.join(new_name.trim());
        if to == from {
            return Ok(display_path(&to));
        }
        let case_only = to.to_string_lossy().to_lowercase() == from.to_string_lossy().to_lowercase();
        if to.exists() && !case_only {
            return Err(PylonError::AlreadyExists(format!("{} already exists", to.display())));
        }
        std::fs::rename(&from, &to).map_err(|e| PylonError::Io(format!("rename: {e}")))?;
        Ok(display_path(&to))
    })
    .await
}

#[tauri::command]
pub async fn move_local(paths: Vec<String>, target_dir: String) -> Result<(), PylonError> {
    blocking(move || {
        let dir = normalise_input(&target_dir);
        if !dir.is_dir() {
            return Err(PylonError::NotFound(format!("{} is not a folder", dir.display())));
        }
        let mut errors = Vec::new();
        for p in &paths {
            let from = normalise_input(p);
            let Some(name) = from.file_name() else { continue };
            let to = dir.join(name);
            if to == from || dir.starts_with(&from) {
                errors.push(format!("can't move {} into itself", from.display()));
                continue;
            }
            if to.exists() {
                errors.push(format!("{} already exists", to.display()));
                continue;
            }
            if let Err(e) = std::fs::rename(&from, &to) {
                errors.push(format!("{}: {e}", from.display()));
            }
        }
        if errors.is_empty() { Ok(()) } else { Err(PylonError::Io(errors.join("; "))) }
    })
    .await
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, PylonError> {
    blocking(move || {
        let p = normalise_input(&path);
        let len = std::fs::metadata(&p)?.len();
        if len > 64 * 1024 {
            return Err(PylonError::Other("File is too large".into()));
        }
        Ok(std::fs::read_to_string(&p)?)
    })
    .await
}

#[tauri::command]
pub async fn get_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        "unknown"
    }
}
