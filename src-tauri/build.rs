fn main() {
    #[cfg(windows)]
    check_windows_openssl();
    tauri_build::build()
}

#[cfg(windows)]
fn check_windows_openssl() {
    // Already configured via env var — nothing to do.
    if std::env::var("OPENSSL_DIR").is_ok() {
        return;
    }

    let default_paths = [
        "C:/Program Files/OpenSSL-Win64",
        "C:/Program Files/OpenSSL",
        "C:/OpenSSL-Win64",
        "C:/OpenSSL",
    ];

    let found = default_paths
        .iter()
        .any(|p| std::path::Path::new(p).join("include").exists());

    if !found {
        panic!(
            "\n\n\
             ╔══════════════════════════════════════════════════════════════╗\n\
             ║  OpenSSL not found — required for SSH on Windows             ║\n\
             ║                                                              ║\n\
             ║  Install it (one-time):                                      ║\n\
             ║    winget install ShiningLight.OpenSSL                       ║\n\
             ║  or:                                                         ║\n\
             ║    choco install openssl                                     ║\n\
             ║                                                              ║\n\
             ║  Then restart your terminal and run the build again.         ║\n\
             ║  If installed to a custom path, set:                         ║\n\
             ║    $env:OPENSSL_DIR = 'C:/path/to/OpenSSL-Win64'            ║\n\
             ╚══════════════════════════════════════════════════════════════╝\n\
             \n"
        );
    }
}
