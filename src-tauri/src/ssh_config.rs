

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfigHost {
    pub alias: String,
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    pub proxy_jump: Option<String>,
}

pub fn ssh_config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".ssh").join("config"))
}

pub fn list_ssh_config_hosts() -> Vec<SshConfigHost> {
    let path = match ssh_config_path() {
        Some(p) => p,
        None => return vec![],
    };

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut hosts = Vec::new();
    let mut current: Option<SshConfigHost> = None;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let (key, value) = if let Some(idx) = line.find(|c: char| c == ' ' || c == '\t' || c == '=') {
            let k = line[..idx].trim();
            let v = line[idx..].trim_start_matches(|c: char| c == ' ' || c == '\t' || c == '=').trim();
            (k.to_lowercase(), v.to_string())
        } else {
            continue;
        };

        match key.as_str() {
            "host" => {
                if let Some(prev) = current.take() {

                    if prev.alias != "*" && !prev.alias.contains('*') {
                        hosts.push(prev);
                    }
                }
                current = Some(SshConfigHost {
                    alias: value,
                    hostname: None,
                    user: None,
                    port: None,
                    identity_file: None,
                    proxy_jump: None,
                });
            }
            "hostname" => {
                if let Some(ref mut h) = current {
                    h.hostname = Some(value);
                }
            }
            "user" => {
                if let Some(ref mut h) = current {
                    h.user = Some(value);
                }
            }
            "port" => {
                if let Some(ref mut h) = current {
                    h.port = value.parse().ok();
                }
            }
            "identityfile" => {
                if let Some(ref mut h) = current {

                    let expanded = if value.starts_with('~') {
                        let rest = value
                            .trim_start_matches('~')
                            .trim_start_matches('/')
                            .trim_start_matches('\\');
                        dirs::home_dir()
                            .map(|home| {
                                if rest.is_empty() {
                                    home.to_string_lossy().into_owned()
                                } else {
                                    home.join(rest).to_string_lossy().into_owned()
                                }
                            })
                            .unwrap_or(value)
                    } else {
                        value
                    };
                    h.identity_file = Some(expanded);
                }
            }
            "proxyjump" => {
                if let Some(ref mut h) = current {
                    h.proxy_jump = Some(value);
                }
            }
            _ => {}
        }
    }

    if let Some(prev) = current {
        if prev.alias != "*" && !prev.alias.contains('*') {
            hosts.push(prev);
        }
    }

    hosts
}
