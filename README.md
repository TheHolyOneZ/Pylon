# Pylon

Cross-platform SSH and SFTP desktop client built with [Tauri v2](https://tauri.app), Rust, and React.

**License:** GPL-3.0 | **Version:** 0.1.0 (beta) | **Platforms:** Windows, macOS, Linux

> Pylon is in beta. The vault format and configuration schema may change between pre-release versions. Back up your vault before upgrading.

---

## Features

### File Management

- Dual-pane browser: local filesystem on the left, remote SFTP on the right, resizable
- Multi-select with Shift+Click (range), Ctrl+Click (individual), Ctrl+A (all)
- Drag-and-drop upload and download between panes
- Context menu with full file operations
- Sortable columns (name, size, modified, permissions)
- Editable path bar (Ctrl+L), click-to-navigate breadcrumb, bookmarks
- File permission display (octal and rwx notation)
- Regex and fuzzy filter per pane
- Remote chmod editor

### Transfer Engine

- Resume support: interrupted transfers restart from the last verified byte
- Atomic writes: files staged as `.pylon_tmp_*` and renamed on completion
- SHA-256 checksumming per transfer
- Real-time bytes/sec and ETA in the transfer drawer (Ctrl+T)
- Pause, resume, and retry controls per transfer
- Concurrent transfers (1–16, configurable)
- Optional per-transfer bandwidth limit (kbps)
- Recursive directory upload/download
- Overwrite policy: ask / overwrite all / skip all

### SSH Terminal

- xterm.js with full VT100/ANSI, 256-color support
- Multiple terminal tabs per session, with tab rename
- Navigating the remote pane sends a `cd` command to the active terminal
- Command snippets toolbar (save frequently used commands as quick-launch buttons)
- Clickable URLs via xterm-addon-web-links
- Shell selection (bash, zsh, sh, fish) per connection

### ZVault — Credential Manager

- AES-256-GCM encryption for all stored credentials
- Argon2id key derivation from master passphrase (m=64 MB, t=3, p=4)
- Unique random salt and nonce per vault; no pre-computation attacks apply
- Auto-lock after configurable idle timeout
- Decrypted credentials kept in memory only; never written to disk in plaintext
- SSH key path storage alongside passwords
- Full CRUD UI for managing stored profiles

### Sync Watchers

- Watch a local directory and sync changes to a remote path over SFTP
- Powered by the `notify` crate (inotify / kqueue / ReadDirectoryChangesW)
- Only changed files are uploaded; unchanged files are skipped
- 100 ms debounce window to coalesce rapid saves
- Delete propagation: remote files are deleted when local files are removed
- Optional timestamp preservation (mtime mirrored to remote)
- Optional permission mirroring (chmod applied to remote)
- `.syncignore` file support (gitignore syntax); `.gitignore` is also respected
- Keep-on-disconnect: watchers can be paused rather than stopped when a session ends
- Configurable overwrite rules: always overwrite / new files only / update existing / confirm on overwrite / confirm all

### Metadata Stripping

Strip privacy-sensitive metadata in-flight on upload, or on-demand via context menu.

| Format | Stripped |
|---|---|
| JPEG / PNG / WebP / GIF | EXIF data (GPS, camera, serial, timestamps, thumbnails) |
| PDF | Author, creator, producer, keywords, XMP metadata |

Enable globally in Settings → Security, or trigger per-file from the context menu.

### Security

- SSH host key verification against `~/.ssh/known_hosts` on every connection
- Changed host keys show a blocking warning dialog (configurable policy: ask / auto-accept / strict)
- SSH keepalive prevents silent session drops
- No telemetry; no outbound connections beyond what you explicitly initiate
- Tauri CSP configured in `src-tauri/capabilities/default.json`

### Other

- Command palette (Ctrl+K)
- Activity log
- Keyboard shortcuts for all major actions
- Bookmarks for local and remote paths

---

## Building

### Prerequisites

| Tool | Required version |
|---|---|
| Rust | stable ≥ 1.77 |
| Node.js | ≥ 20 LTS |
| pnpm | ≥ 9 |

**Linux** — install WebKit2GTK and related system libraries:

```bash
# Debian / Ubuntu
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

# Fedora / RHEL
sudo dnf install webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel
```

**macOS** — Xcode Command Line Tools:

```bash
xcode-select --install
```

### Dev

```bash
pnpm install
pnpm tauri dev
```

Frontend only (no Rust compilation, faster iteration):

```bash
pnpm dev
```

Verbose Rust logging:

```bash
RUST_LOG=debug pnpm tauri dev
```

### Release build

```bash
pnpm install
pnpm tauri build
```

Artifacts are placed in `src-tauri/target/release/bundle/`.

---

## Keyboard Shortcuts

### Global

| Shortcut | Action |
|---|---|
| Ctrl+K | Command palette |
| Ctrl+N | New connection |
| Ctrl+T | Toggle transfer drawer |
| Ctrl+D | Disconnect active session |

### File browser

| Shortcut | Action |
|---|---|
| F5 | Refresh pane |
| Ctrl+A | Select all |
| Ctrl+L | Edit path bar |
| Enter | Open folder / download file |
| Backspace | Navigate up |

### Terminal

| Shortcut | Action |
|---|---|
| Ctrl+Shift+T | New terminal tab |
| Ctrl+Shift+C | Copy selection |
| Ctrl+Shift+V | Paste |

---

## Tech Stack

**Frontend:** React 18, TypeScript 5, Vite 5, Tailwind CSS 3, Zustand, Framer Motion, xterm.js 5, Lucide React, react-resizable-panels

**Backend (Rust):** tauri 2, ssh2, tokio, aes-gcm, argon2, notify, image, kamadak-exif, lopdf, sha2, ignore, rayon, flume, serde, anyhow, tracing

---

## Vault file location

| Platform | Path |
|---|---|
| Linux | `~/.config/pylon/vault-default.json` |
| macOS | `~/Library/Application Support/pylon/vault-default.json` |
| Windows | `%APPDATA%\pylon\vault-default.json` |

If you forget your master password there is no recovery mechanism. The vault cannot be decrypted without the correct passphrase.

---

## macOS note

Pylon is not yet notarized by Apple. On first launch, right-click the `.app` and choose Open, then confirm in the security dialog.

---

## License

GNU General Public License v3.0. See [LICENSE](LICENSE).
