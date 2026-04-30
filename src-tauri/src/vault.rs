


use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, RwLock},
};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    crypto::{self, EncryptedBlob},
    error::{PylonError, PylonResult},
};

const SALT_LEN: usize = 32;

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
    pub auth_type: AuthType,
    pub created_at: String,
    pub last_used: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    Password,
    PrivateKey,
    Agent,
}

#[derive(Serialize, Deserialize)]
struct VaultFile {
    version: u8,

    vault_salt: String,


    #[serde(default)]
    sentinel: Option<EncryptedBlob>,
    entries: HashMap<String, EncryptedBlob>,
}


struct VaultInner {
    credentials: HashMap<String, Credential>,
    session_key: Option<[u8; 32]>,
    vault_path: PathBuf,

    passphrase_cache: Option<String>,

    vault_salt: Option<String>,

    loaded: bool,
}

pub struct Vault {
    inner: Arc<RwLock<VaultInner>>,
}

impl Vault {
    pub fn new(vault_path: PathBuf) -> Self {
        Self {
            inner: Arc::new(RwLock::new(VaultInner {
                credentials: HashMap::new(),
                session_key: None,
                vault_path,
                passphrase_cache: None,
                vault_salt: None,
                loaded: false,
            })),
        }
    }

    pub fn is_unlocked(&self) -> bool {
        self.inner.read().unwrap().session_key.is_some()
    }

    pub fn unlock(&self, passphrase: &str) -> PylonResult<()> {
        let mut inner = self.inner.write().unwrap();
        let vault_path = inner.vault_path.clone();

        if vault_path.exists() {
            let data = std::fs::read_to_string(&vault_path)
                .map_err(|e| PylonError::Vault(format!("Read vault: {e}")))?;


            if let Ok(vault_file) = serde_json::from_str::<VaultFile>(&data) {
                let salt = B64
                    .decode(&vault_file.vault_salt)
                    .map_err(|e| PylonError::Vault(format!("Bad vault salt: {e}")))?;


                if let Some(ref sentinel_blob) = vault_file.sentinel {
                    crypto::decrypt(passphrase, sentinel_blob)
                        .map_err(|_| PylonError::Vault("Wrong passphrase".into()))?;
                } else if vault_file.entries.is_empty() {


                    return Err(PylonError::Vault("Vault exists but cannot verify passphrase — please reset the vault".into()));
                }


                let key = crypto::derive_key(passphrase, &salt)?;
                inner.session_key = Some(key);
                inner.vault_salt = Some(vault_file.vault_salt.clone());

                for (id, blob) in vault_file.entries {
                    let plaintext = crypto::decrypt(passphrase, &blob)?;
                    let cred: Credential = serde_json::from_slice(&plaintext)?;
                    inner.credentials.insert(id, cred);
                }
            } else {

                #[allow(deprecated)]
                let v1_salt = b"pylon-vault-v1-salt-static";
                let key = crypto::derive_key(passphrase, v1_salt)?;
                inner.session_key = Some(key);


                #[derive(Deserialize)]
                struct V1VaultFile {
                    entries: HashMap<String, EncryptedBlob>,
                }
                if let Ok(v1) = serde_json::from_str::<V1VaultFile>(&data) {
                    for (id, blob) in v1.entries {

                        if let Ok(plaintext) = crypto::decrypt(passphrase, &blob) {
                            if let Ok(cred) = serde_json::from_slice::<Credential>(&plaintext) {
                                inner.credentials.insert(id, cred);
                            }
                        }
                    }
                }
            }
        } else {


            let mut tmp_salt = [0u8; SALT_LEN];
            rand::rngs::OsRng.fill_bytes(&mut tmp_salt);
            let new_salt = B64.encode(tmp_salt);
            let key = crypto::derive_key(passphrase, &tmp_salt)?;
            inner.session_key = Some(key);
            inner.vault_salt = Some(new_salt.clone());
            inner.passphrase_cache = Some(passphrase.to_string());
            inner.loaded = true;
            drop(inner);
            return self.persist(passphrase);
        }

        inner.passphrase_cache = Some(passphrase.to_string());
        inner.loaded = true;
        Ok(())
    }

    pub fn lock(&self) {
        let mut inner = self.inner.write().unwrap();
        inner.credentials.clear();
        inner.session_key = None;
        inner.passphrase_cache = None;

    }

