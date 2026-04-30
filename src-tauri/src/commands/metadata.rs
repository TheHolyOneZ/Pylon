use std::path::Path;

use crate::{
    error::PylonError,
    metadata::{self, MetadataField, MetadataReport},
};

#[tauri::command]
pub async fn strip_file_metadata(local_path: String) -> Result<(), PylonError> {
    let data = std::fs::read(&local_path)?;
    let clean = metadata::strip_bytes(&data, Path::new(&local_path))?;
    std::fs::write(&local_path, clean)?;
    Ok(())
}

#[tauri::command]
pub async fn strip_file_metadata_preview(
    local_path: String,
) -> Result<MetadataReport, PylonError> {
    let data = std::fs::read(&local_path)?;
    let (_, report) = metadata::strip_bytes_with_report(&data, Path::new(&local_path))?;
    Ok(report)
}

#[tauri::command]
pub async fn get_file_metadata(local_path: String) -> Result<Vec<MetadataField>, PylonError> {
    let data = std::fs::read(&local_path)?;
    metadata::read_fields(&data, Path::new(&local_path))
}
