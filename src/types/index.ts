export interface ConnectionInfo {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  state: ConnectionState;
  connected_at: string | null;
  server_fingerprint: string | null;
  server_key_type: string | null;
  server_version: string | null;
  home_dir: string | null;
  from_vault: boolean;
}

export type ConnectionState =
  | "connected"
  | "disconnected"
  | "connecting"
  | { error: string };

export interface HostKeyVerification {
  status: "known" | "unknown" | "changed";
  fingerprint: string;
  old_fingerprint: string | null;
  key_type: string;
  host: string;
  port: number;
}

export interface SshConfigHost {
  alias: string;
  hostname: string | null;
  user: string | null;
  port: number | null;
  identity_file: string | null;
  proxy_jump: string | null;
}

export interface RemoteEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  size: number | null;
  modified: number | null;
  permissions: number | null;
  owner: number | null;
  group: number | null;
  symlink_target: string | null;
}

export interface LocalEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  size: number | null;
  modified: number | null;
  extension: string | null;
  hidden: boolean;
  permissions: number | null;
}

export type SortField = "name" | "size" | "modified" | "type";
export type SortDir = "asc" | "desc";

export interface SortState {
  field: SortField;
  dir: SortDir;
}

export interface TransferRecord {
  id: string;
  session_id: string;
  batch_id: string | null;
  direction: "upload" | "download";
  local_path: string;
  remote_path: string;
  total_bytes: number;
  transferred_bytes: number;
  resume_offset: number;
  state: TransferState;
  strip_metadata: boolean;
  rate_limit_bps: number | null;
  sha256_local: string | null;
  sha256_remote: string | null;
  checksum_verified: boolean | null;
  retry_count: number;
  started_at: string | null;
  finished_at: string | null;
}

export type TransferState =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | { failed: string };

export interface TransferProgress {
  id: string;
  transferred_bytes: number;
  total_bytes: number;
  percent: number;
  speed_bps: number;
  eta_secs: number | null;
  state: TransferState;
}

export interface ChecksumResult {
  transfer_id: string;
  sha256_local: string;
  sha256_remote: string | null;
  verified: boolean;
}

export interface Credential {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "private_key" | "agent";
  created_at: string;
  last_used: string | null;
}

export interface Snippet {
  id: string;
  label: string;
  command: string;
  description: string | null;
  category: string | null;
  color: string | null;
}

export type SyncRule =
  | "always_overwrite"
  | "new_files_only"
  | "update_existing_only"
  | "confirm_all"
  | "confirm_on_overwrite";

export interface SyncConfig {
  id: string;
  label: string;
  local_root: string;
  remote_root: string;
  session_id: string;
  strip_metadata: boolean;
  active: boolean;
  events_processed: number;
  bytes_synced: number;
  exclude_patterns: string[];
  preserve_timestamps: boolean;
  mirror_permissions: boolean;
  rule: SyncRule;
  from_vault: boolean;
  expected_host: string;
  expected_port: number;
  keep_on_disconnect: boolean;

  protected_patterns: string[];

  dry_run: boolean;

  max_file_size_kb: number | null;

  sync_deletes: boolean;

  initial_sync_only: boolean;
  waiting_for_session?: boolean;
}

export interface SyncEvent {
  sync_id: string;
  rel_path: string;
  kind: string;
  timestamp: string;
  skipped: boolean;
}

export interface SyncConfirmRequest {
  request_id: string;
  sync_id: string;
  sync_label: string;
  rel_path: string;
  reason: string;
}

export interface PersistedWatcherConfig {
  id: string;
  label: string;
  local_root: string;
  remote_root: string;
  credential_id: string;
  expected_host: string;
  expected_port: number;
  expected_fingerprint: string;
  strip_metadata: boolean;
  preserve_timestamps: boolean;
  mirror_permissions: boolean;
  exclude_patterns: string[];
  rule: SyncRule;
  keep_on_disconnect: boolean;
  protected_patterns: string[];
  dry_run: boolean;
  max_file_size_kb: number | null;
  sync_deletes: boolean;
  initial_sync_only: boolean;
}

export interface BatchResult {
  batch_id: string;
  ids: string[];
  total_files: number;
  failed: number;
  cancelled: boolean;
  errors: string[];
}

export interface MetadataReport {
  file_type: string;
  fields_found: string[];
  fields_stripped: number;
  size_before: number;
  size_after: number;
}

export interface MetadataField {
  tag: string;
  value: string;
}

export type PylonTab = "files" | "terminal" | "sync" | "transfers" | "settings";

export type FileViewMode = "list" | "grid";

export interface Bookmark {
  id: string;
  label: string;
  path: string;
  side: "local" | "remote";
}
