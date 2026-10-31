use std::path::Path;

use super::blocking;
use crate::{
    error::{PylonError, PylonResult},
    metadata::{self, MetadataField, MetadataReport},
};

fn read_checked(path: &str) -> PylonResult<Vec<u8>> {
    let p = Path::new(path);
    if !metadata::is_strippable(p) {
        return Err(PylonError::Metadata("Only JPEG, PNG, WebP, GIF and PDF files can be cleaned".into()));
    }
    let len = std::fs::metadata(p)?.len();
    if len > crate::transfer::STRIP_MAX_BYTES {
        return Err(PylonError::Metadata("File is too large to clean in memory".into()));
    }
    Ok(std::fs::read(p)?)
}

#[tauri::command]
pub async fn strip_file_metadata(local_path: String) -> Result<MetadataReport, PylonError> {
    blocking(move || {
        let data = read_checked(&local_path)?;
        let p = Path::new(&local_path);
        let (clean, report) = metadata::strip_bytes_with_report(&data, p)?;
        let tmp = p.with_extension("pylon-clean-tmp");
        std::fs::write(&tmp, &clean)?;
        if let Ok(meta) = std::fs::metadata(p) {
            let _ = std::fs::set_permissions(&tmp, meta.permissions());
        }
        std::fs::rename(&tmp, p).inspect_err(|_| {
            let _ = std::fs::remove_file(&tmp);
        })?;
        Ok(report)
    })
    .await
}

#[tauri::command]
pub async fn strip_file_metadata_preview(local_path: String) -> Result<MetadataReport, PylonError> {
    blocking(move || {
        let data = read_checked(&local_path)?;
        Ok(metadata::strip_bytes_with_report(&data, Path::new(&local_path))?.1)
    })
    .await
}

#[tauri::command]
pub async fn get_file_metadata(local_path: String) -> Result<Vec<MetadataField>, PylonError> {
    blocking(move || {
        let data = read_checked(&local_path)?;
        metadata::read_fields(&data, Path::new(&local_path))
    })
    .await
}
