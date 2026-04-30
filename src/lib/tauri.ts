


import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../stores/settingsStore";
import {
  ConnectionInfo,
  Credential,
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


export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}


export function joinLocalPath(parent: string, child: string): string {
  const base = normalizePath(parent).replace(/\/+$/, "");
  return `${base}/${child}`;
}


export interface ConnectResult {
  status: "connected" | "host_key_unknown" | "host_key_changed";
  info?: ConnectionInfo;
  verification?: {
    host: string;
    fingerprint: string;
    old_fingerprint?: string;
    key_type: string;
  };
}

export const connect = (args: {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  label: string;
}) => invoke<ConnectResult>("connect", args);

export const disconnect = (sessionId: string) =>
  invoke<void>("disconnect", { sessionId });

export const listConnections = () =>
  invoke<ConnectionInfo[]>("list_connections");

export const testConnection = (args: {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}) => invoke<boolean>("test_connection", args);


export const listRemoteDir = (sessionId: string, path: string) =>
  invoke<RemoteEntry[]>("list_remote_dir", { sessionId, path });

export const readRemoteFile = (sessionId: string, path: string) =>
  invoke<number[]>("read_remote_file", { sessionId, path });

export const writeRemoteFile = (
  sessionId: string,
  path: string,
  data: number[]
) => invoke<void>("write_remote_file", { sessionId, path, data });

export const deleteRemote = (
  sessionId: string,
  path: string,
  isDir: boolean,
  recursive = false
) => invoke<void>("delete_remote", { sessionId, path, isDir, recursive });

export const deleteBatch = (
  sessionId: string,
  paths: [string, boolean][],
) => invoke<void>("delete_batch", { sessionId, paths });

export const renameRemote = (
  sessionId: string,
  from: string,
  to: string
) => invoke<void>("rename_remote", { sessionId, from, to });

export const createRemoteDir = (sessionId: string, path: string) =>
  invoke<void>("create_remote_dir", { sessionId, path });

export const statRemote = (sessionId: string, path: string) =>
  invoke<RemoteEntry>("stat_remote", { sessionId, path });


export const uploadFile = (
  sessionId: string,
  localPath: string,
  remotePath: string
) => {
  const { bandwidthLimitKbps, defaultChunkKb } = useSettingsStore.getState();
  return invoke<string>("upload_file", {
    sessionId, localPath, remotePath,
    bandwidthKbps: bandwidthLimitKbps > 0 ? bandwidthLimitKbps : null,
    chunkKb: defaultChunkKb > 0 ? defaultChunkKb : null,
  });
};

export const uploadFileClean = (
  sessionId: string,
  localPath: string,
  remotePath: string
) => {
  const { bandwidthLimitKbps, defaultChunkKb } = useSettingsStore.getState();
  return invoke<string>("upload_file_clean", {
    sessionId, localPath, remotePath,
    bandwidthKbps: bandwidthLimitKbps > 0 ? bandwidthLimitKbps : null,
    chunkKb: defaultChunkKb > 0 ? defaultChunkKb : null,
  });
};

export const downloadFile = (
  sessionId: string,
  remotePath: string,
  localPath: string
) => {
  const { bandwidthLimitKbps, defaultChunkKb } = useSettingsStore.getState();
  return invoke<string>("download_file", {
    sessionId, remotePath, localPath,
    bandwidthKbps: bandwidthLimitKbps > 0 ? bandwidthLimitKbps : null,
    chunkKb: defaultChunkKb > 0 ? defaultChunkKb : null,
  });
};

export const cancelTransfer = (transferId: string) =>
  invoke<void>("cancel_transfer", { transferId });

export const listTransfers = () => invoke<TransferRecord[]>("list_transfers");


export const createTerminal = (
  sessionId: string,
  cols: number,
  rows: number,
  shell?: string
) => invoke<string>("create_terminal", { sessionId, cols, rows, shell });

export const terminalInput = (terminalId: string, data: number[]) =>
  invoke<void>("terminal_input", { terminalId, data });

export const resizeTerminal = (
  terminalId: string,
  cols: number,
  rows: number
) => invoke<void>("resize_terminal", { terminalId, cols, rows });

export const closeTerminal = (terminalId: string) =>
  invoke<void>("close_terminal", { terminalId });


export const stripFileMetadata = (localPath: string) =>
  invoke<void>("strip_file_metadata", { localPath });

export const stripFileMetadataPreview = (localPath: string) =>
  invoke<MetadataReport>("strip_file_metadata_preview", { localPath });

export const getFileMetadata = (localPath: string) =>
  invoke<MetadataField[]>("get_file_metadata", { localPath });


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
}) => invoke<SyncConfig>("start_sync", {
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
});

export const stopSync = (syncId: string) =>
  invoke<void>("stop_sync", { syncId });

export const listSyncs = () => invoke<SyncConfig[]>("list_syncs");

export const updateSyncRule = (syncId: string, rule: SyncRule) =>
  invoke<void>("update_sync_rule", { syncId, rule });

export const updateSyncKeepOnDisconnect = (syncId: string, keep: boolean) =>
  invoke<void>("update_sync_keep_on_disconnect", { syncId, keep });

export const updateSyncDryRun = (syncId: string, dryRun: boolean) =>
  invoke<void>("update_sync_dry_run", { syncId, dryRun });

