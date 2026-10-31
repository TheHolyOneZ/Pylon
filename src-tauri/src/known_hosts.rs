use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use hmac::{Hmac, Mac};
use sha1::Sha1;
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
    format!("SHA256:{}", B64.encode(digest).trim_end_matches('='))
}

pub fn key_type_from_blob(blob: &[u8]) -> Option<String> {
    if blob.len() < 4 {
        return None;
    }
    let n = u32::from_be_bytes([blob[0], blob[1], blob[2], blob[3]]) as usize;
    let name = blob.get(4..4 + n)?;
    std::str::from_utf8(name).ok().map(|s| s.to_string())
}

pub fn known_hosts_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".ssh").join("known_hosts"))
}

fn host_entry(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
}

fn glob_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.to_lowercase().chars().collect();
    let t: Vec<char> = text.to_lowercase().chars().collect();
    let (mut pi, mut ti) = (0usize, 0usize);
    let (mut star, mut mark) = (None, 0usize);
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = ti;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

fn hashed_match(entry: &str, candidate: &str) -> bool {
    let mut parts = entry.split('|');
    let (Some(""), Some("1"), Some(salt), Some(hash)) = (parts.next(), parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    let (Ok(salt), Ok(hash)) = (B64.decode(salt), B64.decode(hash)) else { return false };
    let Ok(mut mac) = Hmac::<Sha1>::new_from_slice(&salt) else { return false };
    mac.update(candidate.as_bytes());
    mac.verify_slice(&hash).is_ok()
}

fn patterns_match(patterns: &str, host: &str, port: u16) -> bool {
    let candidate = host_entry(host, port);
    if patterns.starts_with('|') {
        return hashed_match(patterns, &candidate);
    }
    let mut matched = false;
    for raw in patterns.split(',') {
        let (negated, pat) = match raw.strip_prefix('!') {
            Some(p) => (true, p),
            None => (false, raw),
        };
        let hit = glob_match(pat, &candidate);
        if hit && negated {
            return false;
        }
        if hit {
            matched = true;
        }
    }
    matched
}

struct Line<'a> {
    marker: Option<&'a str>,
    patterns: &'a str,
    key_type: &'a str,
    key_b64: &'a str,
}

fn parse_line(line: &str) -> Option<Line<'_>> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let mut it = line.split_whitespace();
    let mut first = it.next()?;
    let mut marker = None;
    if first.starts_with('@') {
        marker = Some(first);
        first = it.next()?;
    }
    let key_type = it.next()?;
    let key_b64 = it.next()?;
    Some(Line { marker, patterns: first, key_type, key_b64 })
}

pub fn check_host_key_in(content: &str, host: &str, port: u16, key_bytes: &[u8]) -> HostKeyStatus {
    let key_type = key_type_from_blob(key_bytes).unwrap_or_else(|| "unknown".into());
    let new_fp = sha256_fingerprint(key_bytes);
    let mut changed_from: Option<String> = None;

    for line in content.lines() {
        let Some(l) = parse_line(line) else { continue };
        if !patterns_match(l.patterns, host, port) {
            continue;
        }
        let Ok(stored) = B64.decode(l.key_b64) else { continue };
        match l.marker {
            Some("@cert-authority") => continue,
            Some("@revoked") => {
                if stored == key_bytes {
                    return HostKeyStatus::Changed {
                        old_fingerprint: "revoked".into(),
                        new_fingerprint: new_fp,
                        key_type,
                    };
                }
                continue;
            }
            _ => {}
        }
        if stored == key_bytes {
            return HostKeyStatus::Known;
        }
        let stored_type = key_type_from_blob(&stored).unwrap_or_else(|| l.key_type.to_string());
        if stored_type == key_type && changed_from.is_none() {
            changed_from = Some(sha256_fingerprint(&stored));
        }
    }

    match changed_from {
        Some(old) => HostKeyStatus::Changed { old_fingerprint: old, new_fingerprint: new_fp, key_type },
        None => HostKeyStatus::Unknown { fingerprint: new_fp, key_type },
    }
}

pub fn check_host_key(host: &str, port: u16, key_bytes: &[u8]) -> PylonResult<HostKeyStatus> {
    let content = match known_hosts_path() {
        Some(p) if p.exists() => std::fs::read_to_string(&p)
            .map_err(|e| PylonError::Ssh(format!("read known_hosts: {e}")))?,
        _ => String::new(),
    };
    Ok(check_host_key_in(&content, host, port, key_bytes))
}

