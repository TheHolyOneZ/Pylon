pub mod commands;
pub mod crypto;
pub mod error;
pub mod fs_watcher;
pub mod known_hosts;
pub mod metadata;
pub mod session;
pub mod sftp;
pub mod ssh;
pub mod ssh_config;
pub mod terminal;
pub mod transfer;
pub mod vault;
pub mod vault_manager;
pub mod watcher_store;

use std::path::PathBuf;
use tauri::Manager;
use tracing_subscriber::{fmt, EnvFilter};

pub fn run() {
    let default_level = if cfg!(debug_assertions) { "pylon_lib=debug" } else { "pylon_lib=info" };
    let _ = fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_level)))
        .try_init();

    let data_dir: PathBuf = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("pylon");

    let watcher_store = watcher_store::WatcherStore::new(&data_dir);
    let persisted = watcher_store.load();
    let suspended_registry = watcher_store::SuspendedWatcherRegistry::new(persisted);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(session::SessionRegistry::new())
        .manage(transfer::TransferRegistry::new())
        .manage(terminal::TerminalRegistry::new())
        .manage(fs_watcher::WatcherRegistry::new())
        .manage(watcher_store)
        .manage(suspended_registry)
        .manage(vault_manager::VaultManager::new(data_dir))
        .invoke_handler(tauri::generate_handler![
            commands::connection::connect,
            commands::connection::accept_host_key_and_connect,
            commands::connection::disconnect,
            commands::connection::list_connections,
            commands::connection::test_connection,
            commands::connection::get_connection_status,
            commands::connection::list_ssh_config_hosts,
            commands::sftp::remote_path_exists,
            commands::sftp::remote_paths_exist,

            commands::sftp::list_remote_dir,
            commands::sftp::read_remote_file,
            commands::sftp::write_remote_file,
            commands::sftp::delete_remote,
            commands::sftp::delete_batch,
            commands::sftp::rename_remote,
            commands::sftp::create_remote_dir,
            commands::sftp::create_remote_dir_recursive,
            commands::sftp::stat_remote,
            commands::sftp::chmod_remote,
            commands::sftp::chown_remote,
            commands::sftp::create_symlink_remote,
            commands::sftp::read_symlink_remote,
            commands::sftp::resolve_path_remote,
            commands::sftp::list_remote_recursive,

            commands::transfer::upload_file,
            commands::transfer::upload_file_clean,
            commands::transfer::download_file,
            commands::transfer::upload_batch,
            commands::transfer::upload_directory,
            commands::transfer::download_directory,
            commands::transfer::cancel_transfer,
            commands::transfer::cancel_batch,
            commands::transfer::clear_finished_transfers,
            commands::transfer::pause_transfer,
            commands::transfer::resume_transfer_cmd,
            commands::transfer::set_transfer_rate_limit,
            commands::transfer::list_transfers,

            commands::terminal::create_terminal,
            commands::terminal::terminal_input,
            commands::terminal::resize_terminal,
            commands::terminal::close_terminal,

            commands::metadata::strip_file_metadata,
            commands::metadata::strip_file_metadata_preview,
            commands::metadata::get_file_metadata,

            commands::sync::start_sync,
            commands::sync::stop_sync,
            commands::sync::list_syncs,
            commands::sync::update_sync_config,
            commands::sync::update_sync_rule,
            commands::sync::update_sync_keep_on_disconnect,
            commands::sync::update_sync_dry_run,
            commands::sync::confirm_sync_operation,
            commands::sync::list_suspended_syncs,
            commands::sync::delete_suspended_sync,

            commands::vault::vault_list_profiles,
            commands::vault::vault_active_profile_id,
            commands::vault::vault_select_profile,
            commands::vault::vault_create_profile,
            commands::vault::vault_delete_profile,
            commands::vault::vault_rename_profile,
            commands::vault::vault_exists,
            commands::vault::vault_create,
            commands::vault::vault_change_passphrase,
            commands::vault::vault_unlock,
            commands::vault::vault_lock,
            commands::vault::vault_reset,
            commands::vault::vault_add_credential,
            commands::vault::vault_update_credential,
            commands::vault::vault_get_credential,
            commands::vault::vault_list_credentials,
            commands::vault::vault_delete_credential,
            commands::vault::vault_is_unlocked,
            commands::vault::vault_connect,
            commands::vault::vault_accept_host_key_and_connect,

            commands::local_fs::list_local_dir,
            commands::local_fs::get_local_drives,
            commands::local_fs::open_in_file_manager,
            commands::local_fs::get_home_dir,
            commands::local_fs::path_join,
            commands::local_fs::get_platform,
            commands::local_fs::local_path_exists,
            commands::local_fs::delete_local_path,
            commands::local_fs::delete_local_batch,
            commands::local_fs::local_paths_exist,
            commands::local_fs::local_is_dir,
            commands::local_fs::create_local_dir,
            commands::local_fs::rename_local,
            commands::local_fs::reveal_in_file_manager,
            commands::local_fs::read_text_file,
            commands::local_fs::move_local,

            commands::snippets::list_snippets,
            commands::snippets::save_snippet,
            commands::snippets::delete_snippet,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            if std::env::var_os("PYLON_DEVTOOLS").is_some() {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            let _ = app;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Pylon failed to start")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let reg = app.state::<session::SessionRegistry>();
                for info in reg.list_infos() {
                    reg.remove(&info.id);
                }
            }
        });
}
