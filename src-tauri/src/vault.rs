use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    crypto::{self, EncryptedBlob, KEY_LEN},
    error::{PylonError, PylonResult},
};

const SALT_LEN: usize = 32;
const SENTINEL: &[u8] = b"pylon-vault-check-v3";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credential {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_passphrase: Option<String>,
    pub auth_type: AuthType,
    pub created_at: String,
    pub last_used: Option<String>,
}

impl Credential {
    pub fn redacted(&self) -> Credential {
        Credential { password: None, private_key: None, key_passphrase: None, ..self.clone() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    Password,
    PrivateKey,
    Agent,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
struct KdfParams {
    algorithm: KdfAlgorithm,
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "lowercase")]
enum KdfAlgorithm {
    Argon2id,
}

impl KdfParams {
    fn current() -> Self {
        Self { algorithm: KdfAlgorithm::Argon2id, m_cost: 64 * 1024, t_cost: 3, p_cost: 4 }
    }
    fn derive(&self, passphrase: &str, salt: &[u8]) -> PylonResult<[u8; KEY_LEN]> {
        let params = Params::new(self.m_cost, self.t_cost, self.p_cost, Some(KEY_LEN))
            .map_err(|e| PylonError::Crypto(format!("bad KDF params: {e}")))?;
        let mut key = [0u8; KEY_LEN];
        Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
            .hash_password_into(passphrase.as_bytes(), salt, &mut key)
            .map_err(|e| PylonError::Crypto(format!("key derivation failed: {e}")))?;
        Ok(key)
    }
}

#[derive(Serialize, Deserialize)]
struct VaultFileV3 {
    version: u8,
    kdf: KdfParams,
    salt: String,
    check: String,
    entries: HashMap<String, String>,
}

#[derive(Deserialize)]
struct VaultFileV2 {
    #[allow(dead_code)]
    version: u8,
    #[serde(default)]
    sentinel: Option<EncryptedBlob>,
    entries: HashMap<String, EncryptedBlob>,
}

#[derive(Deserialize)]
struct VaultFileV1 {
    entries: HashMap<String, EncryptedBlob>,
}

struct Unlocked {
    key: [u8; KEY_LEN],
    salt: Vec<u8>,
    kdf: KdfParams,
}

impl Drop for Unlocked {
    fn drop(&mut self) {
        for b in self.key.iter_mut() {
            unsafe { std::ptr::write_volatile(b, 0) };
        }
    }
}

struct VaultInner {
    credentials: HashMap<String, Credential>,
    unlocked: Option<Unlocked>,
    vault_path: PathBuf,
}

pub struct Vault {
    inner: Arc<RwLock<VaultInner>>,
}

fn write_private(path: &Path, data: &str) -> PylonResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, data)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

impl Vault {
    pub fn new(vault_path: PathBuf) -> Self {
        Self { inner: Arc::new(RwLock::new(VaultInner { credentials: HashMap::new(), unlocked: None, vault_path })) }
    }

    pub fn exists(&self) -> bool {
        self.inner.read().unwrap().vault_path.exists()
    }

    pub fn is_unlocked(&self) -> bool {
        self.inner.read().unwrap().unlocked.is_some()
    }

    pub fn create(&self, passphrase: &str) -> PylonResult<()> {
        if passphrase.chars().count() < 8 {
            return Err(PylonError::Vault("Use a passphrase of at least 8 characters".into()));
        }
        let mut inner = self.inner.write().unwrap();
        if inner.vault_path.exists() {
            return Err(PylonError::Vault("A vault already exists for this profile".into()));
        }
        let mut salt = vec![0u8; SALT_LEN];
        rand::rngs::OsRng.fill_bytes(&mut salt);
        let kdf = KdfParams::current();
        let key = kdf.derive(passphrase, &salt)?;
        inner.credentials.clear();
        inner.unlocked = Some(Unlocked { key, salt, kdf });
        Self::persist_locked(&inner)
    }

