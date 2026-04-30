import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check, ChevronLeft, ChevronRight, Download, Eye, EyeOff,
  FolderPlus, Lock, RefreshCw, Server, Trash2, Unplug, X,
} from "lucide-react";
import { useFileStore } from "../../stores/fileStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { useConfirm } from "../ui/ConfirmDialog";
import { toast } from "../../stores/toastStore";
import { FileRow } from "./FileRow";
import { FileHeader } from "./FileHeader";
import { BulkToolbar } from "./BulkToolbar";
import { PathBreadcrumb } from "./PathBreadcrumb";
import { ContextMenu, ContextMenuEntry } from "./ContextMenu";
import { ChmodModal } from "../modals/ChmodModal";
import { OverwriteModal } from "../modals/OverwriteModal";
import { useOverwriteDecision } from "../../lib/useOverwriteDecision";
import { GhostFileRow } from "./GhostFileRow";
import { GhostBatchRow } from "./GhostBatchRow";
import { PaneSearchBar, TypeFilter } from "./PaneSearchBar";
import { useGhostStore } from "../../stores/ghostStore";
import * as api from "../../lib/tauri";
import { joinLocalPath } from "../../lib/tauri";
import { useSettingsStore } from "../../stores/settingsStore";
import { errMsg } from "../../lib/format";
import { Copy, FileEdit } from "lucide-react";

const CODE_EXTS    = new Set(["ts","tsx","js","jsx","mjs","cjs","rs","py","go","sh","bash","zsh","php","html","htm","css","scss","c","cpp","h","java","rb","swift","kt","dart","lua","r","sql","toml","yaml","yml","json","xml","ini","conf","env"]);
const IMAGE_EXTS   = new Set(["png","jpg","jpeg","gif","webp","svg","bmp","tiff","tif","ico","heic","heif","avif"]);
const MEDIA_EXTS   = new Set(["mp4","mkv","mov","avi","wmv","flv","webm","mp3","flac","wav","ogg","aac","m4a","opus","wma"]);
const DOC_EXTS     = new Set(["txt","md","mdx","pdf","docx","doc","xlsx","xls","pptx","ppt","odt","rtf","csv","tsv","epub"]);
const ARCHIVE_EXTS = new Set(["zip","tar","gz","bz2","xz","7z","rar","dmg","iso","pkg","deb","rpm","snap","appimage"]);

function matchesType(entry: { is_dir: boolean; name: string }, type: TypeFilter): boolean {
  if (type === "all") return true;
  if (type === "folders") return entry.is_dir;
  const ext = entry.name.includes(".") ? entry.name.split(".").pop()!.toLowerCase() : "";
  if (type === "code")     return !entry.is_dir && CODE_EXTS.has(ext);
  if (type === "images")   return !entry.is_dir && IMAGE_EXTS.has(ext);
  if (type === "media")    return !entry.is_dir && MEDIA_EXTS.has(ext);
  if (type === "docs")     return !entry.is_dir && DOC_EXTS.has(ext);
  if (type === "archives") return !entry.is_dir && ARCHIVE_EXTS.has(ext);
  return true;
}

interface DragItem { path: string; name: string; is_dir: boolean }
interface CtxState { x: number; y: number; entry: { path: string; name: string; is_dir: boolean; permissions: number | null } }
interface ChmodTarget { path: string; perm: number }

