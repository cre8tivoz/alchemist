# Sentinel Security Journal

## 2025-05-18 - Atomic File Creation Permissions for Secrets Store
**Vulnerability:** In `secret_store.rs`, `fs::write` created `secrets.json` with standard default permissions before `fs::set_permissions` restricted them to `0o600`. On Unix systems, this created a race condition window where API keys were temporarily readable by other local users on multi-user systems.
**Learning:** `fs::write` or `File::create` relies on system umask and does not set restricted mode atomically upon file creation.
**Prevention:** Use `fs::OpenOptions` with `options.mode(0o600)` on Unix platforms (`std::os::unix::fs::OpenOptionsExt`) so that file creation and permission assignment are atomic. Also synchronize tests operating on shared local storage files using a `Mutex`.