    pub fn unlock(&self, passphrase: &str) -> PylonResult<()> {
        let mut inner = self.inner.write().unwrap();
        let path = inner.vault_path.clone();
        if !path.exists() {
            return Err(PylonError::Vault("No vault exists for this profile yet — create one first".into()));
        }
        let data = std::fs::read_to_string(&path).map_err(|e| PylonError::Vault(format!("Read vault: {e}")))?;
        let value: serde_json::Value = serde_json::from_str(&data)
            .map_err(|_| PylonError::Vault("The vault file is corrupted (not valid JSON). It was left untouched.".into()))?;
        let version = value.get("version").and_then(|v| v.as_u64());

        let (creds, unlocked, needs_migration) = match version {
            Some(3) => {
                let f: VaultFileV3 = serde_json::from_value(value)
                    .map_err(|e| PylonError::Vault(format!("The vault file is corrupted: {e}")))?;
                let salt = B64.decode(&f.salt).map_err(|_| PylonError::Vault("Corrupted vault salt".into()))?;
                let key = f.kdf.derive(passphrase, &salt)?;
                let check = B64.decode(&f.check).map_err(|_| PylonError::Vault("Corrupted vault".into()))?;
                crypto::decrypt_with_key(&key, &check).map_err(|_| PylonError::Vault("Wrong passphrase".into()))?;
                let mut creds = HashMap::new();
                for (id, sealed) in f.entries {
                    let bytes = B64.decode(sealed).map_err(|_| PylonError::Vault(format!("Corrupted entry {id}")))?;
                    let plain = crypto::decrypt_with_key(&key, &bytes)
                        .map_err(|_| PylonError::Vault(format!("Entry {id} failed to decrypt — vault may be damaged")))?;
                    let cred: Credential = serde_json::from_slice(&plain)?;
                    creds.insert(id, cred);
                }
                (creds, Unlocked { key, salt, kdf: f.kdf }, false)
            }
            Some(2) => {
                let f: VaultFileV2 = serde_json::from_value(value)
                    .map_err(|e| PylonError::Vault(format!("The vault file is corrupted: {e}")))?;
                if let Some(s) = &f.sentinel {
                    crypto::decrypt(passphrase, s).map_err(|_| PylonError::Vault("Wrong passphrase".into()))?;
                }
                let creds = decrypt_legacy_entries(passphrase, f.entries, f.sentinel.is_none())?;
                (creds, fresh_unlocked(passphrase)?, true)
            }
            _ => {
                let f: VaultFileV1 = serde_json::from_value(value)
                    .map_err(|_| PylonError::Vault("Unrecognised vault format. It was left untouched.".into()))?;
                let creds = decrypt_legacy_entries(passphrase, f.entries, true)?;
                (creds, fresh_unlocked(passphrase)?, true)
            }
        };

        inner.credentials = creds;
        inner.unlocked = Some(unlocked);
        if needs_migration {
            let backup = path.with_extension(format!("json.v{}.bak", version.unwrap_or(1)));
            let _ = std::fs::copy(&path, &backup);
            Self::persist_locked(&inner)?;
            tracing::info!("vault migrated to v3 (backup at {})", backup.display());
        }
        Ok(())
    }

    pub fn lock(&self) {
        let mut inner = self.inner.write().unwrap();
        inner.credentials.clear();
        inner.unlocked = None;
    }

    fn require_unlocked(inner: &VaultInner) -> PylonResult<()> {
        if inner.unlocked.is_none() {
            return Err(PylonError::VaultLocked);
        }
        Ok(())
    }

    pub fn add_credential(&self, cred: Credential) -> PylonResult<String> {
        let mut inner = self.inner.write().unwrap();
        Self::require_unlocked(&inner)?;
        let id = cred.id.clone();
        inner.credentials.insert(id.clone(), cred);
        Self::persist_locked(&inner)?;
        Ok(id)
    }

