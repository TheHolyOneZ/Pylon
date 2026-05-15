# Changelog

## [0.2.0] — 15.05.2026

### Fixed

#### SSH Handshake `[Session(-1)] Unable to exchange encryption keys` on Windows

**Root cause:** `libssh2-sys` on Windows MSVC has two separate feature flags:
- `vendored-openssl` — compiles OpenSSL from source (was already set)
- `openssl-on-win32` — tells libssh2 to **use** OpenSSL as its crypto backend (was missing)

Without `openssl-on-win32`, libssh2 always compiles with **WinCNG** (Windows Cryptography
Next Generation) as its backend, regardless of whether OpenSSL is present. WinCNG's
Diffie-Hellman key exchange implementation has been broken since Windows 10 v1903 (May 2019),
causing the server to close the connection mid-handshake. libssh2 surfaces this as
`LIBSSH2_ERROR_SOCKET_NONE = -1` with the message "Unable to exchange encryption keys".

macOS was unaffected because non-Windows targets unconditionally use OpenSSL.

**Fix (`src-tauri/Cargo.toml`):**
```toml
ssh2 = { version = "0.9", features = ["vendored-openssl", "openssl-on-win32"] }
```

Adding `openssl-on-win32` sets `CARGO_FEATURE_OPENSSL_ON_WIN32` during the libssh2-sys build,
which switches the compile-time define from `LIBSSH2_WINCNG` to `LIBSSH2_OPENSSL`.

**Additional hardening (all 4 handshake sites):**
- Removed pre-handshake TCP `set_read_timeout`/`set_write_timeout` — once libssh2 owns the
  socket via `set_tcp_stream`, Winsock-level timeouts conflict with libssh2's internal I/O loop.
- Added `sess.set_blocking(true)` + `sess.set_timeout(30_000)` — proper libssh2-level
  30 s timeout that works correctly on both Windows and macOS.

**Build requirement (Windows):** Strawberry Perl must be in PATH for the `vendored-openssl`
build step that compiles OpenSSL from source. Install portable Perl to `C:\strawberry-perl`
and add `C:\strawberry-perl\perl\bin` and `C:\strawberry-perl\c\bin` to the system PATH.

---

#### Host Key Policy settings not respected in Vault and Quick Connect

**Problems:**
1. ZVault quick-connect always showed "accept via Quick Connect first" regardless of the
   host key policy setting in Settings → Security.
2. There was no way to accept an unknown host key from ZVault without switching to Quick Connect.
3. The Advanced panel in Quick Connect hardcoded "Ask (known_hosts)" instead of showing
   the live policy value.

**Fix:**
- Added `vault_accept_host_key_and_connect(credential_id, permanent)` Rust command that
  performs a fresh TCP connect + handshake + optional `known_hosts` write + authentication
  using vault-stored credentials (secrets never leave the backend).
- `VaultModal` now reads `hostKeyPolicy` from the settings store on every vault connect:
  - `auto-accept` → silently calls `vaultAcceptHostKeyAndConnect` with `permanent: false`
  - `strict` → rejects immediately with an error toast
  - `ask` (default) → shows the same `HostKeyModal` used by Quick Connect, then calls
    `vaultAcceptHostKeyAndConnect` with the user's permanent/once choice
- `ConnectModal` advanced panel now reads and displays the live policy value.

---

#### App icon not rendering in titlebar and lock screen on Windows

**Problem:** The custom titlebar, app lock screen, and settings panel all load `/pylon-icon.png`
via a root-relative URL. No `public/` directory existed in the project, so Vite had no file
to serve at that path — the `<img>` broke in both dev and production builds.

**Fix:** Created `public/pylon-icon.png` (copied from `src-tauri/icons/icon.png`). Vite serves
the `public/` directory verbatim at the root URL, so the existing `/pylon-icon.png` references
in `TitleBar.tsx`, `AppLock.tsx`, and `SettingsPanel.tsx` now resolve correctly in both modes.

---

#### Installer and bundle still named `Pylon_0.1.0_*` after version bump

**Problem:** `src-tauri/tauri.conf.json` still contained `"version": "0.1.0"`. This is the file
the Tauri bundler reads when naming build artifacts (`Pylon_0.1.0_x64-setup.exe`,
`pylon_0.1.0_x64_en-US.msi`). Updating only `package.json` and `Cargo.toml` had no effect
on the installer names.

**Fix:** Bumped `tauri.conf.json` version to `0.2.0`. Also updated the hardcoded `v0.1` badge
in `TitleBar.tsx` to `v0.2`.

---

#### Rust compiler warning: unused variable `mirror_perms` in `fs_watcher.rs`

**Problem:** `push_file_via_sftp` in `src-tauri/src/fs_watcher.rs:572` accepted a
`mirror_perms: bool` parameter that was never read (permission mirroring not yet implemented
for that path).

**Fix:** Renamed to `_mirror_perms` to explicitly mark the parameter as intentionally unused,
silencing the `#[warn(unused_variables)]` warning.