export const confirmSyncOperation = (requestId: string, approved: boolean) =>
  invoke<void>("confirm_sync_operation", { requestId, approved });

export const listSuspendedSyncs = () =>
  invoke<PersistedWatcherConfig[]>("list_suspended_syncs");

export const deleteSuspendedSync = (syncId: string) =>
  invoke<void>("delete_suspended_sync", { syncId });


export interface VaultProfile {
  id: string;
  name: string;
  color: string;
  icon: string;
  created_at: string;
  file_name: string;
}

export const vaultListProfiles = () =>
  invoke<VaultProfile[]>("vault_list_profiles");

export const vaultActiveProfileId = () =>
  invoke<string>("vault_active_profile_id");

export const vaultSelectProfile = (profileId: string) =>
  invoke<void>("vault_select_profile", { profileId });

export const vaultCreateProfile = (name: string, color: string, icon: string) =>
  invoke<VaultProfile>("vault_create_profile", { name, color, icon });

export const vaultDeleteProfile = (profileId: string) =>
  invoke<void>("vault_delete_profile", { profileId });

export const vaultRenameProfile = (profileId: string, name: string, color: string, icon: string) =>
  invoke<void>("vault_rename_profile", { profileId, name, color, icon });


export const vaultUnlock = (passphrase: string) =>
  invoke<void>("vault_unlock", { passphrase });

export const vaultLock = () => invoke<void>("vault_lock");

export const vaultReset = () => invoke<void>("vault_reset");

export const vaultIsUnlocked = () => invoke<boolean>("vault_is_unlocked");

export const vaultAddCredential = (args: {
  passphrase: string;
  label: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  authType: "password" | "private_key" | "agent";
}) => invoke<string>("vault_add_credential", args);

export const vaultListCredentials = () =>
  invoke<Credential[]>("vault_list_credentials");

export const vaultDeleteCredential = (passphrase: string, id: string) =>
  invoke<void>("vault_delete_credential", { passphrase, id });

export const vaultConnect = (credentialId: string) =>
  invoke<ConnectResult>("vault_connect", { credentialId });


export const listLocalDir = async (path: string): Promise<LocalEntry[]> => {
  const entries = await invoke<LocalEntry[]>("list_local_dir", { path });


  return entries.map((e) => ({ ...e, path: normalizePath(e.path) }));
};

export const getLocalDrives = () =>
  invoke<{ name: string; path: string; available: boolean }[]>(
    "get_local_drives"
  );

export const openInFileManager = (path: string) =>
  invoke<void>("open_in_file_manager", { path });

export const getHomeDir = async (): Promise<string> => {
  const p = await invoke<string>("get_home_dir");
  return normalizePath(p);
};
export const pathJoin = async (parent: string, child: string): Promise<string> => {
  const p = await invoke<string>("path_join", { parent, child });
  return normalizePath(p);
};
export const getPlatform = () => invoke<string>("get_platform");
export const localPathExists = (path: string) =>
  invoke<boolean>("local_path_exists", { path });

export const chmodRemote = (sessionId: string, path: string, mode: number) =>
  invoke<void>("chmod_remote", { sessionId, path, mode });

export const deleteLocalPath = (path: string) =>
  invoke<void>("delete_local_path", { path });

export const deleteLocalBatch = (paths: string[]) =>
  invoke<void>("delete_local_batch", { paths });

export const pauseTransfer = (transferId: string) =>
  invoke<void>("pause_transfer", { transferId });

export const resumeTransferCmd = (transferId: string) =>
  invoke<void>("resume_transfer_cmd", { transferId });

export const uploadDirectory = (sessionId: string, localDir: string, remoteDir: string, stripMetadata = false) => {
  const { maxConcurrentTransfers, bandwidthLimitKbps, defaultChunkKb } = useSettingsStore.getState();
  return invoke<string[]>("upload_directory", {
    sessionId, localDir, remoteDir, stripMetadata,
    maxWorkers: maxConcurrentTransfers,
    bandwidthKbps: bandwidthLimitKbps > 0 ? bandwidthLimitKbps : null,
    chunkKb: defaultChunkKb > 0 ? defaultChunkKb : null,
  });
};

export const downloadDirectory = (sessionId: string, remoteDir: string, localDir: string) => {
  const { maxConcurrentTransfers, bandwidthLimitKbps, defaultChunkKb } = useSettingsStore.getState();
  return invoke<string[]>("download_directory", {
    sessionId, remoteDir, localDir,
    maxWorkers: maxConcurrentTransfers,
    bandwidthKbps: bandwidthLimitKbps > 0 ? bandwidthLimitKbps : null,
    chunkKb: defaultChunkKb > 0 ? defaultChunkKb : null,
  });
};

export const listSshConfigHosts = () =>
  invoke<import("../types").SshConfigHost[]>("list_ssh_config_hosts");

export const acceptHostKeyAndConnect = (args: {
  host: string; port: number; username: string;
  password?: string; privateKey?: string; label: string;
  permanent: boolean;
}) => invoke<import("../types").ConnectionInfo>("accept_host_key_and_connect", args);


export const listSnippets = () => invoke<Snippet[]>("list_snippets");

export const saveSnippet = (args: {
  label: string;
  command: string;
  description?: string;
  category?: string;
  color?: string;
  existingId?: string;
}) => invoke<Snippet>("save_snippet", args);

export const deleteSnippet = (id: string) =>
  invoke<void>("delete_snippet", { id });
