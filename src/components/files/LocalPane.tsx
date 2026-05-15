import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import {
  ChevronLeft, ChevronRight, Eye, EyeOff,
  FolderOpen, HardDrive, RefreshCw, Shield, Upload,
} from "lucide-react";
import { useFileStore } from "../../stores/fileStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useConfirm } from "../ui/ConfirmDialog";
import { toast } from "../../stores/toastStore";
import { FileRow } from "./FileRow";
import { FileHeader } from "./FileHeader";
import { BulkToolbar } from "./BulkToolbar";
import { PathBreadcrumb } from "./PathBreadcrumb";
import { ContextMenu, ContextMenuEntry } from "./ContextMenu";
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
import { Copy, FolderOpen as OpenFolder } from "lucide-react";

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
interface CtxState { x: number; y: number; entry: { path: string; name: string; is_dir: boolean } }

export function LocalPane() {
  const store = useFileStore();
  const {
    localPath, localEntries, localAllCount, localLoading, selectedLocal,
    localSort, localFilter, localRegexMode, showHidden, overwritePolicy, setOverwritePolicy,
    navigateLocal, navigateLocalBack, navigateLocalForward,
    selectLocal, selectAllLocal, clearSelection,
    setLocalSort, setLocalFilter, setLocalRegexMode, toggleHidden,
    refreshLocal, localHistory, localHistoryIndex,
  } = store;
  const { activeSessionId } = useConnectionStore();
  const { remotePath } = store;
  const { ghosts, batches } = useGhostStore();
  const confirm = useConfirm();
  const { modalState: conflictModalState, handleChoice: handleConflictChoice, preflightCheck } = useOverwriteDecision();
  const searchRef = useRef<HTMLInputElement>(null);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [dragOverPane, setDragOverPane] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const dragCounter = useRef(0);

  const displayedEntries = useMemo(() => {
    if (typeFilter === "all") return localEntries;
    return localEntries.filter((e) => matchesType(e, typeFilter));
  }, [localEntries, typeFilter]);

  useEffect(() => { navigateLocal(localPath); }, []);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.ctrlKey && e.key === "a") { e.preventDefault(); selectAllLocal(); }
      if (e.ctrlKey && e.key === "f") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F5") { e.preventDefault(); refreshLocal(); }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectAllLocal, refreshLocal]);

  async function handleUpload(entry: { path: string; name: string; is_dir: boolean }) {
    if (!activeSessionId) { toast.warning("No connection", "Connect to a server first"); return; }
    const target = `${remotePath}/${entry.name}`;
    const stripMeta = useSettingsStore.getState().autoStripMetadata;
    try {
      if (entry.is_dir) {
        await api.uploadDirectory(activeSessionId, entry.path, target, stripMeta);
        toast.success("Upload queued", `${entry.name} directory queued`);
      } else {
        const result = await preflightCheck(
          [{ name: entry.name, destPath: target }],
          (p) => api.statRemote(activeSessionId, p).then(() => true).catch(() => false),
        );
        if (!result.proceed || result.skipPaths.has(target)) return;
        if (stripMeta) await api.uploadFileClean(activeSessionId, entry.path, target);
        else           await api.uploadFile(activeSessionId, entry.path, target);
      }
      await store.refreshRemote(activeSessionId);
    } catch (e: any) {
      toast.error("Upload failed", errMsg(e));
    }
  }

  async function handleUploadClean(entry: { path: string; name: string }) {
    if (!activeSessionId) { toast.warning("No connection", "Connect to a server first"); return; }
    const target = `${remotePath}/${entry.name}`;
    try {
      const result = await preflightCheck(
        [{ name: entry.name, destPath: target }],
        (p) => api.statRemote(activeSessionId, p).then(() => true).catch(() => false),
      );
      if (!result.proceed || result.skipPaths.has(target)) return;
      await api.uploadFileClean(activeSessionId, entry.path, target);
      await store.refreshRemote(activeSessionId);
    } catch (e: any) {
      toast.error("Upload failed", errMsg(e));
    }
  }

  async function handleBulkUpload(clean: boolean) {
    if (!activeSessionId) { toast.warning("No connection", "Connect to a server first"); return; }
    const entries = localEntries.filter((e) => selectedLocal.has(e.path));
    const stripMeta = clean || useSettingsStore.getState().autoStripMetadata;
    const dirs  = entries.filter((e) => e.is_dir);
    const files = entries.filter((e) => !e.is_dir);

    if (files.length > 0) {

      const result = await preflightCheck(
        files.map((e) => ({ name: e.name, destPath: `${remotePath}/${e.name}` })),
        (p) => api.statRemote(activeSessionId, p).then(() => true).catch(() => false),
      );
      if (!result.proceed) return;
      for (const e of files) {
        const target = `${remotePath}/${e.name}`;
        if (result.skipPaths.has(target)) continue;
        try {
          if (stripMeta) await api.uploadFileClean(activeSessionId, e.path, target);
          else           await api.uploadFile(activeSessionId, e.path, target);
        } catch (err: any) {
          toast.error(`Upload failed: ${e.name}`, errMsg(err));
        }
      }
    }

    for (const e of dirs) {
      try {
        await api.uploadDirectory(activeSessionId, e.path, `${remotePath}/${e.name}`, stripMeta);
      } catch (err: any) {
        toast.error(`Upload failed: ${e.name}`, errMsg(err));
      }
    }

    await store.refreshRemote(activeSessionId);
    clearSelection();
    toast.success("Upload done", `${entries.length} item(s) processed`);
  }

  async function handleBulkDelete() {
    const entries = localEntries.filter((e) => selectedLocal.has(e.path));
    const ok = await confirm({
      title: "Delete files",
      message: `Delete ${entries.length} item(s) from local filesystem? This cannot be undone.`,
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteLocalBatch(entries.map((e) => e.path));
      await store.refreshLocal();
      clearSelection();
      toast.success("Deleted", `${entries.length} item(s) removed`);
    } catch (e: any) {
      toast.error("Delete failed", errMsg(e));
    }
  }

  async function handleOpenInFileManager(path: string) {
    try { await api.openInFileManager(path); } catch (e: any) { toast.error("Failed", errMsg(e)); }
  }

  function handleCtxMenu(e: React.MouseEvent, entry: { path: string; name: string; is_dir: boolean }) {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, entry });
  }

  function buildCtxItems(entry: { path: string; name: string; is_dir: boolean }): ContextMenuEntry[] {
    const items: ContextMenuEntry[] = [
      { label: "Open", icon: <OpenFolder size={12} />, onClick: () => entry.is_dir ? navigateLocal(entry.path) : undefined },
      { separator: true },
    ];
    if (activeSessionId && !entry.is_dir) {
      items.push({ label: "Upload", icon: <Upload size={12} />, onClick: () => handleUpload(entry) });
      items.push({ label: "Upload (Clean)", icon: <Shield size={12} className="text-pylon-amber" />, onClick: () => handleUploadClean(entry) });
      items.push({ separator: true });
    }
    items.push({ label: "Copy Path", icon: <Copy size={12} />, onClick: () => navigator.clipboard.writeText(entry.path) });
    items.push({ label: "Show in File Manager", icon: <FolderOpen size={12} />, onClick: () => handleOpenInFileManager(entry.path) });
    return items;
  }

  function buildDragItems(entry: { path: string; name: string; is_dir: boolean }): DragItem[] {
    if (selectedLocal.has(entry.path) && selectedLocal.size > 1) {
      return localEntries
        .filter((e) => selectedLocal.has(e.path))
        .map((e) => ({ path: e.path, name: e.name, is_dir: e.is_dir }));
    }
    return [{ path: entry.path, name: entry.name, is_dir: entry.is_dir }];
  }

  const handlePaneDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOverPane(false);
    if (!activeSessionId) return;

    const raw = e.dataTransfer.getData("pylon/remote-paths");
    if (!raw) return;

    let items: DragItem[];
    try { items = JSON.parse(raw); } catch { return; }

    const dirs  = items.filter((i) => i.is_dir);
    const files = items.filter((i) => !i.is_dir);

    let skipPaths = new Set<string>();
    if (files.length > 0) {

      const result = await preflightCheck(
        files.map((i) => ({ name: i.name, destPath: joinLocalPath(localPath, i.name) })),
        (p) => api.localPathExists(p),
      );
      if (!result.proceed) return;
      skipPaths = result.skipPaths;
    }

    for (const item of dirs) {
      try { await api.downloadDirectory(activeSessionId, item.path, joinLocalPath(localPath, item.name)); }
      catch (err: any) { toast.error(`Download failed: ${item.name}`, errMsg(err)); }
    }
    for (const item of files) {
      const dest = joinLocalPath(localPath, item.name);
      if (skipPaths.has(dest)) continue;
      try { await api.downloadFile(activeSessionId, item.path, dest); }
      catch (err: any) { toast.error(`Download failed: ${item.name}`, errMsg(err)); }
    }
    await store.refreshLocal();
    if (items.length > 1) toast.success("Download queued", `${items.length} items`);
  }, [activeSessionId, localPath, store, preflightCheck]);

  const canGoBack    = localHistoryIndex > 0;
  const canGoForward = localHistoryIndex < localHistory.length - 1;
  const isFiltering  = localFilter.trim() !== "" || typeFilter !== "all";

  return (
    <div
      className={`flex flex-col h-full bg-void-800 border-r border-void-600 transition-colors ${dragOverPane ? "bg-pylon-violet/5 ring-1 ring-inset ring-pylon-violet/30" : ""}`}
      onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setDragOverPane(true); }}
      onDragOver={(e) => { e.preventDefault(); }}
      onDragLeave={() => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setDragOverPane(false); } }}
      onDrop={(e) => handlePaneDrop(e)}
    >
      <div className="flex items-center gap-1.5 px-3 py-2 bg-void-900 border-b border-void-600">
        <HardDrive size={13} className="text-pylon-cyan shrink-0" />
        <span className="text-[10px] font-bold text-pylon-cyan tracking-widest uppercase shrink-0">Local</span>

        <button onClick={navigateLocalBack} disabled={!canGoBack}
          className="p-0.5 rounded hover:bg-void-700 text-slate-600 disabled:opacity-30 transition-colors">
          <ChevronLeft size={11} />
        </button>
        <button onClick={navigateLocalForward} disabled={!canGoForward}
          className="p-0.5 rounded hover:bg-void-700 text-slate-600 disabled:opacity-30 transition-colors">
          <ChevronRight size={11} />
        </button>

        <div className="flex-1 min-w-0 overflow-hidden">
          <PathBreadcrumb path={localPath} side="local" onNavigate={navigateLocal} />
        </div>

        <button onClick={toggleHidden} title={showHidden ? "Hide hidden files" : "Show hidden files"}
          className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-300 transition-colors">
          {showHidden ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        <button
          onClick={async () => { setRefreshing(true); try { await refreshLocal(); } finally { setRefreshing(false); } }}
          title="Refresh (F5)"
          className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-300 transition-colors"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      <PaneSearchBar
        value={localFilter}
        onChange={setLocalFilter}
        matchCount={displayedEntries.length}
        totalCount={localAllCount}
        inputRef={searchRef}
        side="local"
        typeFilter={typeFilter}
        onTypeFilter={setTypeFilter}
        regexMode={localRegexMode}
        onRegexToggle={() => setLocalRegexMode(!localRegexMode)}
      />

      <FileHeader sort={localSort} onSort={setLocalSort} />

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

      <div className="flex-1 overflow-y-auto overflow-x-auto relative">
        {localLoading ? (
          <div className="flex items-center justify-center h-20 text-slate-600 text-sm">Loading…</div>
        ) : (
          <>
            {batches
              .filter((b) => {
                const nd = (p: string) => p.replace(/[\\/]+$/, "") || "/";
                return b.direction === "download" && nd(b.localDir) === nd(localPath) && b.sessionId === activeSessionId;
              })
              .map((b) => <GhostBatchRow key={b.batchId} batch={b} />)
            }
            {ghosts
              .filter((g) => {
                const nd = (p: string) => p.replace(/[\\/]+$/, "") || "/";
                return g.direction === "download" && nd(g.localDir) === nd(localPath) && g.sessionId === activeSessionId;
              })
              .map((g) => <GhostFileRow key={g.transferId} ghost={g} />)
            }
            {displayedEntries.length === 0 &&
             ghosts.filter((g) => g.direction === "download" && g.localDir === localPath).length === 0 &&
             batches.filter((b) => b.direction === "download" && b.localDir === localPath).length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-600">
                <FolderOpen size={28} className="opacity-30" />
                <p className="text-xs">
                  {isFiltering ? `No matches${localFilter ? ` for "${localFilter}"` : ""}` : "Empty folder"}
                </p>
                {isFiltering && (
                  <button
                    onClick={() => { setLocalFilter(""); setTypeFilter("all"); }}
                    className="text-[10px] text-pylon-cyan/60 hover:text-pylon-cyan underline transition-colors"
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
                size={entry.size}
                modified={entry.modified ?? null}
                selected={selectedLocal.has(entry.path)}
                index={idx}
                filterQuery={localFilter}
                onSelect={(i, shift, ctrl) => selectLocal(entry.path, i, shift, ctrl)}
                onOpen={() => entry.is_dir ? navigateLocal(entry.path) : undefined}
                onContextMenu={(e) => handleCtxMenu(e, entry)}
                draggable={!!activeSessionId}
                onDragStart={(e) => {
                  const items = buildDragItems(entry);
                  e.dataTransfer.setData("pylon/local-paths", JSON.stringify(items));
                  e.dataTransfer.effectAllowed = "copyMove";
                }}
                actions={
                  activeSessionId && !entry.is_dir
                    ? [
                        { label: "Upload", icon: <Upload size={11} />, onClick: () => handleUpload(entry) },
                        { label: "Upload Clean", icon: <Shield size={11} className="text-pylon-amber" />, onClick: () => handleUploadClean(entry) },
                      ]
                    : []
                }
              />
            ))}
          </>
        )}

        <AnimatePresence>
          {selectedLocal.size > 0 && (
            <BulkToolbar
              key="bulk"
              count={selectedLocal.size}
              side="local"
              onUpload={() => handleBulkUpload(false)}
              onUploadClean={() => handleBulkUpload(true)}
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
