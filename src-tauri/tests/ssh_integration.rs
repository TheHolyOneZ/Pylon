use pylon_lib::{sftp, ssh};

fn env() -> Option<(String, u16, String, std::path::PathBuf)> {
    let v = std::env::var("PYLON_TEST_SSH").ok()?;
    let mut p = v.splitn(4, ':');
    Some((p.next()?.into(), p.next()?.parse().ok()?, p.next()?.into(), p.next()?.into()))
}

fn auth(key: &str, pass: Option<&str>) -> Option<ssh::AuthParams> {
    let (host, port, user, dir) = env()?;
    Some(ssh::AuthParams {
        host,
        port,
        username: user,
        private_key: Some(dir.join(key).to_string_lossy().into_owned()),
        key_passphrase: pass.map(Into::into),
        ..Default::default()
    })
}

#[test]
fn key_auth_variants() {
    let Some(a) = auth("user_ed25519", None) else { return };
    ssh::open_pinned(&a).expect("ed25519 from path");

    let Some(mut a) = auth("user_ed25519_pass", None) else { return };
    let e = ssh::open_pinned(&a).err().expect("needs passphrase").to_string();
    assert!(e.contains("passphrase"), "{e}");
    a.key_passphrase = Some("wrong".into());
    assert!(ssh::open_pinned(&a).is_err());
    a.key_passphrase = Some("secret123".into());
    ssh::open_pinned(&a).expect("encrypted key with passphrase");

    let Some(mut a) = auth("user_rsa_pem", None) else { return };
    let text = std::fs::read_to_string(a.private_key.as_ref().unwrap()).unwrap().replace('\n', "\r\n");
    a.private_key = Some(text);
    ssh::open_pinned(&a).expect("RSA PEM text with CRLF");
}

#[test]
fn pinned_fingerprint_is_enforced() {
    let Some(mut a) = auth("user_ed25519", None) else { return };
    a.expected_fingerprint = Some("SHA256:not-the-real-key".into());
    let e = ssh::open_pinned(&a).err().expect("must refuse").to_string();
    assert!(e.contains("changed"), "{e}");
}

#[test]
fn sftp_operations() {
    let Some(a) = auth("user_ed25519", None) else { return };
    let conn = ssh::open_pinned(&a).unwrap();
    let base = format!("{}/pylon-it-{}", std::env::temp_dir().display(), std::process::id());
    sftp::mkdir_p(&conn, &format!("{base}/a/b")).unwrap();
    sftp::write_file(&conn, &format!("{base}/a/b/f.txt"), b"hello").unwrap();
    assert_eq!(sftp::read_file(&conn, &format!("{base}/a/b/f.txt"), 1024).unwrap(), b"hello");
    assert!(sftp::exists(&conn, &format!("{base}/a")).unwrap());
    assert!(!sftp::exists(&conn, &format!("{base}/nope")).unwrap());
    sftp::write_file(&conn, &format!("{base}/a/g.txt"), b"x").unwrap();
    let e = sftp::rename(&conn, &format!("{base}/a/g.txt"), &format!("{base}/a/b/f.txt")).unwrap_err();
    assert!(e.to_string().contains("already exists"));
    std::os::unix::fs::symlink("/usr", format!("{base}/a/link")).unwrap();
    let list = sftp::list_dir(&conn, &format!("{base}/a")).unwrap();
    let link = list.iter().find(|e| e.name == "link").unwrap();
    assert!(link.is_symlink && link.is_dir);
    sftp::recursive_delete(&conn, &base).unwrap();
    assert!(!std::path::Path::new(&base).exists());
    assert!(std::path::Path::new("/usr/bin").exists());
    let e = sftp::list_dir(&conn, "/definitely/not/here").unwrap_err().to_string();
    assert!(e.contains("no such file"), "{e}");
}
