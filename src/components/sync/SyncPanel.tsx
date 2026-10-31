import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useFileStore } from "../../stores/fileStore";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle, ArrowLeft, Check, ChevronDown, EyeOff, FolderOpen, FolderSync,
  Lock, Pencil, Plus, RefreshCw, Server, Shield, Trash2, WifiOff, X, Zap,
} from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useSyncStore } from "../../stores/syncStore";
import { SyncConfig, SyncConfirmRequest, SyncRule } from "../../types";
import * as api from "../../lib/tauri";
import { errMsg } from "../../lib/format";
import { toast } from "../../stores/toastStore";

const RULES: { value: SyncRule; label: string; desc: string }[] = [
  {
    value: "always_overwrite",
    label: "Always overwrite",
    desc: "Upload all changes; overwrite existing remote files unconditionally.",
  },
  {
    value: "new_files_only",
    label: "New files only",
    desc: "Only upload files that don't yet exist on the remote. Never overwrite.",
  },
  {
    value: "update_existing_only",
    label: "Update existing only",
    desc: "Only overwrite remote files that already exist. Skip new local files.",
  },
  {
    value: "confirm_on_overwrite",
    label: "Confirm on overwrite",
    desc: "New files upload silently. Ask before overwriting or deleting existing files.",
  },
  {
    value: "confirm_all",
    label: "Confirm everything",
    desc: "Ask before every upload, overwrite, and deletion.",
  },
];

function ruleLabel(r: SyncRule) {
  return RULES.find((x) => x.value === r)?.label ?? r;
}

interface RulePickerProps {
  value: SyncRule;
  onChange: (r: SyncRule) => void;
  compact?: boolean;
}