pub fn add_host_key(host: &str, port: u16, key_bytes: &[u8]) -> PylonResult<()> {
    let path = known_hosts_path().ok_or_else(|| PylonError::Ssh("Cannot locate ~/.ssh directory".into()))?;
    if let Some(parent) = path.parent() {
        let existed = parent.exists();
        std::fs::create_dir_all(parent)?;
        #[cfg(unix)]
        if !existed {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
        #[cfg(not(unix))]
        let _ = existed;
    }
    let key_type = key_type_from_blob(key_bytes).unwrap_or_else(|| "ssh-ed25519".into());
    let existing = std::fs::read_to_string(&path).unwrap_or_default();

    let mut out = String::with_capacity(existing.len() + 128);
    for line in existing.lines() {
        if let Some(l) = parse_line(line) {
            if l.marker.is_none() && patterns_match(l.patterns, host, port) {
                let same_type = B64
                    .decode(l.key_b64)
                    .ok()
                    .and_then(|b| key_type_from_blob(&b))
                    .map(|t| t == key_type)
                    .unwrap_or(l.key_type == key_type);
                if same_type {
                    continue;
                }
            }
        }
        out.push_str(line);
        out.push('\n');
    }
    out.push_str(&format!("{} {} {}\n", host_entry(host, port), key_type, B64.encode(key_bytes)));

    let tmp = path.with_extension("pylon-tmp");
    std::fs::write(&tmp, out)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blob(kind: &str, payload: &[u8]) -> Vec<u8> {
        let mut v = (kind.len() as u32).to_be_bytes().to_vec();
        v.extend_from_slice(kind.as_bytes());
        v.extend_from_slice(payload);
        v
    }

    #[test]
    fn parses_key_type() {
        assert_eq!(key_type_from_blob(&blob("ssh-ed25519", b"x")).as_deref(), Some("ssh-ed25519"));
    }

    #[test]
    fn plain_and_port_entries() {
        let k = blob("ssh-ed25519", b"key1");
        let line = format!("example.com {} {}\n[example.com]:2222 ssh-ed25519 {}\n", "ssh-ed25519", B64.encode(&k), B64.encode(&k));
        assert!(matches!(check_host_key_in(&line, "example.com", 22, &k), HostKeyStatus::Known));
        assert!(matches!(check_host_key_in(&line, "example.com", 2222, &k), HostKeyStatus::Known));
        assert!(matches!(check_host_key_in(&line, "other.com", 22, &k), HostKeyStatus::Unknown { .. }));
    }

    #[test]
    fn hashed_entry_only_matches_its_host() {
        let k = blob("ssh-ed25519", b"key1");
        let salt = b"0123456789abcdef0123";
        let mut mac = Hmac::<Sha1>::new_from_slice(salt).unwrap();
        mac.update(b"server.lan");
        let h = mac.finalize().into_bytes();
        let line = format!("|1|{}|{} ssh-ed25519 {}\n", B64.encode(salt), B64.encode(h), B64.encode(&k));
        assert!(matches!(check_host_key_in(&line, "server.lan", 22, &k), HostKeyStatus::Known));
        let other = blob("ssh-ed25519", b"key2");
        assert!(matches!(check_host_key_in(&line, "elsewhere", 22, &other), HostKeyStatus::Unknown { .. }));
    }

    #[test]
    fn different_key_type_is_unknown_not_changed() {
        let rsa = blob("ssh-rsa", b"rsa");
        let ed = blob("ssh-ed25519", b"ed");
        let line = format!("host ssh-rsa {}\n", B64.encode(&rsa));
        assert!(matches!(check_host_key_in(&line, "host", 22, &ed), HostKeyStatus::Unknown { .. }));
        let ed2 = blob("ssh-ed25519", b"ed2");
        let line2 = format!("host ssh-rsa {}\nhost ssh-ed25519 {}\n", B64.encode(&rsa), B64.encode(&ed));
        assert!(matches!(check_host_key_in(&line2, "host", 22, &ed2), HostKeyStatus::Changed { .. }));
        assert!(matches!(check_host_key_in(&line2, "host", 22, &ed), HostKeyStatus::Known));
    }

    #[test]
    fn wildcards_and_negation() {
        let k = blob("ssh-ed25519", b"k");
        let line = format!("*.corp,!bad.corp ssh-ed25519 {}\n", B64.encode(&k));
        assert!(matches!(check_host_key_in(&line, "a.corp", 22, &k), HostKeyStatus::Known));
        assert!(matches!(check_host_key_in(&line, "bad.corp", 22, &k), HostKeyStatus::Unknown { .. }));
    }

    #[test]
    fn revoked_key_is_rejected() {
        let k = blob("ssh-ed25519", b"k");
        let line = format!("@revoked * ssh-ed25519 {}\nhost ssh-ed25519 {}\n", B64.encode(&k), B64.encode(&k));
        assert!(matches!(check_host_key_in(&line, "host", 22, &k), HostKeyStatus::Changed { .. }));
    }
}
