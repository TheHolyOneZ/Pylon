

use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use sha2::{Digest, Sha256};

use crate::error::{PylonError, PylonResult};

#[derive(Debug, Clone)]
pub enum HostKeyStatus {

    Known,

    Unknown { fingerprint: String, key_type: String },

    Changed { old_fingerprint: String, new_fingerprint: String, key_type: String },
}

pub fn sha256_fingerprint(key_bytes: &[u8]) -> String {
    let digest = Sha256::digest(key_bytes);
    let b64 = B64.encode(digest);

    format!("SHA256:{}", b64.trim_end_matches('='))
}

pub fn known_hosts_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".ssh").join("known_hosts"))
}

pub fn check_host_key(
    host: &str,
    port: u16,
    key_bytes: &[u8],
    key_type: &str,
) -> PylonResult<HostKeyStatus> {
    let path = match known_hosts_path() {
        Some(p) => p,
        None => return Ok(HostKeyStatus::Unknown {
            fingerprint: sha256_fingerprint(key_bytes),
            key_type: key_type.to_string(),
        }),
    };

    if !path.exists() {
        return Ok(HostKeyStatus::Unknown {
            fingerprint: sha256_fingerprint(key_bytes),
            key_type: key_type.to_string(),
        });
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| PylonError::Ssh(format!("read known_hosts: {e}")))?;

    let new_fp = sha256_fingerprint(key_bytes);

    let host_pattern = if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    };

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let parts: Vec<&str> = line.splitn(3, ' ').collect();
        if parts.len() < 3 {
            continue;
        }
        let patterns = parts[0];
        let _algo = parts[1];
        let stored_key_b64 = parts[2].split_whitespace().next().unwrap_or("");

        let matches = patterns.split(',').any(|p| {
            let p = p.trim();
            p == host_pattern
                || p == host
                || p == "*"

                || p.starts_with('|')
        });

        if matches {

            if let Ok(stored_bytes) = B64.decode(stored_key_b64) {
                let stored_fp = sha256_fingerprint(&stored_bytes);
                if stored_fp == new_fp {
                    return Ok(HostKeyStatus::Known);
                } else {
                    return Ok(HostKeyStatus::Changed {
                        old_fingerprint: stored_fp,
                        new_fingerprint: new_fp,
                        key_type: key_type.to_string(),
                    });
                }
            }
        }
    }

    Ok(HostKeyStatus::Unknown {
        fingerprint: new_fp,
        key_type: key_type.to_string(),
    })
}

pub fn add_host_key(
    host: &str,
    port: u16,
    key_bytes: &[u8],
    key_type: &str,
) -> PylonResult<()> {
    let path = match known_hosts_path() {
        Some(p) => p,
        None => return Err(PylonError::Ssh("Cannot locate ~/.ssh directory".into())),
    };

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
        }
    }

    let host_entry = if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    };
    let key_b64 = B64.encode(key_bytes);
    let line = format!("{host_entry} {key_type} {key_b64}\n");

    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    file.write_all(line.as_bytes())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }

    Ok(())
}
