fn main() {
    #[cfg(windows)]
    {
        let has_perl = std::process::Command::new("perl").arg("-v").output().map(|o| o.status.success()).unwrap_or(false);
        if !has_perl && std::env::var_os("OPENSSL_DIR").is_none() {
            println!("cargo:warning=perl not found on PATH: the vendored OpenSSL build needs Perl (install Strawberry Perl) — see README");
        }
    }
    tauri_build::build()
}
