import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../stores/settingsStore";
import {
  BatchResult,
  ConnectionInfo,
  Credential,
  HostKeyVerification,
  LocalEntry,
  MetadataField,
  MetadataReport,
  PersistedWatcherConfig,
  RemoteEntry,
  Snippet,
  SyncConfig,
  SyncRule,
  TransferRecord,
} from "../types";
import { joinLocal, normalizeSeparators } from "./path";

export function normalizePath(p: string): string {
  return normalizeSeparators(p);
}

export function joinLocalPath(parent: string, child: string): string {
  return joinLocal(parent, child);
}

export interface ConnectResult {
  status: "connected" | "host_key_unknown" | "host_key_changed";
  info?: ConnectionInfo;
  verification?: HostKeyVerification;
}

export interface AuthArgs {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  keyPassphrase?: string;
}

export interface TestResult {
  success: boolean;
  reason?: "host_key_unknown" | "host_key_changed";
  fingerprint?: string;
  key_type?: string;
  latency_ms: number;
  server_version?: string | null;
}

function transferPrefs() {
  const { bandwidthLimitKbps, defaultChunkKb, maxConcurrentTransfers, autoVerifyChecksum } = useSettingsStore.getState();
  return {
    verify: autoVerifyChecksum,
    bandwidthKbps: bandwidthLimitKbps > 0 ? bandwidthLimitKbps : null,
    chunkKb: defaultChunkKb > 0 ? defaultChunkKb : null,
    maxWorkers: maxConcurrentTransfers,
  };
}

export const connect = (args: AuthArgs & { label: string }) => invoke<ConnectResult>("connect", { ...args });

export const acceptHostKeyAndConnect = (args: AuthArgs & { label: string; fingerprint: string; permanent: boolean }) =>
  invoke<ConnectionInfo>("accept_host_key_and_connect", { ...args });

export const disconnect = (sessionId: string) => invoke<void>("disconnect", { sessionId });
export const listConnections = () => invoke<ConnectionInfo[]>("list_connections");
export const testConnection = (args: AuthArgs) => invoke<TestResult>("test_connection", { ...args });
export const listSshConfigHosts = () => invoke<import("../types").SshConfigHost[]>("list_ssh_config_hosts");

export const listRemoteDir = (sessionId: string, path: string) => invoke<RemoteEntry[]>("list_remote_dir", { sessionId, path });
export const readRemoteFile = (sessionId: string, path: string) =>
  invoke<ArrayBuffer>("read_remote_file", { sessionId, path });
export const writeRemoteFile = (sessionId: string, path: string, data: number[]) =>
  invoke<void>("write_remote_file", { sessionId, path, data });
export const deleteRemote = (sessionId: string, path: string, isDir: boolean, recursive = false) =>
  invoke<void>("delete_remote", { sessionId, path, isDir, recursive });
export const deleteBatch = (sessionId: string, paths: [string, boolean][]) => invoke<void>("delete_batch", { sessionId, paths });
export const renameRemote = (sessionId: string, from: string, to: string) => invoke<void>("rename_remote", { sessionId, from, to });
export const createRemoteDir = (sessionId: string, path: string) => invoke<void>("create_remote_dir", { sessionId, path });
export const statRemote = (sessionId: string, path: string) => invoke<RemoteEntry>("stat_remote", { sessionId, path });
export const remotePathExists = (sessionId: string, path: string) => invoke<boolean>("remote_path_exists", { sessionId, path });
export const remotePathsExist = (sessionId: string, paths: string[]) => invoke<boolean[]>("remote_paths_exist", { sessionId, paths });
export const resolvePathRemote = (sessionId: string, path: string) => invoke<string>("resolve_path_remote", { sessionId, path });
export const chmodRemote = (sessionId: string, path: string, mode: number) => invoke<void>("chmod_remote", { sessionId, path, mode });

export const uploadFile = (sessionId: string, localPath: string, remotePath: string, stripMetadata = false) => {
  const { bandwidthKbps, chunkKb, verify } = transferPrefs();
  return invoke<string>("upload_file", { sessionId, localPath, remotePath, stripMetadata, bandwidthKbps, chunkKb, verify });
};
export const uploadFileClean = (sessionId: string, localPath: string, remotePath: string) =>
  uploadFile(sessionId, localPath, remotePath, true);