function RulePicker({ value, onChange, compact = false }: RulePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inContainer = containerRef.current?.contains(target) ?? false;
      const inDropdown = dropdownRef.current?.contains(target) ?? false;
      if (!inContainer && !inDropdown) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function handleToggle() {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setOpen((v) => !v);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={handleToggle}
        className={`flex items-center gap-1.5 rounded-lg border transition-colors
          ${compact
            ? "px-2 py-1 text-[10px] bg-void-700 border-void-500 text-slate-300 hover:border-void-400"
            : "w-full px-3 py-2 text-sm bg-void-800 border-void-500 text-slate-200 hover:border-pylon-cyan/40"
          }`}
      >
        <span className="flex-1 text-left">{ruleLabel(value)}</span>
        <ChevronDown size={compact ? 9 : 12} className={`transition-transform shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: "fixed",
            top: dropPos.top,
            left: dropPos.left,
            minWidth: Math.max(dropPos.width, 260),
            zIndex: 9999,
          }}
          className="bg-void-800 border border-void-500 rounded-xl shadow-2xl overflow-hidden"
        >
          {RULES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => { onChange(r.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2.5 transition-colors flex items-start gap-2.5
                ${r.value === value ? "bg-pylon-cyan/8 text-pylon-cyan" : "hover:bg-void-700 text-slate-300"}`}
            >
              <div className={`w-3.5 h-3.5 mt-0.5 rounded-full border-2 shrink-0 flex items-center justify-center
                ${r.value === value ? "border-pylon-cyan bg-pylon-cyan" : "border-void-400"}`}>
                {r.value === value && <div className="w-1.5 h-1.5 rounded-full bg-void-900" />}
              </div>
              <div>
                <div className="text-xs font-medium">{r.label}</div>
                <div className="text-[10px] text-slate-600 mt-0.5">{r.desc}</div>
              </div>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

interface AddWatcherModalProps {
  onClose: () => void;
  onAdd: (cfg: SyncConfig) => void;
  sessionId: string;
}

function AddWatcherModal({ onClose, onAdd, sessionId }: AddWatcherModalProps) {
  const [localRoot, setLocalRoot] = useState(() => useFileStore.getState().localPath);
  const [remoteRoot, setRemoteRoot] = useState(() => useFileStore.getState().remotePath || "/");
  const [label, setLabel] = useState("My Sync");
  const [stripMetadata, setStripMetadata] = useState(false);
  const [rule, setRule] = useState<SyncRule>("always_overwrite");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [protectedPatternsRaw, setProtectedPatternsRaw] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [maxFileSizeKbRaw, setMaxFileSizeKbRaw] = useState("");
  const [syncDeletes, setSyncDeletes] = useState(false);
  const [initialSyncOnly, setInitialSyncOnly] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!localRoot.trim() || !remoteRoot.trim()) {
      setError("Both local and remote paths are required.");
      return;
    }
    const protectedPatterns = protectedPatternsRaw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const maxFileSizeKb = maxFileSizeKbRaw.trim()
      ? parseInt(maxFileSizeKbRaw.trim(), 10) || null
      : null;

    setLoading(true);
    setError("");
    try {
      const config = await api.startSync({
        sessionId,
        localRoot: localRoot.trim(),
        remoteRoot: remoteRoot.trim(),
        label: label.trim() || "Sync",
        stripMetadata,
        rule,
        protectedPatterns,
        dryRun,
        maxFileSizeKb,
        syncDeletes,
        initialSyncOnly,
      });
      onAdd(config);
      onClose();
    } catch (e: any) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 10 }}
        className="bg-void-900 border border-void-600 rounded-xl shadow-2xl w-[480px] max-w-[92vw] flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center gap-3 px-5 py-4 bg-void-800 border-b border-void-600 shrink-0 rounded-t-xl">
          <FolderSync size={16} className="text-pylon-cyan" />
          <span className="text-sm font-semibold text-slate-200">Add Sync Watcher</span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-[11px] text-slate-400 uppercase tracking-widest">Label</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My Sync"
              className="w-full bg-void-800 border border-void-500 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-pylon-cyan/50 transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <FolderOpen size={10} /> Local Root
              </label>
              <div className="flex gap-1.5">
              <input
                value={localRoot}
                onChange={(e) => setLocalRoot(e.target.value)}
                placeholder="/home/user/project"
                className="w-full bg-void-800 border border-void-500 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-pylon-cyan/50 transition-colors font-mono"
              />
              <button
                type="button"
                title="Choose folder"
                onClick={async () => {
                  const d = await openDialog({ directory: true, multiple: false, defaultPath: localRoot || undefined }).catch(() => null);
                  if (typeof d === "string") setLocalRoot(d);
                }}
                className="shrink-0 rounded-lg border border-void-500 px-2 text-slate-400 hover:bg-void-700 hover:text-slate-100"
              >
                <FolderOpen size={13} />
              </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <Server size={10} /> Remote Root
              </label>
              <input
                value={remoteRoot}
                onChange={(e) => setRemoteRoot(e.target.value)}
                placeholder="/var/www/project"
                className="w-full bg-void-800 border border-void-500 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-pylon-violet/50 transition-colors font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] text-slate-400 uppercase tracking-widest">Sync Rule</label>
            <RulePicker value={rule} onChange={setRule} />
            <p className="text-[10px] text-slate-600">
              {RULES.find((r) => r.value === rule)?.desc}
            </p>
          </div>

          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg bg-void-800 border border-void-600 hover:border-pylon-amber/30 transition-colors">
            <div
              onClick={() => setStripMetadata((v) => !v)}
              className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${stripMetadata ? "bg-pylon-amber" : "bg-void-600"}`}
            >
              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${stripMetadata ? "left-[18px]" : "left-0.5"}`} />
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-300">
                <Shield size={11} className="text-pylon-amber" />
                Strip metadata on sync
              </div>
              <p className="text-[10px] text-slate-600 mt-0.5">Remove EXIF/location data before uploading</p>
            </div>
          </label>

          <div className="border border-void-600 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-void-800 hover:bg-void-750 text-slate-400 hover:text-slate-300 transition-colors text-[11px] uppercase tracking-widest"
            >
              <ChevronDown size={11} className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
              Advanced Options
            </button>

            <AnimatePresence initial={false}>
              {showAdvanced && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: "auto" }}
                  exit={{ height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-3 space-y-3 bg-void-850 border-t border-void-600">

                    <div className="space-y-1.5">
                      <label className="text-[11px] text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                        <Lock size={9} className="text-pylon-red/70" />
                        Protected Paths
                      </label>
                      <textarea
                        value={protectedPatternsRaw}
                        onChange={(e) => setProtectedPatternsRaw(e.target.value)}
                        rows={3}
                        placeholder={"uploads\nprivate/**\n*.secret"}
                        className="w-full bg-void-800 border border-void-500 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-700 outline-none focus:border-pylon-red/40 transition-colors font-mono resize-none"
                      />
                      <p className="text-[10px] text-slate-600">
                        Gitignore-style globs relative to Remote Root. Matching paths are never uploaded, overwritten, or deleted.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] text-slate-400 uppercase tracking-widest">Max File Size (KB)</label>
                      <input
                        type="number"
                        min={1}
                        value={maxFileSizeKbRaw}
                        onChange={(e) => setMaxFileSizeKbRaw(e.target.value)}
                        placeholder="Leave blank for no limit"
                        className="w-full bg-void-800 border border-void-500 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-pylon-cyan/50 transition-colors"
                      />
                      <p className="text-[10px] text-slate-600">Files larger than this will be skipped during sync.</p>
                    </div>

                    <label className="flex items-center gap-3 cursor-pointer p-2.5 rounded-lg bg-void-800 border border-void-600 hover:border-pylon-red/30 transition-colors">
                      <Toggle checked={syncDeletes} onChange={setSyncDeletes} />
                      <div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-300">
                          <Trash2 size={10} className="text-pylon-red/70" />
                          Propagate deletions
                        </div>
                        <p className="text-[10px] text-slate-600 mt-0.5">
                          When a local file is deleted, also delete it on the remote. Off by default.
                        </p>
                      </div>
                    </label>

                    <label className="flex items-center gap-3 cursor-pointer p-2.5 rounded-lg bg-void-800 border border-void-600 hover:border-pylon-violet/30 transition-colors">
                      <Toggle checked={dryRun} onChange={setDryRun} />
                      <div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-300">
                          <EyeOff size={10} className="text-pylon-violet" />
                          Dry run mode
                        </div>
                        <p className="text-[10px] text-slate-600 mt-0.5">
                          Log what would happen without actually transferring or deleting anything.
                        </p>
                      </div>
                    </label>

                    <label className="flex items-center gap-3 cursor-pointer p-2.5 rounded-lg bg-void-800 border border-void-600 hover:border-pylon-amber/30 transition-colors">
                      <Toggle checked={initialSyncOnly} onChange={setInitialSyncOnly} />
                      <div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-300">
                          <Zap size={10} className="text-pylon-amber" />
                          Initial sync only
                        </div>
                        <p className="text-[10px] text-slate-600 mt-0.5">
                          Stop watching automatically after the first batch of changes is synced.
                        </p>
                      </div>
                    </label>

                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {error && (
            <p className="text-xs text-pylon-red bg-pylon-red/10 border border-pylon-red/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg text-sm text-slate-400 border border-void-500 hover:bg-void-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-pylon-cyan/15 border border-pylon-cyan/30 text-pylon-cyan hover:bg-pylon-cyan/25 transition-colors disabled:opacity-50"
            >
              {loading ? "Starting…" : "Start Watcher"}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

interface ConfirmBannerProps {
  req: SyncConfirmRequest;
  onDecide: (requestId: string, approved: boolean) => void;
}

function ConfirmBanner({ req, onDecide }: ConfirmBannerProps) {
  const reasonLabel: Record<string, string> = {
    overwrite: "overwrite",
    new_file: "upload new file",
    delete: "delete",
    sync: "sync",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="flex items-start gap-2.5 px-3 py-2.5 bg-pylon-amber/8 border-b border-pylon-amber/20"
    >
      <AlertTriangle size={12} className="text-pylon-amber shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-slate-300 truncate">
          <span className="text-pylon-amber font-medium">{req.sync_label}</span>
          {" — "}{reasonLabel[req.reason] ?? req.reason}{" "}
          <span className="font-mono text-slate-400">{req.rel_path}</span>
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onDecide(req.request_id, false)}
          className="p-1 rounded hover:bg-void-600 text-slate-500 hover:text-pylon-red transition-colors"
          title="Skip"
        >
          <X size={11} />
        </button>
        <button
          onClick={() => onDecide(req.request_id, true)}
          className="p-1 rounded bg-pylon-cyan/10 hover:bg-pylon-cyan/20 text-pylon-cyan transition-colors"
          title="Approve"
        >
          <Check size={11} />
        </button>
      </div>
    </motion.div>
  );
}

interface EditWatcherModalProps {
  sync: SyncConfig;
  sessionId: string;
  onClose: () => void;
  onUpdated: (cfg: SyncConfig) => void;
}

function EditWatcherModal({ sync, sessionId, onClose, onUpdated }: EditWatcherModalProps) {
  const [label, setLabel] = useState(sync.label);
  const [localRoot, setLocalRoot] = useState(sync.local_root);
  const [remoteRoot, setRemoteRoot] = useState(sync.remote_root);
  const [stripMetadata, setStripMetadata] = useState(sync.strip_metadata ?? false);
  const [rule, setRule] = useState<SyncRule>(sync.rule ?? "always_overwrite");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [protectedPatternsRaw, setProtectedPatternsRaw] = useState(
    (sync.protected_patterns ?? []).join("\n")
  );
  const [dryRun, setDryRun] = useState(sync.dry_run ?? false);
  const [maxFileSizeKbRaw, setMaxFileSizeKbRaw] = useState(
    sync.max_file_size_kb != null ? String(sync.max_file_size_kb) : ""
  );
  const [syncDeletes, setSyncDeletes] = useState(sync.sync_deletes ?? false);
  const [initialSyncOnly, setInitialSyncOnly] = useState(sync.initial_sync_only ?? false);
  const [keepOnDisconnect, setKeepOnDisconnect] = useState(sync.keep_on_disconnect ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!localRoot.trim() || !remoteRoot.trim()) {
      setError("Both local and remote paths are required.");
      return;
    }
    const protectedPatterns = protectedPatternsRaw
      .split("\n").map((l) => l.trim()).filter(Boolean);
    const maxFileSizeKb = maxFileSizeKbRaw.trim()
      ? parseInt(maxFileSizeKbRaw.trim(), 10) || null : null;

    setLoading(true);
    setError("");
    try {
      const config = await api.startSync({
        replaceId: sync.id,
        keepOnDisconnect,
        sessionId,
        localRoot: localRoot.trim(),
        remoteRoot: remoteRoot.trim(),
        label: label.trim() || "Sync",
        stripMetadata,
        rule,
        protectedPatterns,
        dryRun,
        maxFileSizeKb,
        syncDeletes,
        initialSyncOnly,
        preserveTimestamps: sync.preserve_timestamps,
        mirrorPermissions: sync.mirror_permissions,
        excludePatterns: sync.exclude_patterns,
      });
      onUpdated(config);
      onClose();
    } catch (e: any) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 10 }}
        className="bg-void-900 border border-void-600 rounded-xl shadow-2xl w-[480px] max-w-[92vw] flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center gap-3 px-5 py-4 bg-void-800 border-b border-void-600 shrink-0 rounded-t-xl">
          <Pencil size={16} className="text-pylon-violet" />
          <span className="text-sm font-semibold text-slate-200">Edit Sync Watcher</span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-[11px] text-slate-400 uppercase tracking-widest">Label</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full bg-void-800 border border-void-500 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-pylon-cyan/50 transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <FolderOpen size={10} /> Local Root
              </label>
              <input
                value={localRoot}
                onChange={(e) => setLocalRoot(e.target.value)}
                className="w-full bg-void-800 border border-void-500 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-pylon-cyan/50 transition-colors font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <Server size={10} /> Remote Root
              </label>
              <input
                value={remoteRoot}
                onChange={(e) => setRemoteRoot(e.target.value)}
                className="w-full bg-void-800 border border-void-500 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-pylon-violet/50 transition-colors font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] text-slate-400 uppercase tracking-widest">Sync Rule</label>
            <RulePicker value={rule} onChange={setRule} />
            <p className="text-[10px] text-slate-600">
              {RULES.find((r) => r.value === rule)?.desc}
            </p>
          </div>

          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg bg-void-800 border border-void-600 hover:border-pylon-amber/30 transition-colors">
            <div
              onClick={() => setStripMetadata((v) => !v)}
              className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${stripMetadata ? "bg-pylon-amber" : "bg-void-600"}`}
            >
              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${stripMetadata ? "left-[18px]" : "left-0.5"}`} />
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-300">
                <Shield size={11} className="text-pylon-amber" />
                Strip metadata on sync
              </div>
              <p className="text-[10px] text-slate-600 mt-0.5">Remove EXIF/location data before uploading</p>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg bg-void-800 border border-void-600 hover:border-pylon-violet/30 transition-colors">
            <div
              onClick={() => setKeepOnDisconnect((v) => !v)}
              className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${keepOnDisconnect ? "bg-pylon-violet" : "bg-void-600"}`}
            >
              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${keepOnDisconnect ? "left-[18px]" : "left-0.5"}`} />
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-300">
                <WifiOff size={11} className="text-pylon-violet" />
                Keep syncing on disconnect
              </div>
              <p className="text-[10px] text-slate-600 mt-0.5">Continue watching even if the SSH session drops</p>
            </div>
          </label>

          <div className="border border-void-600 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-void-800 hover:bg-void-750 text-slate-400 hover:text-slate-300 transition-colors text-[11px] uppercase tracking-widest"
            >
              <ChevronDown size={11} className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
              Advanced Options
            </button>
            <AnimatePresence initial={false}>
              {showAdvanced && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: "auto" }}
                  exit={{ height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-3 space-y-3 bg-void-850 border-t border-void-600">
                    <div className="space-y-1.5">
                      <label className="text-[11px] text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                        <Lock size={9} className="text-pylon-red/70" />
                        Protected Paths
                      </label>
                      <textarea
                        value={protectedPatternsRaw}
                        onChange={(e) => setProtectedPatternsRaw(e.target.value)}
                        rows={3}
                        placeholder={"uploads\nprivate/**\n*.secret"}
                        className="w-full bg-void-800 border border-void-500 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-700 outline-none focus:border-pylon-red/40 transition-colors font-mono resize-none"
                      />
                      <p className="text-[10px] text-slate-600">Gitignore-style globs. Matching paths are never overwritten or deleted.</p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] text-slate-400 uppercase tracking-widest">Max File Size (KB)</label>
                      <input
                        type="number"
                        min={1}
                        value={maxFileSizeKbRaw}
                        onChange={(e) => setMaxFileSizeKbRaw(e.target.value)}
                        placeholder="Leave blank for no limit"
                        className="w-full bg-void-800 border border-void-500 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-pylon-cyan/50 transition-colors"
                      />
                    </div>
                    <label className="flex items-center gap-3 cursor-pointer p-2.5 rounded-lg bg-void-800 border border-void-600 hover:border-pylon-red/30 transition-colors">
                      <Toggle checked={syncDeletes} onChange={setSyncDeletes} />
                      <div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-300">
                          <Trash2 size={10} className="text-pylon-red/70" />
                          Propagate deletions
                        </div>
                        <p className="text-[10px] text-slate-600 mt-0.5">Delete remote files when local files are removed.</p>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer p-2.5 rounded-lg bg-void-800 border border-void-600 hover:border-pylon-violet/30 transition-colors">
                      <Toggle checked={dryRun} onChange={setDryRun} />
                      <div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-300">
                          <EyeOff size={10} className="text-pylon-violet" />
                          Dry run mode
                        </div>
                        <p className="text-[10px] text-slate-600 mt-0.5">Log changes without actually transferring anything.</p>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer p-2.5 rounded-lg bg-void-800 border border-void-600 hover:border-pylon-amber/30 transition-colors">
                      <Toggle checked={initialSyncOnly} onChange={setInitialSyncOnly} />
                      <div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-300">
                          <Zap size={10} className="text-pylon-amber" />
                          Initial sync only
                        </div>
                        <p className="text-[10px] text-slate-600 mt-0.5">Stop watching after the first flush completes.</p>
                      </div>
                    </label>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <p className="text-[10px] text-slate-600 bg-void-800 border border-void-600 rounded-lg px-3 py-2">
            Saving will stop the current watcher and restart it with the new settings.
          </p>

          {error && (
            <p className="text-xs text-pylon-red bg-pylon-red/10 border border-pylon-red/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg text-sm text-slate-400 border border-void-500 hover:bg-void-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-pylon-violet/15 border border-pylon-violet/30 text-pylon-violet hover:bg-pylon-violet/25 transition-colors disabled:opacity-50"
            >
              {loading ? "Saving…" : "Save & Restart"}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-7 h-3.5 rounded-full transition-colors shrink-0 ${checked ? "bg-pylon-cyan" : "bg-void-500"}`}
    >
      <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-all ${checked ? "left-[15px]" : "left-0.5"}`} />
    </button>
  );
}