    pub fn update_credential(&self, mut cred: Credential) -> PylonResult<()> {
        let mut inner = self.inner.write().unwrap();
        Self::require_unlocked(&inner)?;
        let old = inner
            .credentials
            .get(&cred.id)
            .cloned()
            .ok_or_else(|| PylonError::NotFound(format!("Credential {}", cred.id)))?;
        cred.created_at = old.created_at.clone();
        cred.last_used = old.last_used.clone();
        if cred.auth_type == old.auth_type {
            if cred.password.as_deref().is_none_or(str::is_empty) {
                cred.password = old.password.clone();
            }
            if cred.private_key.as_deref().is_none_or(|k| k.trim().is_empty()) {
                cred.private_key = old.private_key.clone();
            }
            if cred.key_passphrase.as_deref().is_none_or(str::is_empty) {
                cred.key_passphrase = old.key_passphrase.clone();
            }
        }
        inner.credentials.insert(cred.id.clone(), cred);
        Self::persist_locked(&inner)
    }

    pub fn touch(&self, id: &str) {
        let mut inner = self.inner.write().unwrap();
        if inner.unlocked.is_none() {
            return;
        }
        if let Some(c) = inner.credentials.get_mut(id) {
            c.last_used = Some(chrono::Utc::now().to_rfc3339());
        }
        let _ = Self::persist_locked(&inner);
    }

    pub fn get_credential_with_secret(&self, id: &str) -> PylonResult<Credential> {
        let inner = self.inner.read().unwrap();
        Self::require_unlocked(&inner)?;
        inner.credentials.get(id).cloned().ok_or_else(|| PylonError::NotFound(format!("Credential {id}")))
    }

    pub fn list_credentials(&self) -> PylonResult<Vec<Credential>> {
        let inner = self.inner.read().unwrap();
        Self::require_unlocked(&inner)?;
        let mut creds: Vec<Credential> = inner.credentials.values().map(Credential::redacted).collect();
        creds.sort_by_key(|a| a.label.to_lowercase());
        Ok(creds)
    }

    pub fn delete_credential(&self, id: &str) -> PylonResult<()> {
        let mut inner = self.inner.write().unwrap();
        Self::require_unlocked(&inner)?;
        inner.credentials.remove(id);
        Self::persist_locked(&inner)
    }

    pub fn change_passphrase(&self, current: &str, new: &str) -> PylonResult<()> {
        if new.chars().count() < 8 {
            return Err(PylonError::Vault("Use a passphrase of at least 8 characters".into()));
        }
        let path = self.inner.read().unwrap().vault_path.clone();
        Vault::new(path).unlock(current)?;
        let mut inner = self.inner.write().unwrap();
        Self::require_unlocked(&inner)?;
        inner.unlocked = Some(fresh_unlocked(new)?);
        Self::persist_locked(&inner)
    }

    pub fn reset(&self) -> PylonResult<()> {
        let mut inner = self.inner.write().unwrap();
        if inner.vault_path.exists() {
            std::fs::remove_file(&inner.vault_path).map_err(|e| PylonError::Vault(format!("Delete vault: {e}")))?;
        }
        inner.credentials.clear();
        inner.unlocked = None;
        Ok(())
    }

