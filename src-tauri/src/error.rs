use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum PylonError {
    #[error("SSH error: {0}")]
    Ssh(String),
    #[error("SFTP error: {0}")]
    Sftp(String),
    #[error("IO error: {0}")]
    Io(String),
    #[error("Crypto error: {0}")]
    Crypto(String),
    #[error("Vault locked")]
    VaultLocked,
    #[error("Vault error: {0}")]
    Vault(String),
    #[error("Session not found: {0}")]
    SessionNotFound(String),
    #[error("Transfer error: {0}")]
    Transfer(String),
    #[error("Metadata error: {0}")]
    Metadata(String),
    #[error("Watcher error: {0}")]
    Watcher(String),
    #[error("Terminal error: {0}")]
    Terminal(String),
    #[error("Serialization error: {0}")]
    Serialization(String),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Already exists: {0}")]
    AlreadyExists(String),
    #[error("{0}")]
    Other(String),
}

impl From<std::io::Error> for PylonError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

impl From<ssh2::Error> for PylonError {
    fn from(e: ssh2::Error) -> Self {
        Self::Ssh(e.to_string())
    }
}

impl From<serde_json::Error> for PylonError {
    fn from(e: serde_json::Error) -> Self {
        Self::Serialization(e.to_string())
    }
}

impl From<anyhow::Error> for PylonError {
    fn from(e: anyhow::Error) -> Self {
        Self::Other(e.to_string())
    }
}

pub type PylonResult<T> = Result<T, PylonError>;
