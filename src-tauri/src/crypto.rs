use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};

use crate::error::{PylonError, PylonResult};

pub const SALT_LEN: usize = 32;
pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 12;

#[derive(Serialize, Deserialize, Clone)]
pub struct EncryptedBlob {
    pub salt: String,

    pub nonce: String,

    pub ciphertext: String,
}

pub fn derive_key(passphrase: &str, salt: &[u8]) -> PylonResult<[u8; KEY_LEN]> {
    let argon2 = Argon2::default();
    let mut key = [0u8; KEY_LEN];

    argon2
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| PylonError::Crypto(format!("Key derivation failed: {e}")))?;
    Ok(key)
}

pub fn encrypt(passphrase: &str, plaintext: &[u8]) -> PylonResult<EncryptedBlob> {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);

    let key_bytes = derive_key(passphrase, &salt)?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| PylonError::Crypto(format!("Encryption failed: {e}")))?;

    Ok(EncryptedBlob {
        salt: B64.encode(salt),
        nonce: B64.encode(nonce),
        ciphertext: B64.encode(ciphertext),
    })
}

pub fn decrypt(passphrase: &str, blob: &EncryptedBlob) -> PylonResult<Vec<u8>> {
    let salt = B64
        .decode(&blob.salt)
        .map_err(|e| PylonError::Crypto(format!("Bad salt encoding: {e}")))?;
    let nonce_bytes = B64
        .decode(&blob.nonce)
        .map_err(|e| PylonError::Crypto(format!("Bad nonce encoding: {e}")))?;
    let ciphertext = B64
        .decode(&blob.ciphertext)
        .map_err(|e| PylonError::Crypto(format!("Bad ciphertext encoding: {e}")))?;

    let key_bytes = derive_key(passphrase, &salt)?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| PylonError::Crypto("Decryption failed — wrong passphrase or corrupt data".into()))?;

    Ok(plaintext)
}

pub fn encrypt_with_key(key: &[u8; KEY_LEN], plaintext: &[u8]) -> PylonResult<Vec<u8>> {
    let key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| PylonError::Crypto(format!("Encryption failed: {e}")))?;

    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn decrypt_with_key(key: &[u8; KEY_LEN], data: &[u8]) -> PylonResult<Vec<u8>> {
    if data.len() < NONCE_LEN {
        return Err(PylonError::Crypto("Data too short".into()));
    }
    let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
    let key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| PylonError::Crypto("Decryption failed".into()))
}

pub fn generate_key() -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    key
}
