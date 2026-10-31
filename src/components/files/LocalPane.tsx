import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import {
  AppWindow, Copy, ExternalLink, FolderOpen, FolderPlus, HardDrive, Pencil, RefreshCw, Shield, Trash2, Upload,
} from "lucide-react";
import { useFileStore } from "../../stores/fileStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useGhostStore } from "../../stores/ghostStore";
import { useDragStore } from "../../stores/dragStore";
import { useConfirm } from "../ui/ConfirmDialog";
import { toast } from "../../stores/toastStore";
import { FileList, Row } from "./FileList";
import { BulkToolbar } from "./BulkToolbar";
import { PathBreadcrumb } from "./PathBreadcrumb";
import { ContextMenu, ContextMenuEntry } from "./ContextMenu";
import { GhostFileRow } from "./GhostFileRow";
import { GhostBatchRow } from "./GhostBatchRow";
import { PaneSearchBar, TypeFilter } from "./PaneSearchBar";
import { EmptyState, LoadingBar, matchesType, PaneHeader, usePaneKeyboard } from "./paneShared";
import { IconButton } from "../ui/primitives";
import * as api from "../../lib/tauri";
import { errMsg } from "../../lib/format";
import { downloadItems, Item, moveItems, uploadItems } from "../../lib/fileOps";
import { isMac, modKey, normalizeLocal, parentLocal, sameDir } from "../../lib/path";
import { PolicyBanner, NewFolderRow } from "./RemotePane";

const STRIPPABLE = /\.(jpe?g|png|webp|gif|pdf)$/i;