export function SyncPanel() {
  const store = useSyncStore();
  const { syncs, suspendedSyncs, events, errors, confirms } = store;
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSyncId, setSelectedSyncId] = useState<string | null>(null);
  const [editingSync, setEditingSync] = useState<SyncConfig | null>(null);
  const { activeSessionId, connections } = useConnectionStore();
  const activeConnection = connections.find((c) => c.id === activeSessionId);
  const canAddWatcher = activeConnection?.from_vault === true;

  useEffect(() => {
    api.listSyncs().then(store.setSyncs).catch(() => {});
    api.listSuspendedSyncs().then(store.setSuspendedSyncs).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedSyncId && !syncs.find((s) => s.id === selectedSyncId)) {
      setSelectedSyncId(null);
    }
  }, [syncs, selectedSyncId]);

  async function stopSync(id: string) {
    try {
      await api.stopSync(id);
      store.removeSync(id);
    } catch (e) {
      toast.error("Failed to stop watcher", errMsg(e));
    }
  }

  async function deleteSuspendedSync(id: string) {
    try {
      await api.deleteSuspendedSync(id);
      store.removeSuspendedSync(id);
    } catch (e) {
      toast.error("Failed to remove suspended watcher", errMsg(e));
    }
  }

  async function handleRuleChange(syncId: string, rule: SyncRule) {
    const prev = syncs.find((s) => s.id === syncId)?.rule;
    store.patchSyncRule(syncId, rule);
    try {
      await api.updateSyncRule(syncId, rule);
    } catch (e) {
      if (prev !== undefined) store.patchSyncRule(syncId, prev);
      toast.error("Failed to update sync rule", errMsg(e));
    }
  }

  async function handleKeepOnDisconnect(syncId: string, keep: boolean) {
    store.patchSyncKeepOnDisconnect(syncId, keep);
    try {
      await api.updateSyncKeepOnDisconnect(syncId, keep);
    } catch (e) {
      store.patchSyncKeepOnDisconnect(syncId, !keep);
      toast.error("Failed to update keep-on-disconnect", errMsg(e));
    }
  }

  async function handleDryRunChange(syncId: string, dryRun: boolean) {
    store.patchSyncDryRun(syncId, dryRun);
    try {
      await api.updateSyncDryRun(syncId, dryRun);
    } catch (e) {
      store.patchSyncDryRun(syncId, !dryRun);
      toast.error("Failed to update dry run", errMsg(e));
    }
  }

  async function handleDecide(requestId: string, approved: boolean) {
    try {
      await api.confirmSyncOperation(requestId, approved);
    } catch (e) {
      toast.error("Failed to confirm sync operation", errMsg(e));
    }
    store.removeConfirm(requestId);
  }

  const confirmsForSync = (id: string) => confirms.filter((c) => c.sync_id === id);
  const visibleEvents = selectedSyncId
    ? events.filter((e) => e.syncId === selectedSyncId)
    : events;
  const selectedSync = syncs.find((s) => s.id === selectedSyncId);

  return (
    <div className="flex flex-col h-full bg-void-900">
      <div className="flex items-center gap-3 px-4 py-3 bg-void-800 border-b border-void-600 shrink-0">
        <FolderSync size={16} className="text-pylon-cyan" />
        <span className="text-sm font-semibold text-slate-200">Sync</span>
        {syncs.length > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-pylon-cyan/15 text-pylon-cyan text-[10px] font-semibold">
            {syncs.length} active
          </span>
        )}
        {confirms.length > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-pylon-amber/15 text-pylon-amber text-[10px] font-semibold animate-pulse">
            {confirms.length} pending
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setShowAddModal(true)}
          disabled={!canAddWatcher}
          title={!canAddWatcher ? "Requires a ZVault connection" : undefined}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-pylon-cyan/10 border border-pylon-cyan/20 text-pylon-cyan hover:bg-pylon-cyan/20 transition-colors disabled:opacity-30"
        >
          <Plus size={12} /> Add Watcher
        </button>
      </div>

      <AnimatePresence initial={false}>
        {confirms.map((req) => (
          <ConfirmBanner key={req.request_id} req={req} onDecide={handleDecide} />
        ))}
      </AnimatePresence>

      <div className="flex-1 overflow-hidden flex min-h-0">
        <div className="w-72 border-r border-void-600 overflow-y-auto p-3 space-y-2 shrink-0">
          {syncs.length === 0 && suspendedSyncs.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3 px-3 text-slate-500">
              <RefreshCw size={22} className="text-slate-600" />
              <div className="text-center">
                <p className="text-[13px] text-slate-300">No watchers yet</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {activeSessionId
                    ? "Add a watcher to push local changes to this server as you save."
                    : "Connect to a server saved in ZVault, then add a watcher."}
                </p>
              </div>
            </div>
          ) : (
            <>
            {syncs.map((s) => {
              const hasError = !!errors[s.id];
              const pendingCount = confirmsForSync(s.id).length;
              const isSelected = selectedSyncId === s.id;

              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedSyncId(isSelected ? null : s.id)}
                  className={`bg-void-800 border rounded-lg p-3 space-y-2.5 cursor-pointer transition-all
                    ${hasError
                      ? "border-pylon-red/30 bg-pylon-red/5 hover:border-pylon-red/50"
                      : isSelected
                        ? "border-pylon-cyan/40 bg-pylon-cyan/5"
                        : "border-void-600 hover:border-void-500"
                    }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      hasError ? "bg-pylon-red" :
                      s.keep_on_disconnect ? "bg-pylon-violet animate-pulse" :
                      "bg-pylon-cyan animate-pulse"
                    }`} />
                    <span className="text-sm text-slate-200 truncate flex-1 font-medium">{s.label}</span>
                    {pendingCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-pylon-amber/15 text-pylon-amber text-[10px] font-semibold">
                        {pendingCount}
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingSync(s); }}
                      title="Edit watcher"
                      className="flex items-center justify-center w-5 h-5 rounded bg-void-700 hover:bg-pylon-violet/20 border border-void-500 hover:border-pylon-violet/40 text-slate-500 hover:text-pylon-violet transition-all shrink-0"
                    >
                      <Pencil size={10} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); stopSync(s.id); }}
                      title="Stop watcher"
                      className="flex items-center justify-center w-5 h-5 rounded bg-void-700 hover:bg-pylon-red/20 border border-void-500 hover:border-pylon-red/40 text-slate-500 hover:text-pylon-red transition-all shrink-0"
                    >
                      <X size={10} />
                    </button>
                  </div>

                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                      <FolderOpen size={9} className="shrink-0" />
                      <span className="truncate font-mono">{s.local_root}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
                      <span className="text-pylon-cyan/40 shrink-0">→</span>
                      <span className="truncate font-mono">{s.remote_root}</span>
                    </div>
                  </div>

                  {hasError && (
                    <p className="text-[10px] text-pylon-red/80 font-mono truncate">{errors[s.id]}</p>
                  )}

                  <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                    <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-1">Rule</p>
                    <RulePicker value={s.rule ?? "always_overwrite"} onChange={(r) => handleRuleChange(s.id, r)} compact />
                  </div>

                  <div
                    className="flex items-center gap-2 pt-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <WifiOff size={9} className={s.keep_on_disconnect ? "text-pylon-violet" : "text-slate-600"} />
                    <span className="text-[10px] text-slate-500 flex-1">Keep syncing on disconnect</span>
                    <Toggle
                      checked={s.keep_on_disconnect ?? false}
                      onChange={(v) => handleKeepOnDisconnect(s.id, v)}
                    />
                  </div>

                  <div
                    className="flex items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <EyeOff size={9} className={s.dry_run ? "text-pylon-violet" : "text-slate-600"} />
                    <span className="text-[10px] text-slate-500 flex-1">Dry run (no transfers)</span>
                    <Toggle
                      checked={s.dry_run ?? false}
                      onChange={(v) => handleDryRunChange(s.id, v)}
                    />
                  </div>

                  {(s.protected_patterns?.length > 0 || s.max_file_size_kb || s.sync_deletes || s.initial_sync_only) && (
                    <div className="flex flex-wrap gap-1 pt-0.5" onClick={(e) => e.stopPropagation()}>
                      {s.protected_patterns?.length > 0 && (
                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-pylon-red/10 border border-pylon-red/20 text-pylon-red/70 text-[9px]">
                          <Lock size={8} />{s.protected_patterns.length} protected
                        </span>
                      )}
                      {s.max_file_size_kb && (
                        <span className="px-1.5 py-0.5 rounded bg-void-600 text-slate-500 text-[9px]">
                          max {s.max_file_size_kb} KB
                        </span>
                      )}
                      {s.sync_deletes && (
                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-pylon-red/10 border border-pylon-red/20 text-pylon-red/70 text-[9px]">
                          <Trash2 size={8} />deletes on
                        </span>
                      )}
                      {s.initial_sync_only && (
                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-pylon-amber/10 border border-pylon-amber/20 text-pylon-amber/70 text-[9px]">
                          <Zap size={8} />one-shot
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {suspendedSyncs.map((s) => (
              <div
                key={s.id}
                className="bg-void-800/50 border border-void-600/50 rounded-lg p-3 space-y-2 opacity-60"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-slate-600 shrink-0" />
                  <span className="text-sm text-slate-400 truncate flex-1 font-medium">{s.label}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-void-600 text-slate-500 uppercase tracking-wider shrink-0">suspended</span>
                  <button
                    onClick={() => deleteSuspendedSync(s.id)}
                    title="Remove suspended watcher"
                    className="flex items-center justify-center w-5 h-5 rounded bg-void-700 hover:bg-pylon-red/20 border border-void-500 hover:border-pylon-red/40 text-slate-600 hover:text-pylon-red transition-all shrink-0"
                  >
                    <X size={10} />
                  </button>
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
                    <FolderOpen size={9} className="shrink-0" />
                    <span className="truncate font-mono">{s.local_root}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-700">
                    <span className="text-pylon-cyan/20 shrink-0">→</span>
                    <span className="truncate font-mono">{s.remote_root}</span>
                  </div>
                </div>
                <p className="text-[10px] text-slate-700 flex items-center gap-1.5">
                  <WifiOff size={9} />
                  Waiting for ZVault — {s.expected_host}:{s.expected_port}
                </p>
              </div>
            ))}
            </>
          )}
        </div>

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-void-700 shrink-0">
            {selectedSync ? (
              <>
                <button
                  onClick={() => setSelectedSyncId(null)}
                  className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <ArrowLeft size={11} />
                </button>
                <span className="w-1.5 h-1.5 rounded-full bg-pylon-cyan animate-pulse shrink-0" />
                <span className="text-[11px] text-slate-400 font-semibold truncate">{selectedSync.label}</span>
              </>
            ) : (
              <span className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold">All Events</span>
            )}
            {visibleEvents.length > 0 && (
              <span className="ml-auto text-[10px] text-slate-700">{visibleEvents.length}</span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {visibleEvents.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 text-slate-500">
                <Zap size={18} className="text-slate-600" />
                <p className="text-xs">Changes will appear here as they sync</p>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {visibleEvents.map((e) => (
                  <motion.div
                    key={e.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`flex items-center gap-2 py-0.5 font-mono text-xs ${e.skipped ? "opacity-50" : ""}`}
                  >
                    <Zap
                      size={8}
                      className={
                        e.skipped ? "text-slate-600 shrink-0" :
                        e.kind === "deleted" ? "text-pylon-red/60 shrink-0" :
                        "text-pylon-cyan shrink-0"
                      }
                    />
                    <span className="flex-1 truncate text-slate-300" title={e.relPath}>{e.relPath}</span>
                    <span className={`text-[10px] shrink-0 ${
                      e.skipped        ? "text-slate-700" :
                      e.kind === "deleted"   ? "text-pylon-red/60" :
                      e.kind === "modified"  ? "text-pylon-amber/60" :
                      "text-pylon-green/60"
                    }`}>{e.skipped ? "skipped" : e.kind}</span>
                    <span className="tabular w-16 shrink-0 text-right text-[10px] text-slate-600">{new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showAddModal && activeSessionId && (
          <AddWatcherModal
            key="add-watcher"
            sessionId={activeSessionId}
            onClose={() => setShowAddModal(false)}
            onAdd={(cfg) => store.addSync(cfg)}
          />
        )}
        {editingSync && activeSessionId && (
          <EditWatcherModal
            key="edit-watcher"
            sync={editingSync}
            sessionId={activeSessionId}
            onClose={() => setEditingSync(null)}
            onUpdated={(cfg) => {
              store.removeSync(editingSync.id);
              store.addSync(cfg);
              setEditingSync(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