export const downloadFile = (sessionId: string, remotePath: string, localPath: string) => {
  const { bandwidthKbps, chunkKb, verify } = transferPrefs();
  return invoke<string>("download_file", { sessionId, remotePath, localPath, bandwidthKbps, chunkKb, verify });
};

export const uploadDirectory = (sessionId: string, localDir: string, remoteDir: string, stripMetadata = false) =>
  invoke<BatchResult>("upload_directory", { sessionId, localDir, remoteDir, stripMetadata, ...transferPrefs() });

export const downloadDirectory = (sessionId: string, remoteDir: string, localDir: string) =>
  invoke<BatchResult>("download_directory", { sessionId, remoteDir, localDir, ...transferPrefs() });

export const cancelTransfer = (transferId: string) => invoke<void>("cancel_transfer", { transferId });
export const cancelBatch = (batchId: string) => invoke<void>("cancel_batch", { batchId });
export const pauseTransfer = (transferId: string) => invoke<void>("pause_transfer", { transferId });
export const resumeTransferCmd = (transferId: string) => invoke<void>("resume_transfer_cmd", { transferId });
export const listTransfers = () => invoke<TransferRecord[]>("list_transfers");
export const clearFinishedTransfers = () => invoke<void>("clear_finished_transfers");

export const createTerminal = (sessionId: string, cols: number, rows: number, shell?: string | null) =>
  invoke<string>("create_terminal", { sessionId, cols, rows, shell: shell || null });
export const terminalInput = (terminalId: string, data: string) => invoke<void>("terminal_input", { terminalId, data });
export const resizeTerminal = (terminalId: string, cols: number, rows: number) =>
  invoke<void>("resize_terminal", { terminalId, cols, rows });
export const closeTerminal = (terminalId: string) => invoke<void>("close_terminal", { terminalId });

export const stripFileMetadata = (localPath: string) => invoke<MetadataReport>("strip_file_metadata", { localPath });
export const stripFileMetadataPreview = (localPath: string) => invoke<MetadataReport>("strip_file_metadata_preview", { localPath });
export const getFileMetadata = (localPath: string) => invoke<MetadataField[]>("get_file_metadata", { localPath });

export const startSync = (args: {
  sessionId: string;
  localRoot: string;
  remoteRoot: string;
  label: string;
  stripMetadata: boolean;
  preserveTimestamps?: boolean;
  mirrorPermissions?: boolean;
  excludePatterns?: string[];
  rule?: SyncRule;
  protectedPatterns?: string[];
  dryRun?: boolean;
  maxFileSizeKb?: number | null;
  syncDeletes?: boolean;
  initialSyncOnly?: boolean;
  keepOnDisconnect?: boolean;
  replaceId?: string;
}) =>
  invoke<SyncConfig>("start_sync", {
    ...args,
    preserveTimestamps: args.preserveTimestamps ?? false,
    mirrorPermissions: args.mirrorPermissions ?? false,
    excludePatterns: args.excludePatterns ?? [],
    rule: args.rule ?? "always_overwrite",
    protectedPatterns: args.protectedPatterns ?? [],
    dryRun: args.dryRun ?? false,
    maxFileSizeKb: args.maxFileSizeKb ?? null,
    syncDeletes: args.syncDeletes ?? false,
    initialSyncOnly: args.initialSyncOnly ?? false,
    keepOnDisconnect: args.keepOnDisconnect ?? false,
    replaceId: args.replaceId ?? null,
  });
export const stopSync = (syncId: string) => invoke<void>("stop_sync", { syncId });
export const listSyncs = () => invoke<SyncConfig[]>("list_syncs");
export const updateSyncRule = (syncId: string, rule: SyncRule) => invoke<void>("update_sync_rule", { syncId, rule });
export const updateSyncKeepOnDisconnect = (syncId: string, keep: boolean) => invoke<void>("update_sync_keep_on_disconnect", { syncId, keep });
export const updateSyncDryRun = (syncId: string, dryRun: boolean) => invoke<void>("update_sync_dry_run", { syncId, dryRun });
export const confirmSyncOperation = (requestId: string, approved: boolean) => invoke<void>("confirm_sync_operation", { requestId, approved });
export const listSuspendedSyncs = () => invoke<PersistedWatcherConfig[]>("list_suspended_syncs");
export const deleteSuspendedSync = (syncId: string) => invoke<void>("delete_suspended_sync", { syncId });