    fn persist_locked(inner: &VaultInner) -> PylonResult<()> {
        let u = inner.unlocked.as_ref().ok_or(PylonError::VaultLocked)?;
        let mut entries = HashMap::new();
        for (id, cred) in &inner.credentials {
            let sealed = crypto::encrypt_with_key(&u.key, &serde_json::to_vec(cred)?)?;
            entries.insert(id.clone(), B64.encode(sealed));
        }
        let file = VaultFileV3 {
            version: 3,
            kdf: u.kdf,
            salt: B64.encode(&u.salt),
            check: B64.encode(crypto::encrypt_with_key(&u.key, SENTINEL)?),
            entries,
        };
        write_private(&inner.vault_path, &serde_json::to_string_pretty(&file)?)
    }
}

fn fresh_unlocked(passphrase: &str) -> PylonResult<Unlocked> {
    let mut salt = vec![0u8; SALT_LEN];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    let kdf = KdfParams::current();
    let key = kdf.derive(passphrase, &salt)?;
    Ok(Unlocked { key, salt, kdf })
}

fn decrypt_legacy_entries(
    passphrase: &str,
    entries: HashMap<String, EncryptedBlob>,
    entry_is_check: bool,
) -> PylonResult<HashMap<String, Credential>> {
    let mut out = HashMap::new();
    for (i, (id, blob)) in entries.into_iter().enumerate() {
        let plain = match crypto::decrypt(passphrase, &blob) {
            Ok(p) => p,
            Err(_) if i == 0 && entry_is_check => return Err(PylonError::Vault("Wrong passphrase".into())),
            Err(_) => return Err(PylonError::Vault(format!("Entry {id} failed to decrypt — vault may be damaged"))),
        };
        let cred: Credential = serde_json::from_slice(&plain)?;
        out.insert(id, cred);
    }
    Ok(out)
}

#[allow(clippy::too_many_arguments)]
pub fn new_credential(
    label: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    key_passphrase: Option<String>,
    auth_type: AuthType,
) -> Credential {
    Credential {
        id: Uuid::new_v4().to_string(),
        label,
        host,
        port,
        username,
        password,
        private_key,
        key_passphrase,
        auth_type,
        created_at: chrono::Utc::now().to_rfc3339(),
        last_used: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_path(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("pylon-test-{}-{name}.json", Uuid::new_v4()));
        let _ = std::fs::remove_file(&p);
        p
    }

    fn cred(label: &str) -> Credential {
        new_credential(label.into(), "h".into(), 22, "u".into(), Some("pw".into()), None, None, AuthType::Password)
    }

    #[test]
    fn create_unlock_roundtrip() {
        let p = tmp_path("rt");
        let v = Vault::new(p.clone());
        v.create("correct horse").unwrap();
        let id = v.add_credential(cred("a")).unwrap();
        v.lock();
        assert!(v.unlock("wrong passphrase").is_err());
        assert!(!v.is_unlocked());
        v.unlock("correct horse").unwrap();
        assert_eq!(v.get_credential_with_secret(&id).unwrap().password.as_deref(), Some("pw"));
        assert!(v.list_credentials().unwrap()[0].password.is_none());
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn update_keeps_secret_when_blank() {
        let p = tmp_path("upd");
        let v = Vault::new(p.clone());
        v.create("correct horse").unwrap();
        let id = v.add_credential(cred("a")).unwrap();
        let mut edited = v.get_credential_with_secret(&id).unwrap().redacted();
        edited.label = "renamed".into();
        v.update_credential(edited).unwrap();
        let c = v.get_credential_with_secret(&id).unwrap();
        assert_eq!(c.label, "renamed");
        assert_eq!(c.password.as_deref(), Some("pw"));
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn migrates_v2() {
        let p = tmp_path("v2");
        let c = cred("legacy");
        let mut entries = HashMap::new();
        entries.insert(c.id.clone(), crypto::encrypt("old pass", &serde_json::to_vec(&c).unwrap()).unwrap());
        let file = serde_json::json!({
            "version": 2, "vault_salt": "AAAA",
            "sentinel": crypto::encrypt("old pass", b"pylon-vault-sentinel-v2").unwrap(),
            "entries": entries,
        });
        std::fs::write(&p, file.to_string()).unwrap();
        let v = Vault::new(p.clone());
        assert!(v.unlock("nope").is_err());
        v.unlock("old pass").unwrap();
        let on_disk: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(on_disk["version"], 3);
        v.lock();
        v.unlock("old pass").unwrap();
        assert_eq!(v.list_credentials().unwrap()[0].label, "legacy");
        let _ = std::fs::remove_file(&p);
        let _ = std::fs::remove_file(p.with_extension("json.v2.bak"));
    }

    #[test]
    fn corrupt_file_is_not_overwritten() {
        let p = tmp_path("bad");
        std::fs::write(&p, "{not json").unwrap();
        let v = Vault::new(p.clone());
        assert!(v.unlock("whatever").is_err());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "{not json");
        let _ = std::fs::remove_file(p);
    }
}