export function RemotePane() {
  const store = useFileStore();
  const {
    remotePath, remoteEntries, remoteAllCount, remoteLoading, remoteError, selectedRemote,
    remoteSort, remoteFilter, remoteRegexMode, showHidden, overwritePolicy, setOverwritePolicy,
    navigateRemote, navigateRemoteBack, navigateRemoteForward,
    selectRemote, selectAllRemote, clearSelection,
    setRemoteSort, setRemoteFilter, setRemoteRegexMode, toggleHidden,
    refreshRemote, remoteHistory, remoteHistoryIndex,
    localPath,
  } = store;
  const { activeSessionId, disconnectFromServer } = useConnectionStore();
  const { setRemoteTerminalCwd } = useUiStore();
  const { ghosts, batches } = useGhostStore();
  const confirm = useConfirm();
  const { modalState: conflictModalState, handleChoice: handleConflictChoice, preflightCheck } = useOverwriteDecision();
  const searchRef = useRef<HTMLInputElement>(null);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [chmodTarget, setChmodTarget] = useState<ChmodTarget | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [dragOverPane, setDragOverPane] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingDeletes, setPendingDeletes] = useState<Map<string, string>>(new Map());
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const dragCounter = useRef(0);

  const displayedEntries = useMemo(() => {
    if (typeFilter === "all") return remoteEntries;
    return remoteEntries.filter((e) => matchesType(e, typeFilter));
  }, [remoteEntries, typeFilter]);

  useEffect(() => {
    if (activeSessionId) navigateRemote(activeSessionId, remotePath);
  }, [activeSessionId]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.ctrlKey && e.key === "a") { e.preventDefault(); selectAllRemote(); }
      if (e.ctrlKey && e.key === "f") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F5") { e.preventDefault(); if (activeSessionId) refreshRemote(activeSessionId); }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectAllRemote, refreshRemote, activeSessionId]);

  function handleNavigate(path: string) {
    if (!activeSessionId) return;
    navigateRemote(activeSessionId, path);
    setRemoteTerminalCwd(path);
  }

  async function handleDownload(entry: { path: string; name: string; is_dir: boolean }) {
    if (!activeSessionId) return;
    const localDest = joinLocalPath(localPath, entry.name);
    try {
      if (entry.is_dir) {
        await api.downloadDirectory(activeSessionId, entry.path, localDest);
        toast.success("Download queued", `${entry.name} directory queued`);
      } else {
        const result = await preflightCheck(
          [{ name: entry.name, destPath: localDest }],
          (p) => api.localPathExists(p),
        );
        if (!result.proceed || result.skipPaths.has(localDest)) return;
        await api.downloadFile(activeSessionId, entry.path, localDest);
      }
      await store.refreshLocal();
    } catch (e: any) {
      toast.error("Download failed", errMsg(e));
    }
  }

  async function handleDelete(entry: { path: string; name: string; is_dir: boolean }) {
    const ok = await confirm({
      title: "Delete remote file",
      message: `Delete "${entry.name}" on remote server? This cannot be undone.`,
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok || !activeSessionId) return;

    setPendingDeletes((m) => new Map(m).set(entry.path, entry.name));
    try {
      await api.deleteRemote(activeSessionId, entry.path, entry.is_dir, true);
      await refreshRemote(activeSessionId);
      toast.success("Deleted", entry.name);
    } catch (e: any) {
      toast.error("Delete failed", errMsg(e));
    } finally {
      setPendingDeletes((m) => { const n = new Map(m); n.delete(entry.path); return n; });
    }
  }

  async function handleRename(entry: { path: string; name: string }, newName: string) {
    if (!activeSessionId) return;
    const dir = entry.path.substring(0, entry.path.lastIndexOf("/")) || "/";
    const newPath = `${dir}/${newName}`;
    try {
      await api.renameRemote(activeSessionId, entry.path, newPath);
      await refreshRemote(activeSessionId);
    } catch (e: any) {
      toast.error("Rename failed", errMsg(e));
    }
  }

  function startCreateFolder() {
    setFolderName("");
    setCreatingFolder(true);
    setTimeout(() => folderInputRef.current?.focus(), 0);
  }

  async function commitCreateFolder() {
    const name = folderName.trim();
    setCreatingFolder(false);
    setFolderName("");
    if (!name || !activeSessionId) return;
    try {
      await api.createRemoteDir(activeSessionId, `${remotePath}/${name}`);
      await refreshRemote(activeSessionId);
      toast.success("Folder created", name);
    } catch (e: any) {
      toast.error("Create failed", errMsg(e));
    }
  }

  async function handleBulkDownload() {
    if (!activeSessionId) return;
    const entries = remoteEntries.filter((e) => selectedRemote.has(e.path));
    const dirs  = entries.filter((e) => e.is_dir);
    const files = entries.filter((e) => !e.is_dir);

    let skipPaths = new Set<string>();
    if (files.length > 0) {


      const result = await preflightCheck(
        files.map((e) => ({ name: e.name, destPath: joinLocalPath(localPath, e.name) })),
        (p) => api.localPathExists(p),
      );
      if (!result.proceed) return;
      skipPaths = result.skipPaths;
    }

    for (const e of dirs) {
      try { await api.downloadDirectory(activeSessionId, e.path, joinLocalPath(localPath, e.name)); }
      catch (err: any) { toast.error(`Download failed: ${e.name}`, errMsg(err)); }
    }
    for (const e of files) {
      const dest = joinLocalPath(localPath, e.name);
      if (skipPaths.has(dest)) continue;
      try { await api.downloadFile(activeSessionId, e.path, dest); }
      catch (err: any) { toast.error(`Download failed: ${e.name}`, errMsg(err)); }
    }
    await store.refreshLocal();
    clearSelection();
    toast.success("Download done", `${entries.length} item(s) processed`);
  }

  async function handleBulkDelete() {
    if (!activeSessionId) return;
    const entries = remoteEntries.filter((e) => selectedRemote.has(e.path));
    const ok = await confirm({
      title: "Delete files",
      message: `Delete ${entries.length} item(s) from remote server? This cannot be undone.`,
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;

    setPendingDeletes((m) => {
      const n = new Map(m);
      entries.forEach((e) => n.set(e.path, e.name));
      return n;
    });
    try {
      await api.deleteBatch(activeSessionId, entries.map((e) => [e.path, e.is_dir] as [string, boolean]));
    } catch (err: any) {
      toast.error("Bulk delete failed", errMsg(err));
    } finally {
      setPendingDeletes((m) => {
        const n = new Map(m);
        entries.forEach((e) => n.delete(e.path));
        return n;
      });
    }
    await refreshRemote(activeSessionId);
    clearSelection();
    toast.success("Deleted", `${entries.length} item(s) removed`);
  }

  async function handleChmod(path: string, mode: number) {
    if (!activeSessionId) return;
    try {
      await api.chmodRemote(activeSessionId, path, mode);
      await refreshRemote(activeSessionId);
      toast.success("Permissions updated", path);
    } catch (e: any) {
      toast.error("chmod failed", errMsg(e));
    }
  }

  function handleCtxMenu(e: React.MouseEvent, entry: { path: string; name: string; is_dir: boolean; permissions: number | null }) {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, entry });
  }

  function buildCtxItems(entry: { path: string; name: string; is_dir: boolean; permissions: number | null }): ContextMenuEntry[] {
    const items: ContextMenuEntry[] = [];
    if (entry.is_dir) {
      items.push({ label: "Open", icon: <Server size={12} />, onClick: () => handleNavigate(entry.path) });
    } else {
      items.push({ label: "Download", icon: <Download size={12} />, onClick: () => handleDownload(entry) });
    }
    items.push({ separator: true });
    items.push({ label: "Rename", icon: <FileEdit size={12} />, onClick: () => setRenamingPath(entry.path) });
    items.push({ label: "Copy Path", icon: <Copy size={12} />, onClick: () => navigator.clipboard.writeText(entry.path) });
    items.push({ label: "Permissions (chmod)", icon: <Lock size={12} />, onClick: () => setChmodTarget({ path: entry.path, perm: entry.permissions ?? 0o644 }) });
    items.push({ separator: true });
    items.push({ label: "Delete", icon: <Trash2 size={12} />, onClick: () => handleDelete(entry), danger: true });
    return items;
  }

  function buildDragItems(entry: { path: string; name: string; is_dir: boolean }): DragItem[] {
    if (selectedRemote.has(entry.path) && selectedRemote.size > 1) {
      return remoteEntries
        .filter((e) => selectedRemote.has(e.path))
        .map((e) => ({ path: e.path, name: e.name, is_dir: e.is_dir }));
    }
    return [{ path: entry.path, name: entry.name, is_dir: entry.is_dir }];
  }

  const handlePaneDrop = useCallback(async (e: React.DragEvent, targetDir?: string) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOverPane(false);
    if (!activeSessionId) return;

    const dest = targetDir ?? remotePath;
    const stripMeta = useSettingsStore.getState().autoStripMetadata;

    if (e.dataTransfer.files.length > 0) {
      const osFiles = Array.from(e.dataTransfer.files)
        .map((f) => ({ file: f, path: (f as any).path as string | undefined }))
        .filter((x): x is { file: File; path: string } => {
          if (!x.path) { toast.warning("Drop failed", "Cannot read file path from OS drop"); return false; }
          return true;
        });


      const result = await preflightCheck(
        osFiles.map((x) => ({ name: x.file.name, destPath: `${dest}/${x.file.name}` })),
        (p) => api.statRemote(activeSessionId, p).then(() => true).catch(() => false),
      );
      if (!result.proceed) return;

      for (const { file, path: filePath } of osFiles) {
        const target = `${dest}/${file.name}`;
        if (result.skipPaths.has(target)) continue;
        try {
          if (stripMeta) await api.uploadFileClean(activeSessionId, filePath, target);
          else           await api.uploadFile(activeSessionId, filePath, target);
        } catch (err: any) {
          toast.error(`Upload failed: ${file.name}`, errMsg(err));
        }
      }
      await refreshRemote(activeSessionId);
      return;
    }

    const raw = e.dataTransfer.getData("pylon/local-paths");
    if (!raw) return;

    let items: DragItem[];
    try { items = JSON.parse(raw); } catch { return; }

    const dirs  = items.filter((i) => i.is_dir);
    const files = items.filter((i) => !i.is_dir);

    let skipPaths = new Set<string>();
    if (files.length > 0) {
      const result = await preflightCheck(
        files.map((i) => ({ name: i.name, destPath: `${dest}/${i.name}` })),
        (p) => api.statRemote(activeSessionId, p).then(() => true).catch(() => false),
      );
      if (!result.proceed) return;
      skipPaths = result.skipPaths;
    }

    for (const item of dirs) {
      try {
        await api.uploadDirectory(activeSessionId, item.path, `${dest}/${item.name}`, stripMeta);
        toast.success("Upload queued", `${item.name} directory`);
      } catch (err: any) { toast.error(`Upload failed: ${item.name}`, errMsg(err)); }
    }
    for (const item of files) {
      const target = `${dest}/${item.name}`;
      if (skipPaths.has(target)) continue;
      try {
        if (stripMeta) await api.uploadFileClean(activeSessionId, item.path, target);
        else           await api.uploadFile(activeSessionId, item.path, target);
      } catch (err: any) { toast.error(`Upload failed: ${item.name}`, errMsg(err)); }
    }
    await refreshRemote(activeSessionId);
    if (items.length > 1) toast.success("Upload queued", `${items.length} items`);
  }, [activeSessionId, remotePath, refreshRemote, preflightCheck]);

  const canGoBack    = remoteHistoryIndex > 0;
  const canGoForward = remoteHistoryIndex < remoteHistory.length - 1;
  const isFiltering  = remoteFilter.trim() !== "" || typeFilter !== "all";

  if (!activeSessionId) {
    return (
      <div className="flex flex-col h-full bg-void-800 items-center justify-center gap-3 text-slate-600">
        <Server size={36} className="opacity-30" />
        <p className="text-sm">Connect to a server to browse</p>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col h-full bg-void-800 transition-colors ${dragOverPane ? "bg-pylon-cyan/5 ring-1 ring-inset ring-pylon-cyan/30" : ""}`}
      onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setDragOverPane(true); }}
      onDragOver={(e) => { e.preventDefault(); }}
      onDragLeave={() => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setDragOverPane(false); } }}
      onDrop={(e) => handlePaneDrop(e)}
    >
      <div className="flex items-center gap-1.5 px-3 py-2 bg-void-900 border-b border-void-600">
        <Server size={13} className="text-pylon-violet shrink-0" />
        <span className="text-[10px] font-bold text-pylon-violet tracking-widest uppercase shrink-0">Remote</span>

        <button onClick={() => navigateRemoteBack(activeSessionId)} disabled={!canGoBack}
          className="p-0.5 rounded hover:bg-void-700 text-slate-600 disabled:opacity-30 transition-colors">
          <ChevronLeft size={11} />
        </button>
        <button onClick={() => navigateRemoteForward(activeSessionId)} disabled={!canGoForward}
          className="p-0.5 rounded hover:bg-void-700 text-slate-600 disabled:opacity-30 transition-colors">
          <ChevronRight size={11} />
        </button>

        <div className="flex-1 min-w-0 overflow-hidden">
          <PathBreadcrumb path={remotePath} side="remote" onNavigate={handleNavigate} />
        </div>

        <button onClick={toggleHidden} title={showHidden ? "Hide hidden files" : "Show hidden files"}
          className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-300 transition-colors">
          {showHidden ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        <button onClick={startCreateFolder} title="New folder"
          className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-pylon-cyan transition-colors">
          <FolderPlus size={12} />
        </button>
        <button
          onClick={async () => { setRefreshing(true); try { await refreshRemote(activeSessionId); } finally { setRefreshing(false); } }}
          title="Refresh (F5)"
          className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-300 transition-colors"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
        </button>
        <div className="w-px h-3 bg-void-600 mx-0.5" />
        <button
          onClick={() => disconnectFromServer(activeSessionId)}
          title="Disconnect"
          className="p-1 rounded hover:bg-pylon-red/15 text-slate-600 hover:text-pylon-red transition-colors"
        >
          <Unplug size={12} />
        </button>
      </div>

      <PaneSearchBar
        value={remoteFilter}
        onChange={setRemoteFilter}
        matchCount={displayedEntries.length}
        totalCount={remoteAllCount}
        inputRef={searchRef}
        side="remote"
        typeFilter={typeFilter}
        onTypeFilter={setTypeFilter}
        regexMode={remoteRegexMode}
        onRegexToggle={() => setRemoteRegexMode(!remoteRegexMode)}
      />

      <FileHeader sort={remoteSort} onSort={setRemoteSort} showPermissions />

      {overwritePolicy !== "ask" && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-pylon-amber/8 border-b border-pylon-amber/20 shrink-0">
          <span className="text-[11px] text-pylon-amber flex-1">
            Policy: {overwritePolicy === "overwrite_all" ? "Overwrite all" : "Skip all"} — applies to this session
          </span>
          <button
            onClick={() => setOverwritePolicy("ask")}
            className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
            title="Reset to Ask"
          >
            Reset ×
          </button>
        </div>
      )}

      <AnimatePresence>
        {creatingFolder && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 px-3 py-1.5 bg-pylon-cyan/5 border-b border-pylon-cyan/20 shrink-0"
          >
            <FolderPlus size={12} className="text-pylon-cyan shrink-0" />
            <input
              ref={folderInputRef}
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCreateFolder();
                if (e.key === "Escape") { setCreatingFolder(false); setFolderName(""); }
              }}
              placeholder="New folder name…"
              className="flex-1 bg-transparent text-xs text-slate-200 placeholder-slate-600 outline-none font-mono"
            />
            <button onClick={commitCreateFolder}
              className="p-0.5 rounded hover:bg-pylon-cyan/20 text-pylon-cyan transition-colors">
              <Check size={11} />
            </button>
            <button onClick={() => { setCreatingFolder(false); setFolderName(""); }}
              className="p-0.5 rounded hover:bg-void-700 text-slate-600 hover:text-slate-300 transition-colors">
              <X size={11} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto overflow-x-auto relative">
        {remoteLoading ? (
          <div className="flex items-center justify-center h-20 text-slate-600 text-sm">Loading…</div>
        ) : remoteError ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 px-4">
            <p className="text-xs text-pylon-red/80 text-center font-mono">{remoteError}</p>
            <button onClick={() => refreshRemote(activeSessionId!)} className="text-xs text-slate-500 hover:text-slate-300 underline">Retry</button>
          </div>
        ) : (
          <>
            {Array.from(pendingDeletes.entries()).map(([path, name]) => (
              <motion.div
                key={`del-${path}`}
                initial={{ opacity: 1 }}
                animate={{ opacity: [1, 0.4, 1, 0.4, 1, 0] }}
                transition={{ duration: 1.2, repeat: Infinity, repeatType: "loop" }}
                className="relative flex items-center gap-2 px-3 py-1.5 text-sm border-b border-void-700/30 bg-pylon-red/5"
              >
                <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-pylon-red opacity-80" />
                <Trash2 size={12} className="text-pylon-red/60 shrink-0" />
                <span className="flex-1 min-w-0 text-xs text-pylon-red/70 truncate line-through">{name}</span>
                <span className="text-[10px] text-pylon-red/50 font-mono shrink-0">Deleting…</span>
              </motion.div>
            ))}
            {batches
              .filter((b) => {
                const nd = (p: string) => p.replace(/[\\/]+$/, "") || "/";
                return b.direction === "upload" && nd(b.remoteDir) === nd(remotePath) && b.sessionId === activeSessionId;
              })
              .map((b) => <GhostBatchRow key={b.batchId} batch={b} />)
            }
            {ghosts
              .filter((g) => {
                const nd = (p: string) => p.replace(/[\\/]+$/, "") || "/";
                return g.direction === "upload" && nd(g.remoteDir) === nd(remotePath) && g.sessionId === activeSessionId;
              })
              .map((g) => <GhostFileRow key={g.transferId} ghost={g} />)
            }
            {displayedEntries.length === 0 && pendingDeletes.size === 0 &&
             ghosts.filter((g) => g.direction === "upload" && g.remoteDir === remotePath).length === 0 &&
             batches.filter((b) => b.direction === "upload" && b.remoteDir === remotePath).length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-600">
                <Server size={28} className="opacity-30" />
                <p className="text-xs">
                  {isFiltering ? `No matches${remoteFilter ? ` for "${remoteFilter}"` : ""}` : "Empty folder"}
                </p>
                {isFiltering && (
                  <button
                    onClick={() => { setRemoteFilter(""); setTypeFilter("all"); }}
                    className="text-[10px] text-pylon-violet/60 hover:text-pylon-violet underline transition-colors"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : null}
            {displayedEntries.map((entry, idx) => (
              <FileRow
                key={entry.path}
                name={entry.name}
                path={entry.path}
                isDir={entry.is_dir}
                isSymlink={entry.is_symlink}
                symlinkTarget={entry.symlink_target}
                size={entry.size}
                modified={entry.modified ?? null}
                permissions={entry.permissions}
                selected={selectedRemote.has(entry.path)}
                index={idx}
                showPermissions
                filterQuery={remoteFilter}
                onSelect={(i, shift, ctrl) => selectRemote(entry.path, i, shift, ctrl)}
                onOpen={() => entry.is_dir ? handleNavigate(entry.path) : undefined}
                onRename={(newName) => handleRename(entry, newName)}
                autoRename={renamingPath === entry.path}
                onAutoRenameDone={() => setRenamingPath(null)}
                onContextMenu={(e) => handleCtxMenu(e, { ...entry, permissions: entry.permissions ?? null })}
                draggable
                onDragStart={(e) => {
                  const items = buildDragItems(entry);
                  e.dataTransfer.setData("pylon/remote-paths", JSON.stringify(items));
                  e.dataTransfer.effectAllowed = "copyMove";
                }}
                onDrop={entry.is_dir ? (e) => handlePaneDrop(e, entry.path) : undefined}
                actions={[
                  { label: "Download", icon: <Download size={11} />, onClick: () => handleDownload(entry) },
                  { label: "Delete", icon: <Trash2 size={11} className="text-pylon-red/60" />, onClick: () => handleDelete(entry), danger: true },
                ]}
              />
            ))}
          </>
        )}
        <AnimatePresence>
          {selectedRemote.size > 0 && (
            <BulkToolbar
              key="bulk"
              count={selectedRemote.size}
              side="remote"
              onDownload={handleBulkDownload}
              onDelete={handleBulkDelete}
              onDeselect={clearSelection}
            />
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {ctx && (
          <ContextMenu
            key="ctx"
            x={ctx.x} y={ctx.y}
            items={buildCtxItems(ctx.entry)}
            onClose={() => setCtx(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {chmodTarget && (
          <ChmodModal
            key="chmod"
            path={chmodTarget.path}
            currentPerm={chmodTarget.perm}
            onApply={(mode) => handleChmod(chmodTarget.path, mode)}
            onClose={() => setChmodTarget(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {conflictModalState.open && (
          <OverwriteModal
            key="overwrite"
            conflicts={conflictModalState.conflicts}
            onChoice={handleConflictChoice}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
