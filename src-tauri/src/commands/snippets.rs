

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{PylonError, PylonResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub id: String,
    pub label: String,
    pub command: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub color: Option<String>,
}

fn snippets_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("pylon")
        .join("snippets.json")
}

fn load_snippets() -> PylonResult<Vec<Snippet>> {
    let path = snippets_path();
    if !path.exists() {
        return Ok(vec![]);
    }
    let data = std::fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&data)?)
}

fn save_snippets(snippets: &[Snippet]) -> PylonResult<()> {
    let path = snippets_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(snippets)?)?;
    Ok(())
}

#[tauri::command]
pub async fn list_snippets() -> Result<Vec<Snippet>, PylonError> {
    load_snippets()
}

#[tauri::command]
pub async fn save_snippet(
    label: String,
    command: String,
    description: Option<String>,
    category: Option<String>,
    color: Option<String>,
    existing_id: Option<String>,
) -> Result<Snippet, PylonError> {
    let mut snippets = load_snippets()?;
    let id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    let snippet = Snippet { id: id.clone(), label, command, description, category, color };

    if let Some(pos) = snippets.iter().position(|s| s.id == id) {
        snippets[pos] = snippet.clone();
    } else {
        snippets.push(snippet.clone());
    }

    save_snippets(&snippets)?;
    Ok(snippet)
}

#[tauri::command]
pub async fn delete_snippet(id: String) -> Result<(), PylonError> {
    let mut snippets = load_snippets()?;
    snippets.retain(|s| s.id != id);
    save_snippets(&snippets)
}