export function LocalPane() {
  const fs = useFileStore();
  const {
    localPath, localEntries, localAllCount, localLoading, localError, selectedLocal, cursorLocal, activePane,
    localSort, localFilter, localRegexMode, localHistory, localHistoryIndex,
    navigateLocal, navigateLocalBack, navigateLocalForward, selectLocal, clearSelection,
    setLocalSort, setLocalFilter, setLocalRegexMode, refreshLocal, remotePath, setActivePane,
  } = fs;
  const activeSessionId = useConnectionStore((s) => s.activeSessionId);
  const { ghosts, batches } = useGhostStore();
  const confirm = useConfirm();
  const searchRef = useRef<HTMLInputElement>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; row: Row | null } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [editPath, setEditPath] = useState(0);
  const [home, setHome] = useState<string | null>(null);

  useEffect(() => { api.getHomeDir().then(setHome).catch(() => {}); }, []);

  const rows: Row[] = useMemo(
    () => (typeFilter === "all" ? localEntries : localEntries.filter((e) => matchesType(e, typeFilter))),
    [localEntries, typeFilter],
  );
  const selectedRows = useMemo(() => localEntries.filter((e) => selectedLocal.has(e.path)), [localEntries, selectedLocal]);
  const toItems = (list: Row[]): Item[] => list.map((r) => ({ path: r.path, name: r.name, is_dir: r.is_dir }));
  const targets = (row: Row | null) => (row && !selectedLocal.has(row.path) ? [row] : selectedRows.length ? selectedRows : row ? [row] : []);

  useEffect(
    () =>
      useDragStore.getState().registerHandler("local", (items, source, targetDir) => {
        const sid = useConnectionStore.getState().activeSessionId;
        if (source === "remote" && sid) downloadItems(sid, items, targetDir ?? useFileStore.getState().localPath);
        else if (source === "local" && targetDir) moveItems("local", sid, items, targetDir);
      }),
    [],
  );

  const open = useCallback(
    (row: Row) => {
      if (row.is_dir) navigateLocal(row.path);
      else api.openInFileManager(row.path).catch((e) => toast.error("Could not open file", errMsg(e)));
    },
    [navigateLocal],
  );

  async function upload(list: Row[], strip?: boolean) {
    if (!activeSessionId) { toast.info("Not connected", "Connect to a server to upload"); return; }
    await uploadItems(activeSessionId, toItems(list), useFileStore.getState().remotePath, { strip });
  }

  async function remove(list: Row[]) {
    if (!list.length) return;
    if (useSettingsStore.getState().confirmDeletes) {
      const ok = await confirm({
        title: list.length === 1 ? `Delete “${list[0].name}”?` : `Delete ${list.length} items?`,
        message: "They are deleted from this computer permanently (not moved to the trash).",
        danger: true,
        confirmLabel: "Delete",
      });
      if (!ok) return;
    }
    try {
      await api.deleteLocalBatch(list.map((r) => r.path));
      toast.success("Deleted", list.length === 1 ? list[0].name : `${list.length} items`);
    } catch (e) {
      toast.error("Delete failed", errMsg(e));
    }
    clearSelection();
    refreshLocal();
  }

  async function rename(row: Row, name: string) {
    setRenaming(null);
    try {
      await api.renameLocal(row.path, name);
      await refreshLocal();
    } catch (e) {
      toast.error("Rename failed", errMsg(e));
    }
  }

  async function createFolder(name: string) {
    setCreating(false);
    if (!name.trim()) return;
    try {
      const p = await api.createLocalDir(localPath, name.trim());
      await refreshLocal();
      useFileStore.getState().selectLocal(normalizeLocal(p), 0, false, false);
    } catch (e) {
      toast.error("Could not create folder", errMsg(e));
    }
  }

  async function stripInPlace(list: Row[]) {
    const files = list.filter((r) => !r.is_dir && STRIPPABLE.test(r.name));
    if (!files.length) return;
    const ok = await confirm({
      title: "Remove metadata?",
      message: `Strips EXIF/GPS, comments and document properties from ${files.length === 1 ? `“${files[0].name}”` : `${files.length} files`} in place. Image data is not re-encoded.`,
      confirmLabel: "Remove metadata",
    });
    if (!ok) return;
    let removed = 0;
    for (const f of files) {
      try {
        const r = await api.stripFileMetadata(f.path);
        removed += r.fields_stripped;
      } catch (e) {
        toast.error(`Could not clean ${f.name}`, errMsg(e));
      }
    }
    toast.success("Metadata removed", `${files.length} file(s) · ${removed} field(s)`);
    refreshLocal();
  }

  usePaneKeyboard("local", {
    rows,
    onOpen: open,
    onUp: () => navigateLocal(parentLocal(localPath)),
    onDelete: () => remove(selectedRows),
    onRename: (r) => setRenaming(r.path),
    onRefresh: refreshLocal,
    onFocusFilter: () => searchRef.current?.focus(),
    onEditPath: () => setEditPath((n) => n + 1),
    onNewFolder: () => setCreating(true),
    onTransfer: () => upload(selectedRows),
  });

  function menuFor(row: Row | null): ContextMenuEntry[] {
    if (!row) {
      return [
        { label: "New folder", icon: <FolderPlus size={13} />, shortcut: `${modKey()}+Shift+N`, onClick: () => setCreating(true) },
        { label: "Refresh", icon: <RefreshCw size={13} />, shortcut: "F5", onClick: refreshLocal },
        { separator: true },
        { label: isMac() ? "Open in Finder" : "Open in file manager", icon: <ExternalLink size={13} />, onClick: () => api.openInFileManager(localPath) },
        { label: "Copy path", icon: <Copy size={13} />, onClick: () => navigator.clipboard.writeText(localPath) },
      ];
    }
    const list = targets(row);
    const many = list.length > 1;
    const items: ContextMenuEntry[] = [];
    if (!many) items.push({ label: row.is_dir ? "Open" : "Open with default app", icon: row.is_dir ? <FolderOpen size={13} /> : <AppWindow size={13} />, shortcut: "Enter", onClick: () => open(row) });
    items.push({ label: many ? `Upload ${list.length} items` : "Upload", icon: <Upload size={13} />, shortcut: `${modKey()}+Enter`, disabled: !activeSessionId, onClick: () => upload(list) });
    if (list.some((r) => r.is_dir || STRIPPABLE.test(r.name))) {
      items.push({ label: "Upload without metadata", icon: <Shield size={13} />, disabled: !activeSessionId, onClick: () => upload(list, true) });
    }
    items.push({ separator: true });
    if (!many) items.push({ label: "Rename", icon: <Pencil size={13} />, shortcut: "F2", onClick: () => setRenaming(row.path) });
    if (list.some((r) => !r.is_dir && STRIPPABLE.test(r.name))) {
      items.push({ label: "Remove metadata in place…", icon: <Shield size={13} />, onClick: () => stripInPlace(list) });
    }
    items.push({ label: many ? "Copy paths" : "Copy path", icon: <Copy size={13} />, onClick: () => navigator.clipboard.writeText(list.map((r) => r.path).join("\n")) });
    if (!many) items.push({ label: isMac() ? "Reveal in Finder" : "Show in file manager", icon: <ExternalLink size={13} />, onClick: () => api.revealInFileManager(row.path) });
    items.push({ separator: true });
    items.push({ label: many ? `Delete ${list.length} items` : "Delete", icon: <Trash2 size={13} />, shortcut: "Del", danger: true, onClick: () => remove(list) });
    return items;
  }

  const prefix = (
    <>
      {creating && <NewFolderRow onCommit={createFolder} onCancel={() => setCreating(false)} />}
      {batches
        .filter((b) => b.direction === "download" && sameDir(b.localDir, localPath) && b.sessionId === activeSessionId)
        .map((b) => <GhostBatchRow key={b.batchId} batch={b} />)}
      {ghosts
        .filter((g) => g.direction === "download" && sameDir(g.localDir, localPath) && g.sessionId === activeSessionId)
        .map((g) => <GhostFileRow key={g.transferId} ghost={g} />)}
    </>
  );

  const filtering = localFilter.trim() !== "" || typeFilter !== "all";

  return (
    <div data-pane="local" className="relative flex h-full min-w-0 flex-col bg-void-800" onPointerDownCapture={() => setActivePane("local")}>
      <PaneHeader
        pane="local"
        label="Local"
        icon={<HardDrive size={13} />}
        accentClass="bg-pylon-cyan/12 text-pylon-cyan"
        canBack={localHistoryIndex > 0}
        canForward={localHistoryIndex < localHistory.length - 1}
        onBack={navigateLocalBack}
        onForward={navigateLocalForward}
        onUp={() => navigateLocal(parentLocal(localPath))}
        onRefresh={refreshLocal}
        refreshing={localLoading}
        actions={<IconButton onClick={() => setCreating(true)} title={`New folder (${modKey()}+Shift+N)`}><FolderPlus size={14} /></IconButton>}
      >
        <PathBreadcrumb path={localPath} side="local" onNavigate={navigateLocal} homePath={home} editSignal={editPath} />
      </PaneHeader>

      <PaneSearchBar
        value={localFilter}
        onChange={setLocalFilter}
        matchCount={rows.length}
        totalCount={localAllCount}
        inputRef={searchRef}
        side="local"
        typeFilter={typeFilter}
        onTypeFilter={setTypeFilter}
        regexMode={localRegexMode}
        onRegexToggle={() => setLocalRegexMode(!localRegexMode)}
      />
      <PolicyBanner />

      <div className="relative flex min-h-0 flex-1 flex-col">
        {localLoading && <LoadingBar />}
        <FileList
          pane="local"
          rows={rows}
          selected={selectedLocal}
          cursor={cursorLocal}
          active={activePane === "local"}
          sort={localSort}
          onSort={setLocalSort}
          filterQuery={localRegexMode ? undefined : localFilter}
          renaming={renaming}
          onRenameCommit={rename}
          onRenameCancel={() => setRenaming(null)}
          onSelect={(r, i, shift, ctrl) => selectLocal(r.path, i, shift, ctrl)}
          onOpen={open}
          onContextMenu={(e, row) => setCtx({ x: e.clientX, y: e.clientY, row })}
          prefix={prefix}
          empty={
            localLoading ? null : localError ? (
              <EmptyState icon={<HardDrive size={18} />} title="Can't open this folder" hint={localError}
                action={<button onClick={() => navigateLocal(home ?? "/")} className="rounded-md border border-void-500 px-3 py-1.5 text-xs text-slate-300 hover:bg-void-700">Go to home folder</button>} />
            ) : filtering ? (
              <EmptyState icon={<FolderOpen size={18} />} title="No matches" hint={localFilter ? `Nothing here matches “${localFilter}”.` : "No items of this type."}
                action={<button onClick={() => { setLocalFilter(""); setTypeFilter("all"); }} className="text-xs text-pylon-cyan hover:underline">Clear filter</button>} />
            ) : (
              <EmptyState icon={<FolderOpen size={18} />} title="This folder is empty" />
            )
          }
        />
        <AnimatePresence>
          {selectedLocal.size > 1 && (
            <BulkToolbar
              key="bulk"
              count={selectedLocal.size}
              side="local"
              canTransfer={!!activeSessionId}
              transferTarget={remotePath}
              onUpload={() => upload(selectedRows)}
              onUploadClean={() => upload(selectedRows, true)}
              onDelete={() => remove(selectedRows)}
              onDeselect={clearSelection}
            />
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {ctx && <ContextMenu key="ctx" x={ctx.x} y={ctx.y} items={menuFor(ctx.row)} onClose={() => setCtx(null)} />}
      </AnimatePresence>
    </div>
  );
}
