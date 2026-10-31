use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{PylonError, PylonResult},
    vault::{Credential, Vault},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultProfile {
    pub id: String,
    pub name: String,

    pub color: String,

    pub icon: String,
    pub created_at: String,

    pub file_name: String,
}

#[derive(Serialize, Deserialize, Default)]
struct ProfileList {
    profiles: Vec<VaultProfile>,

    active_id: String,
}

pub struct VaultManager {
    data_dir: PathBuf,
    profiles_path: PathBuf,
    profiles: Mutex<ProfileList>,
    vaults: Mutex<HashMap<String, Arc<Vault>>>,
}

impl VaultManager {
    pub fn new(data_dir: PathBuf) -> Self {
        let profiles_path = data_dir.join("vault-profiles.json");
        let profiles = if profiles_path.exists() {
            std::fs::read_to_string(&profiles_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            ProfileList::default()
        };

        let mut profiles = profiles;
        if profiles.profiles.is_empty() {
            let default = VaultProfile {
                id: "default".into(),
                name: "Default".into(),
                color: "#00e5ff".into(),
                icon: "🔒".into(),
                created_at: chrono::Utc::now().to_rfc3339(),
                file_name: "vault-default.json".into(),
            };
            profiles.profiles.push(default);
            profiles.active_id = "default".into();
        }

        let vaults: HashMap<String, Arc<Vault>> = profiles
            .profiles
            .iter()
            .map(|p| {
                let vault_path = data_dir.join(&p.file_name);
                (p.id.clone(), Arc::new(Vault::new(vault_path)))
            })
            .collect();

        Self {
            data_dir,
            profiles_path,
            profiles: Mutex::new(profiles),
            vaults: Mutex::new(vaults),
        }
    }

    fn save_profiles(&self) -> PylonResult<()> {
        let profiles = self.profiles.lock().unwrap();
        let data = serde_json::to_string_pretty(&*profiles)?;
        if let Some(parent) = self.profiles_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = self.profiles_path.with_extension("tmp");
        std::fs::write(&tmp, data)?;
        std::fs::rename(&tmp, &self.profiles_path)?;
        Ok(())
    }

    fn active_vault(&self) -> PylonResult<Arc<Vault>> {
        let profiles = self.profiles.lock().unwrap();
        let active_id = &profiles.active_id;
        let vaults = self.vaults.lock().unwrap();
        vaults
            .get(active_id)
            .cloned()
            .ok_or_else(|| PylonError::Vault(format!("Active profile '{active_id}' not found")))
    }

    pub fn list_profiles(&self) -> Vec<VaultProfile> {
        let profiles = self.profiles.lock().unwrap();
        profiles.profiles.clone()
    }

    pub fn active_profile_id(&self) -> String {
        self.profiles.lock().unwrap().active_id.clone()
    }

    pub fn is_profile_unlocked(&self, id: &str) -> bool {
        let vaults = self.vaults.lock().unwrap();
        vaults.get(id).map(|v| v.is_unlocked()).unwrap_or(false)
    }

    pub fn select_profile(&self, id: &str) -> PylonResult<()> {
        let mut profiles = self.profiles.lock().unwrap();
        if profiles.profiles.iter().any(|p| p.id == id) {
            profiles.active_id = id.to_string();
            drop(profiles);
            self.save_profiles()?;
            Ok(())
        } else {
            Err(PylonError::Vault(format!("Profile '{id}' does not exist")))
        }
    }

    pub fn create_profile(&self, name: String, color: String, icon: String) -> PylonResult<VaultProfile> {
        let id = Uuid::new_v4().to_string();
        let file_name = format!("vault-{id}.json");
        let profile = VaultProfile {
            id: id.clone(),
            name,
            color,
            icon,
            created_at: chrono::Utc::now().to_rfc3339(),
            file_name: file_name.clone(),
        };

        let vault_path = self.data_dir.join(&file_name);
        let vault = Arc::new(Vault::new(vault_path));

        {
            let mut profiles = self.profiles.lock().unwrap();
            profiles.profiles.push(profile.clone());
        }
        {
            let mut vaults = self.vaults.lock().unwrap();
            vaults.insert(id, vault);
        }

        self.save_profiles()?;
        Ok(profile)
    }

    pub fn delete_profile(&self, id: &str) -> PylonResult<()> {
        {
            let profiles = self.profiles.lock().unwrap();
            if profiles.profiles.len() <= 1 {
                return Err(PylonError::Vault(
                    "Cannot delete the last vault profile. Reset it instead to clear its contents.".into()
                ));
            }
        }

        {
            let profiles = self.profiles.lock().unwrap();
            if let Some(p) = profiles.profiles.iter().find(|p| p.id == id) {
                let vault_path = self.data_dir.join(&p.file_name);
                if vault_path.exists() {
                    std::fs::remove_file(&vault_path)?;
                }
            }
        }

        let new_active = {
            let mut profiles = self.profiles.lock().unwrap();
            profiles.profiles.retain(|p| p.id != id);
            let mut vaults = self.vaults.lock().unwrap();
            vaults.remove(id);

            if profiles.active_id == id {
                let first = profiles.profiles.first().map(|p| p.id.clone()).unwrap_or_else(|| "default".into());
                profiles.active_id = first.clone();
                first
            } else {
                profiles.active_id.clone()
            }
        };

        let _ = new_active;
        self.save_profiles()?;
        Ok(())
    }

    pub fn rename_profile(&self, id: &str, name: String, color: String, icon: String) -> PylonResult<()> {
        let mut profiles = self.profiles.lock().unwrap();
        if let Some(p) = profiles.profiles.iter_mut().find(|p| p.id == id) {
            p.name = name;
            p.color = color;
            p.icon = icon;
            drop(profiles);
            return self.save_profiles();
        }
        Err(PylonError::Vault(format!("Profile '{id}' not found")))
    }

    pub fn exists(&self) -> bool {
        self.active_vault().map(|v| v.exists()).unwrap_or(false)
    }

    pub fn create(&self, passphrase: &str) -> PylonResult<()> {
        self.active_vault()?.create(passphrase)
    }

    pub fn unlock(&self, passphrase: &str) -> PylonResult<()> {
        self.active_vault()?.unlock(passphrase)
    }

    pub fn lock(&self) {
        if let Ok(v) = self.active_vault() {
            v.lock();
        }
    }

    pub fn lock_all(&self) {
        for v in self.vaults.lock().unwrap().values() {
            v.lock();
        }
    }

    pub fn is_unlocked(&self) -> bool {
        self.active_vault().map(|v| v.is_unlocked()).unwrap_or(false)
    }

    pub fn reset(&self) -> PylonResult<()> {
        self.active_vault()?.reset()
    }

    pub fn change_passphrase(&self, current: &str, new: &str) -> PylonResult<()> {
        self.active_vault()?.change_passphrase(current, new)
    }

    pub fn add_credential(&self, cred: Credential) -> PylonResult<String> {
        self.active_vault()?.add_credential(cred)
    }

    pub fn update_credential(&self, cred: Credential) -> PylonResult<()> {
        self.active_vault()?.update_credential(cred)
    }

    pub fn touch(&self, id: &str) {
        if let Ok(v) = self.active_vault() {
            v.touch(id);
        }
    }

    pub fn get_credential(&self, id: &str) -> PylonResult<Credential> {
        self.active_vault()?.get_credential_with_secret(id).map(|c| c.redacted())
    }

    pub fn get_credential_with_secret(&self, id: &str) -> PylonResult<Credential> {
        self.active_vault()?.get_credential_with_secret(id)
    }

    pub fn list_credentials(&self) -> PylonResult<Vec<Credential>> {
        self.active_vault()?.list_credentials()
    }

    pub fn delete_credential(&self, id: &str) -> PylonResult<()> {
        self.active_vault()?.delete_credential(id)
    }
}