export interface VaultProfile {
  id: string;
  name: string;
  color: string;
  icon: string;
  created_at: string;
  file_name: string;
}

export const vaultListProfiles = () => invoke<VaultProfile[]>("vault_list_profiles");
export const vaultActiveProfileId = () => invoke<string>("vault_active_profile_id");
export const vaultSelectProfile = (profileId: string) => invoke<void>("vault_select_profile", { profileId });
export const vaultCreateProfile = (name: string, color: string, icon: string) => invoke<VaultProfile>("vault_create_profile", { name, color, icon });
export const vaultDeleteProfile = (profileId: string) => invoke<void>("vault_delete_profile", { profileId });
export const vaultRenameProfile = (profileId: string, name: string, color: string, icon: string) =>
  invoke<void>("vault_rename_profile", { profileId, name, color, icon });
export const vaultExists = () => invoke<boolean>("vault_exists");
export const vaultCreate = (passphrase: string) => invoke<void>("vault_create", { passphrase });
export const vaultUnlock = (passphrase: string) => invoke<void>("vault_unlock", { passphrase });
export const vaultChangePassphrase = (current: string, newPassphrase: string) =>
  invoke<void>("vault_change_passphrase", { current, newPassphrase });
export const vaultLock = () => invoke<void>("vault_lock");
export const vaultReset = () => invoke<void>("vault_reset");
export const vaultIsUnlocked = () => invoke<boolean>("vault_is_unlocked");

export interface CredentialInput {
  label: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  keyPassphrase?: string;
  authType: "password" | "private_key" | "agent";
}
export const vaultAddCredential = (args: CredentialInput) => invoke<string>("vault_add_credential", { ...args });
export const vaultUpdateCredential = (id: string, args: CredentialInput) => invoke<void>("vault_update_credential", { id, ...args });
export const vaultListCredentials = () => invoke<Credential[]>("vault_list_credentials");
export const vaultDeleteCredential = (id: string) => invoke<void>("vault_delete_credential", { id });
export const vaultConnect = (credentialId: string) => invoke<ConnectResult>("vault_connect", { credentialId });
export const vaultAcceptHostKeyAndConnect = (args: { credentialId: string; fingerprint: string; permanent: boolean }) =>
  invoke<ConnectionInfo>("vault_accept_host_key_and_connect", args);

export const listLocalDir = async (path: string): Promise<LocalEntry[]> => {
  const entries = await invoke<LocalEntry[]>("list_local_dir", { path });
  return entries.map((e) => ({ ...e, path: normalizeSeparators(e.path) }));
};
export const getLocalDrives = () => invoke<{ name: string; path: string; available: boolean }[]>("get_local_drives");
export const openInFileManager = (path: string) => invoke<void>("open_in_file_manager", { path });
export const revealInFileManager = (path: string) => invoke<void>("reveal_in_file_manager", { path });
export const getHomeDir = async (): Promise<string> => normalizeSeparators(await invoke<string>("get_home_dir"));
export const pathJoin = async (parent: string, child: string) => normalizeSeparators(await invoke<string>("path_join", { parent, child }));
export const getPlatform = () => invoke<string>("get_platform");
export const localPathExists = (path: string) => invoke<boolean>("local_path_exists", { path });
export const localPathsExist = (paths: string[]) => invoke<boolean[]>("local_paths_exist", { paths });
export const localIsDir = (paths: string[]) => invoke<boolean[]>("local_is_dir", { paths });
export const deleteLocalPath = (path: string) => invoke<void>("delete_local_path", { path });
export const deleteLocalBatch = (paths: string[]) => invoke<void>("delete_local_batch", { paths });
export const createLocalDir = (parent: string, name: string) => invoke<string>("create_local_dir", { parent, name });
export const renameLocal = (path: string, newName: string) => invoke<string>("rename_local", { path, newName });
export const moveLocal = (paths: string[], targetDir: string) => invoke<void>("move_local", { paths, targetDir });
export const readTextFile = (path: string) => invoke<string>("read_text_file", { path });

export const listSnippets = () => invoke<Snippet[]>("list_snippets");
export const saveSnippet = (args: { label: string; command: string; description?: string; category?: string; color?: string; existingId?: string }) =>
  invoke<Snippet>("save_snippet", args);
export const deleteSnippet = (id: string) => invoke<void>("delete_snippet", { id });