    pub fn add_credential(&self, passphrase: &str, cred: Credential) -> PylonResult<String> {
        {
            let mut inner = self.inner.write().unwrap();
            if inner.session_key.is_none() {
                return Err(PylonError::VaultLocked);
            }
            let id = cred.id.clone();
            inner.credentials.insert(id, cred);
        }
        self.persist(passphrase)?;
        Ok(self.inner.read().unwrap().credentials.keys().last().unwrap().clone())
    }

    pub fn add_credential_returning_id(&self, passphrase: &str, cred: Credential) -> PylonResult<String> {
        let id = cred.id.clone();
        {
            let mut inner = self.inner.write().unwrap();
            if inner.session_key.is_none() {
                return Err(PylonError::VaultLocked);
            }
            inner.credentials.insert(id.clone(), cred);
        }
        self.persist(passphrase)?;
        Ok(id)
    }

    pub fn update_credential(&self, passphrase: &str, cred: Credential) -> PylonResult<()> {
        {
            let mut inner = self.inner.write().unwrap();
            if inner.session_key.is_none() {
                return Err(PylonError::VaultLocked);
            }
            inner.credentials.insert(cred.id.clone(), cred);
        }
        self.persist(passphrase)
    }


    pub fn get_credential_with_secret(&self, id: &str) -> PylonResult<Credential> {
        let inner = self.inner.read().unwrap();
        if inner.session_key.is_none() {
            return Err(PylonError::VaultLocked);
        }
        inner
            .credentials
            .get(id)
            .cloned()
            .ok_or_else(|| PylonError::NotFound(format!("Credential {id}")))
    }

    pub fn get_credential(&self, id: &str) -> PylonResult<Credential> {
        let inner = self.inner.read().unwrap();
        if inner.session_key.is_none() {
            return Err(PylonError::VaultLocked);
        }
        inner
            .credentials
            .get(id)
            .cloned()
            .ok_or_else(|| PylonError::NotFound(format!("Credential {id}")))
    }

    pub fn list_credentials(&self) -> PylonResult<Vec<Credential>> {
        let inner = self.inner.read().unwrap();
        if inner.session_key.is_none() {
            return Err(PylonError::VaultLocked);
        }
        let mut creds: Vec<Credential> = inner
            .credentials
            .values()
            .map(|c| Credential {
                password: None,
                private_key: None,
                ..c.clone()
            })
            .collect();
        creds.sort_by(|a, b| a.label.cmp(&b.label));
        Ok(creds)
    }

    pub fn delete_credential(&self, passphrase: &str, id: &str) -> PylonResult<()> {
        {
            let mut inner = self.inner.write().unwrap();
            if inner.session_key.is_none() {
                return Err(PylonError::VaultLocked);
            }
            inner.credentials.remove(id);
        }
        self.persist(passphrase)
    }


    pub fn reset(&self) -> PylonResult<()> {
        let mut inner = self.inner.write().unwrap();
        let vault_path = inner.vault_path.clone();
        if vault_path.exists() {
            std::fs::remove_file(&vault_path)
                .map_err(|e| PylonError::Vault(format!("Delete vault: {e}")))?;
        }
        inner.credentials.clear();
        inner.session_key = None;
        inner.passphrase_cache = None;
        inner.vault_salt = None;
        inner.loaded = false;
        Ok(())
    }

    fn persist(&self, passphrase: &str) -> PylonResult<()> {
        let inner = self.inner.read().unwrap();
        let vault_path = inner.vault_path.clone();


        let vault_salt = inner.vault_salt.clone().unwrap_or_else(|| {
            let mut s = [0u8; SALT_LEN];
            rand::rngs::OsRng.fill_bytes(&mut s);
            B64.encode(s)
        });


        let sentinel = Some(crypto::encrypt(passphrase, b"pylon-vault-sentinel-v2")?);

        let mut entries = HashMap::new();
        for (id, cred) in &inner.credentials {
            let plaintext = serde_json::to_vec(cred)?;
            let blob = crypto::encrypt(passphrase, &plaintext)?;
            entries.insert(id.clone(), blob);
        }

        let vault_file = VaultFile { version: 2, vault_salt, sentinel, entries };
        let data = serde_json::to_string_pretty(&vault_file)?;

        if let Some(parent) = vault_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let tmp_path = vault_path.with_extension("tmp");
        std::fs::write(&tmp_path, &data)?;
        std::fs::rename(&tmp_path, &vault_path)?;
        Ok(())
    }
}

pub fn new_credential(
    label: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
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
        auth_type,
        created_at: chrono::Utc::now().to_rfc3339(),
        last_used: None,
    }
}
