//! API key storage with a cross-platform local fallback.
//! Keys are stored securely in system keyring / keychain via `keyring` crate when available.
//! Everywhere, keys are written to ~/.alchemist/secrets.json as a local fallback so they survive.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use keyring::Entry;

use crate::paths::user_home;

const KEYCHAIN_SERVICE: &str = "alchemist";

fn secrets_path() -> PathBuf {
    user_home().join(".alchemist").join("secrets.json")
}

fn load_secrets() -> HashMap<String, String> {
    let path = secrets_path();
    if !path.exists() {
        return HashMap::new();
    }
    let content = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_secrets(secrets: &HashMap<String, String>) -> Result<(), String> {
    let path = secrets_path();
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    }
    let content = serde_json::to_string_pretty(secrets)
        .map_err(|e| format!("Failed to serialize secrets: {}", e))?;

    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    let mut file = options
        .open(&path)
        .map_err(|e| format!("Failed to open secrets file: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }

    use std::io::Write;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to save secrets: {}", e))?;
    Ok(())
}

/// Store an API key.
/// Tries system keyring (silently ignores errors) and always writes to local ~/.alchemist/secrets.json using account as key.
pub fn store_key(account: &str, password: &str) -> Result<(), String> {
    let clean_password = password.trim();
    if clean_password.is_empty() {
        return delete_key(account);
    }

    // Keyring attempt - ignore errors completely to prevent failing if system keyring is unavailable
    if let Ok(entry) = Entry::new(KEYCHAIN_SERVICE, account) {
        let _ = entry.set_password(clean_password);
    }

    // Always write to local fallback file
    let mut secrets = load_secrets();
    secrets.insert(account.to_string(), clean_password.to_string());
    save_secrets(&secrets)
}

/// Retrieve an API key.
/// First tries system keyring, falls back to local ~/.alchemist/secrets.json
pub fn get_key(account: &str) -> Result<String, String> {
    // Try keyring first
    if let Ok(entry) = Entry::new(KEYCHAIN_SERVICE, account) {
        if let Ok(password) = entry.get_password() {
            let trimmed = password.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }
    }

    // Fallback to local file
    let secrets = load_secrets();
    if let Some(key) = secrets.get(account) {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    Err(format!("No key stored for '{}'", account))
}

/// Delete an API key from both keyring (best effort) and local secrets file.
pub fn delete_key(account: &str) -> Result<(), String> {
    // Keyring delete - ignore errors
    if let Ok(entry) = Entry::new(KEYCHAIN_SERVICE, account) {
        let _ = entry.delete_credential();
    }

    // Remove from local file
    let mut secrets = load_secrets();
    if secrets.remove(account).is_some() {
        save_secrets(&secrets)?;
    }
    Ok(())
}

/// Check if a key exists (keyring or local fallback).
pub fn has_key(account: &str) -> bool {
    get_key(account).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn test_secret_store_lifecycle() {
        let _guard = TEST_LOCK.lock().unwrap();
        let test_account = "test_account_secret_store_unit_test";
        let test_secret = "test_secret_val_12345";

        // Clean up before starting test
        let _ = delete_key(test_account);
        assert!(!has_key(test_account));

        // Store key
        assert!(store_key(test_account, test_secret).is_ok());

        // Has key and Get key
        assert!(has_key(test_account));
        let retrieved = get_key(test_account).expect("Should retrieve key");
        assert_eq!(retrieved, test_secret);

        // Delete key
        assert!(delete_key(test_account).is_ok());
        assert!(!has_key(test_account));
        assert!(get_key(test_account).is_err());
    }

    #[test]
    #[cfg(unix)]
    fn test_secrets_file_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let _guard = TEST_LOCK.lock().unwrap();
        let test_account = "test_account_permissions";
        let _ = store_key(test_account, "secret123");
        let metadata = fs::metadata(secrets_path()).expect("secrets file exists");
        assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
        let _ = delete_key(test_account);
    }

    #[test]
    fn test_secret_store_sanitization_and_validation() {
        let _guard = TEST_LOCK.lock().unwrap();
        let test_account = "test_account_sanitization";

        let _ = delete_key(test_account);

        // Storing empty or whitespace-only keys deletes/clears the key
        assert!(store_key(test_account, "\n  sk_live_123456789  \r\n").is_ok());
        assert!(has_key(test_account));

        assert!(store_key(test_account, "   \n\t  ").is_ok());
        assert!(!has_key(test_account));

        // Trim leading/trailing whitespace and newlines when saving non-empty key
        assert!(store_key(test_account, "\n  sk_live_123456789  \r\n").is_ok());
        let retrieved = get_key(test_account).expect("retrieve key");
        assert_eq!(retrieved, "sk_live_123456789");

        let _ = delete_key(test_account);
    }
}
