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

fn expand_home(value: &str) -> String {
    let rest = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
        .or_else(|| value.strip_prefix("%d/"));
    match (rest, dirs::home_dir()) {
        (Some(r), Some(home)) => home.join(r).to_string_lossy().into_owned(),
        _ if value == "~" => dirs::home_dir().map(|h| h.to_string_lossy().into_owned()).unwrap_or_default(),
        _ => value.to_string(),
    }
}

fn unquote(v: &str) -> &str {
    v.strip_prefix('"').and_then(|v| v.strip_suffix('"')).unwrap_or(v)
}

pub fn parse(content: &str) -> Vec<SshConfigHost> {
    let mut hosts: Vec<SshConfigHost> = Vec::new();
    let mut current: Vec<usize> = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some(idx) = line.find([' ', '\t', '=']) else { continue };
        let key = line[..idx].trim().to_lowercase();
        let value = unquote(line[idx..].trim_start_matches([' ', '\t', '=']).trim()).to_string();

        match key.as_str() {
            "host" => {
                current.clear();
                for alias in value.split_whitespace() {
                    if alias.contains('*') || alias.contains('?') || alias.starts_with('!') {
                        continue;
                    }
                    hosts.push(SshConfigHost {
                        alias: alias.to_string(),
                        hostname: None,
                        user: None,
                        port: None,
                        identity_file: None,
                        proxy_jump: None,
                    });
                    current.push(hosts.len() - 1);
                }
            }
            "match" => current.clear(),
            _ => {
                for &i in &current {
                    let h = &mut hosts[i];
                    match key.as_str() {
                        "hostname" if h.hostname.is_none() => h.hostname = Some(value.clone()),
                        "user" if h.user.is_none() => h.user = Some(value.clone()),
                        "port" if h.port.is_none() => h.port = value.parse().ok(),
                        "identityfile" if h.identity_file.is_none() => h.identity_file = Some(expand_home(&value)),
                        "proxyjump" if h.proxy_jump.is_none() => h.proxy_jump = Some(value.clone()),
                        _ => {}
                    }
                }
            }
        }
    }
    hosts
}

pub fn list_ssh_config_hosts() -> Vec<SshConfigHost> {
    ssh_config_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|c| parse(&c))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multiple_aliases_and_wildcards() {
        let cfg = "Host *\n  User def\nHost web web-prod\n  HostName 10.0.0.5\n  Port 2200\nMatch host x\n  User nope\nHost db\n  User=postgres\n";
        let h = parse(cfg);
        assert_eq!(h.len(), 3);
        assert_eq!(h[0].alias, "web");
        assert_eq!(h[1].alias, "web-prod");
        assert_eq!(h[1].port, Some(2200));
        assert_eq!(h[2].user.as_deref(), Some("postgres"));
    }
}
