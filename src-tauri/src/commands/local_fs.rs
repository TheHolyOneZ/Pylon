use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::PylonError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified: Option<u64>,
    pub extension: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveInfo {
    pub name: String,
    pub path: String,
    pub available: bool,
}

#[tauri::command]
pub async fn list_local_dir(path: String) -> Result<Vec<LocalEntry>, PylonError> {
    let mut entries = Vec::new();

    for entry in std::fs::read_dir(&path)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let full_path = entry.path().to_string_lossy().into_owned();
        let ext = entry
            .path()
            .extension()
            .map(|e| e.to_string_lossy().into_owned());

        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());

        entries.push(LocalEntry {
            name,
            path: full_path,
            is_dir: meta.is_dir(),
            size: if meta.is_file() { Some(meta.len()) } else { None },
            modified,
            extension: ext,
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
pub async fn get_local_drives() -> Result<Vec<DriveInfo>, PylonError> {
    #[cfg(target_os = "windows")]
    {
        let drives: Vec<DriveInfo> = ('A'..='Z')
            .filter_map(|c| {
                let path = format!("{c}:\\");
                if Path::new(&path).exists() {
                    Some(DriveInfo {
                        name: path.clone(),
                        path,
                        available: true,
                    })
                } else {
                    None
                }
            })
            .collect();
        Ok(drives)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![DriveInfo {
            name: "/".to_string(),
            path: "/".to_string(),
            available: true,
        }])
    }
}

#[tauri::command]
pub async fn open_in_file_manager(path: String) -> Result<(), PylonError> {
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| PylonError::Other(e.to_string()))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| PylonError::Other(e.to_string()))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| PylonError::Other(e.to_string()))?;
    }
    Ok(())
}


#[tauri::command]
pub async fn get_home_dir() -> Result<String, PylonError> {
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        if Path::new(&home).exists() {
            return Ok(home);
        }
    }
    #[cfg(target_os = "windows")]
    {

        return Ok("C:\\".to_string());
    }
    #[cfg(not(target_os = "windows"))]
    {
        return Ok("/".to_string());
    }
}


#[tauri::command]
pub async fn path_join(parent: String, child: String) -> Result<String, PylonError> {
    let p = std::path::PathBuf::from(&parent).join(&child);
    Ok(p.to_string_lossy().into_owned())
}


#[tauri::command]
pub async fn local_path_exists(path: String) -> Result<bool, PylonError> {
    Ok(std::path::Path::new(&path).exists())
}

#[tauri::command]
pub async fn delete_local_path(path: String) -> Result<(), PylonError> {
    let meta = std::fs::metadata(&path)?;
    if meta.is_dir() {
        std::fs::remove_dir_all(&path)?;
    } else {
        std::fs::remove_file(&path)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_local_batch(paths: Vec<String>) -> Result<(), PylonError> {
    for path in paths {
        let meta = std::fs::metadata(&path)?;
        if meta.is_dir() {
            std::fs::remove_dir_all(&path)?;
        } else {
            std::fs::remove_file(&path)?;
        }
    }
    Ok(())
}


#[tauri::command]
pub async fn get_platform() -> &'static str {
    #[cfg(target_os = "windows")]  { "windows" }
    #[cfg(target_os = "macos")]    { "macos" }
    #[cfg(target_os = "linux")]    { "linux" }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    { "unknown" }
}
