import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Copy, Download, FolderDown, FolderOpen, FolderPlus, KeyRound, Lock, Pencil, Plug, RefreshCw, Server, SquareTerminal, Trash2,
} from "lucide-react";
import { useFileStore } from "../../stores/fileStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useGhostStore } from "../../stores/ghostStore";
import { useDragStore } from "../../stores/dragStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useConfirm } from "../ui/ConfirmDialog";
import { toast } from "../../stores/toastStore";
import { FileList, Row } from "./FileList";
import { BulkToolbar } from "./BulkToolbar";
import { PathBreadcrumb } from "./PathBreadcrumb";
import { ContextMenu, ContextMenuEntry } from "./ContextMenu";
import { ChmodModal } from "../modals/ChmodModal";
import { GhostFileRow } from "./GhostFileRow";
import { GhostBatchRow } from "./GhostBatchRow";
import { PaneSearchBar, TypeFilter } from "./PaneSearchBar";
import { EmptyState, LoadingBar, matchesType, PaneHeader, usePaneKeyboard } from "./paneShared";
import { Button, IconButton, Spinner } from "../ui/primitives";
import * as api from "../../lib/tauri";
import { errMsg } from "../../lib/format";
import { downloadItems, Item, moveItems, uploadItems } from "../../lib/fileOps";
import { joinRemote, modKey, parentRemote, shellQuote } from "../../lib/path";
import { sendToTerminal } from "../../lib/terminalManager";
import { openTerminalTab } from "../terminal/TerminalPane";

export function PolicyBanner() {
  const { overwritePolicy, setOverwritePolicy } = useFileStore();
  if (overwritePolicy === "ask") return null;
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-b border-pylon-amber/20 bg-pylon-amber/8 px-3 text-xs">
      <span className="flex-1 text-slate-300">
        Existing files will be <strong className="font-medium text-pylon-amber">{overwritePolicy === "overwrite_all" ? "overwritten" : "skipped"}</strong> without asking
      </span>
      <button onClick={() => setOverwritePolicy("ask")} className="text-slate-400 hover:text-slate-100">Ask again</button>
    </div>
  );
}

export function NewFolderRow({ onCommit, onCancel }: { onCommit: (name: string) => void; onCancel: () => void }) {
  const [v, setV] = useState("");
  return (
    <div className="flex h-7 items-center gap-2 bg-pylon-cyan/8 px-3">
      <FolderPlus size={15} className="shrink-0 text-pylon-cyan" />
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => (v.trim() ? onCommit(v) : onCancel())}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") onCommit(v);
          if (e.key === "Escape") onCancel();
        }}
        placeholder="New folder name"
        spellCheck={false}
        className="h-[22px] min-w-0 flex-1 rounded border border-pylon-cyan/60 bg-void-950 px-1.5 text-[13px] text-slate-50 outline-none"
      />
    </div>
  );
}

export function terminalCd(sessionId: string, path: string) {
  const ts = useTerminalStore.getState();
  const tabId = ts.activeTabBySession[sessionId];
  const tab = ts.tabs.find((t) => t.id === tabId);
  if (!tab || ts.deadTerminalIds.has(tab.terminalId)) return false;
  sendToTerminal(tab.terminalId, ` cd ${shellQuote(path)}\r`);
  return true;
}

export function RemotePane() {
  const fs = useFileStore();
  const {
    remotePath, remoteEntries, remoteAllCount, remoteLoading, remoteError, selectedRemote, cursorRemote, activePane,
    remoteSort, remoteFilter, remoteRegexMode, remoteHistory, remoteHistoryIndex,
    navigateRemote, navigateRemoteBack, navigateRemoteForward, selectRemote, clearSelection,
    setRemoteSort, setRemoteFilter, setRemoteRegexMode, refreshRemote, localPath, setActivePane, openSession,
  } = fs;
  const { activeSessionId, connections } = useConnectionStore();
  const session = connections.find((c) => c.id === activeSessionId) ?? null;
  const { ghosts, batches } = useGhostStore();
  const confirm = useConfirm();
  const searchRef = useRef<HTMLInputElement>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; row: Row | null } | null>(null);
  const [chmod, setChmod] = useState<{ path: string; perm: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [editPath, setEditPath] = useState(0);

  useEffect(() => {
    if (session) openSession(session.id, session.home_dir || "/");
  }, [session?.id]);

  const rows: Row[] = useMemo(
    () => (typeFilter === "all" ? remoteEntries : remoteEntries.filter((e) => matchesType(e, typeFilter))),
    [remoteEntries, typeFilter],
  );
  const selectedRows = useMemo(() => remoteEntries.filter((e) => selectedRemote.has(e.path)), [remoteEntries, selectedRemote]);
  const toItems = (list: Row[]): Item[] => list.map((r) => ({ path: r.path, name: r.name, is_dir: r.is_dir }));
  const targets = (row: Row | null) => (row && !selectedRemote.has(row.path) ? [row] : selectedRows.length ? selectedRows : row ? [row] : []);

  useEffect(
    () =>
      useDragStore.getState().registerHandler("remote", (items, source, targetDir) => {
        const sid = useConnectionStore.getState().activeSessionId;
        if (source === "local" && sid) uploadItems(sid, items, targetDir ?? useFileStore.getState().remotePath);
        else if (source === "remote" && targetDir) moveItems("remote", sid, items, targetDir);
      }),
    [],
  );

  const navigate = useCallback(
    (path: string) => {
      if (!activeSessionId) return;
      navigateRemote(activeSessionId, path);
      if (useSettingsStore.getState().terminalFollowsBrowser) terminalCd(activeSessionId, path);
    },
    [activeSessionId, navigateRemote],
  );

  async function download(list: Row[], dest?: string) {
    if (!activeSessionId) return;
    await downloadItems(activeSessionId, toItems(list), dest ?? useFileStore.getState().localPath);
  }

  async function downloadTo(list: Row[]) {
    const dir = await openDialog({ directory: true, multiple: false, title: "Download to…", defaultPath: localPath }).catch(() => null);
    if (typeof dir === "string") download(list, dir.replace(/\\/g, "/"));
  }

  const open = useCallback(
    (row: Row) => {
      if (row.is_dir) navigate(row.path);
      else download([row]);
    },
    [navigate],
  );

  async function remove(list: Row[]) {
    if (!activeSessionId || !list.length) return;
    if (useSettingsStore.getState().confirmDeletes) {
      const dirs = list.filter((r) => r.is_dir && !r.is_symlink).length;
      const ok = await confirm({
        title: list.length === 1 ? `Delete “${list[0].name}” on the server?` : `Delete ${list.length} items on the server?`,
        message: dirs ? "Folders are deleted with everything inside them. This cannot be undone." : "This cannot be undone.",
        danger: true,
        confirmLabel: "Delete",
      });
      if (!ok) return;
    }
    const paths = list.map((r) => r.path);
    setDeleting((d) => [...d, ...paths]);
    try {
      await api.deleteBatch(activeSessionId, list.map((r) => [r.path, r.is_dir] as [string, boolean]));
      toast.success("Deleted", list.length === 1 ? list[0].name : `${list.length} items`);
    } catch (e) {
      toast.error("Delete failed", errMsg(e));
    } finally {
      setDeleting((d) => d.filter((p) => !paths.includes(p)));
      clearSelection();
      refreshRemote(activeSessionId);
    }
  }

  async function rename(row: Row, name: string) {
    setRenaming(null);
    if (!activeSessionId) return;
    if (name.includes("/")) { toast.error("Invalid name", "Names can't contain “/”"); return; }
    try {
      await api.renameRemote(activeSessionId, row.path, joinRemote(parentRemote(row.path), name));
      await refreshRemote(activeSessionId);
    } catch (e) {
      toast.error("Rename failed", errMsg(e));
    }
  }

  async function createFolder(name: string) {
    setCreating(false);
    if (!activeSessionId || !name.trim()) return;
    try {
      await api.createRemoteDir(activeSessionId, joinRemote(remotePath, name.trim()));
      await refreshRemote(activeSessionId);
    } catch (e) {
      toast.error("Could not create folder", errMsg(e));
    }
  }

  async function terminalHere(path: string) {
    if (!activeSessionId) return;
    if (!terminalCd(activeSessionId, path)) {
      await openTerminalTab(activeSessionId);
      setTimeout(() => terminalCd(activeSessionId, path), 600);
    }
    const ui = useUiStore.getState();
    if (ui.activeTab === "files" && ui.bottomMode === "hidden") ui.setBottomMode("terminal");
  }

  usePaneKeyboard("remote", {
    rows,
    onOpen: open,
    onUp: () => navigate(parentRemote(remotePath)),
    onDelete: () => remove(selectedRows),
    onRename: (r) => setRenaming(r.path),
    onRefresh: () => activeSessionId && refreshRemote(activeSessionId),
    onFocusFilter: () => searchRef.current?.focus(),
    onEditPath: () => setEditPath((n) => n + 1),
    onNewFolder: () => setCreating(true),
    onTransfer: () => download(selectedRows),
  });

  function menuFor(row: Row | null): ContextMenuEntry[] {
    if (!row) {
      return [
        { label: "New folder", icon: <FolderPlus size={13} />, shortcut: `${modKey()}+Shift+N`, onClick: () => setCreating(true) },
        { label: "Refresh", icon: <RefreshCw size={13} />, shortcut: "F5", onClick: () => activeSessionId && refreshRemote(activeSessionId) },
        { separator: true },
        { label: "Open terminal here", icon: <SquareTerminal size={13} />, onClick: () => terminalHere(remotePath) },
        { label: "Copy path", icon: <Copy size={13} />, onClick: () => navigator.clipboard.writeText(remotePath) },
      ];
    }
    const list = targets(row);
    const many = list.length > 1;
    const items: ContextMenuEntry[] = [];
    if (!many && row.is_dir) items.push({ label: "Open", icon: <FolderOpen size={13} />, shortcut: "Enter", onClick: () => navigate(row.path) });
    items.push({ label: many ? `Download ${list.length} items` : "Download", icon: <Download size={13} />, shortcut: many || row.is_dir ? `${modKey()}+Enter` : "Enter", onClick: () => download(list) });
    items.push({ label: "Download to…", icon: <FolderDown size={13} />, onClick: () => downloadTo(list) });
    items.push({ separator: true });
    if (!many) {
      items.push({ label: "Rename", icon: <Pencil size={13} />, shortcut: "F2", onClick: () => setRenaming(row.path) });
      items.push({ label: "Permissions…", icon: <Lock size={13} />, onClick: () => setChmod({ path: row.path, perm: row.permissions ?? 0o644 }) });
      if (row.is_dir) items.push({ label: "Open terminal here", icon: <SquareTerminal size={13} />, onClick: () => terminalHere(row.path) });
    }
    items.push({ label: many ? "Copy paths" : "Copy path", icon: <Copy size={13} />, onClick: () => navigator.clipboard.writeText(list.map((r) => r.path).join("\n")) });
    items.push({ separator: true });
    items.push({ label: many ? `Delete ${list.length} items` : "Delete", icon: <Trash2 size={13} />, shortcut: "Del", danger: true, onClick: () => remove(list) });
    return items;
  }

  if (!session) {
    return (
      <div data-pane="remote" className="flex h-full min-w-0 flex-col items-center justify-center bg-void-800">
        <EmptyState
          icon={<Server size={18} />}
          title="No server connected"
          hint="Connect to browse remote files. You can then drag files between the two panes."
          action={
            <div className="flex gap-2">
              <Button variant="primary" size="sm" icon={<Plug size={13} />} onClick={() => useUiStore.getState().setConnectModal(true)}>Connect…</Button>
              <Button size="sm" icon={<KeyRound size={13} />} onClick={() => useUiStore.getState().setVaultModal(true)}>ZVault</Button>
            </div>
          }
        />
      </div>
    );
  }

  const prefix = (
    <>
      {creating && <NewFolderRow onCommit={createFolder} onCancel={() => setCreating(false)} />}
      {deleting.map((p) => (
        <div key={`del-${p}`} className="flex h-7 items-center gap-2 bg-pylon-red/8 px-3 text-[13px] text-slate-400">
          <Spinner className="text-pylon-red" />
          <span className="min-w-0 flex-1 truncate line-through">{p.split("/").pop()}</span>
          <span className="text-xs text-pylon-red/80">Deleting…</span>
        </div>
      ))}
      {batches
        .filter((b) => b.direction === "upload" && b.remoteDir === remotePath && b.sessionId === activeSessionId)
        .map((b) => <GhostBatchRow key={b.batchId} batch={b} />)}
      {ghosts
        .filter((g) => g.direction === "upload" && g.remoteDir === remotePath && g.sessionId === activeSessionId)
        .map((g) => <GhostFileRow key={g.transferId} ghost={g} />)}
    </>
  );
  const filtering = remoteFilter.trim() !== "" || typeFilter !== "all";

  return (
    <div data-pane="remote" className="relative flex h-full min-w-0 flex-col bg-void-800" onPointerDownCapture={() => setActivePane("remote")}>
      <PaneHeader
        pane="remote"
        label={session.label}
        icon={<Server size={13} />}
        accentClass="bg-pylon-violet/12 text-pylon-violet"
        canBack={remoteHistoryIndex > 0}
        canForward={remoteHistoryIndex < remoteHistory.length - 1}
        onBack={() => navigateRemoteBack(session.id)}
        onForward={() => navigateRemoteForward(session.id)}
        onUp={() => navigate(parentRemote(remotePath))}
        onRefresh={() => refreshRemote(session.id)}
        refreshing={remoteLoading}
        actions={<IconButton onClick={() => setCreating(true)} title={`New folder (${modKey()}+Shift+N)`}><FolderPlus size={14} /></IconButton>}
      >
        <PathBreadcrumb path={remotePath} side="remote" onNavigate={navigate} homePath={session.home_dir} editSignal={editPath} />
      </PaneHeader>

      <PaneSearchBar
        value={remoteFilter}
        onChange={setRemoteFilter}
        matchCount={rows.length}
        totalCount={remoteAllCount}
        inputRef={searchRef}
        side="remote"
        typeFilter={typeFilter}
        onTypeFilter={setTypeFilter}
        regexMode={remoteRegexMode}
        onRegexToggle={() => setRemoteRegexMode(!remoteRegexMode)}
      />
      <PolicyBanner />

      <div className="relative flex min-h-0 flex-1 flex-col">
        {remoteLoading && <LoadingBar />}
        <FileList
          pane="remote"
          rows={rows}
          selected={selectedRemote}
          cursor={cursorRemote}
          active={activePane === "remote"}
          sort={remoteSort}
          onSort={setRemoteSort}
          showPermissions
          filterQuery={remoteRegexMode ? undefined : remoteFilter}
          renaming={renaming}
          onRenameCommit={rename}
          onRenameCancel={() => setRenaming(null)}
          onSelect={(r, i, shift, ctrl) => selectRemote(r.path, i, shift, ctrl)}
          onOpen={open}
          onContextMenu={(e, row) => setCtx({ x: e.clientX, y: e.clientY, row })}
          prefix={prefix}
          empty={
            remoteLoading ? null : remoteError ? (
              <EmptyState icon={<Server size={18} />} title="Can't open this folder" hint={remoteError}
                action={
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => refreshRemote(session.id)}>Retry</Button>
                    <Button size="sm" variant="ghost" onClick={() => navigate(session.home_dir || "/")}>Go home</Button>
                  </div>
                } />
            ) : filtering ? (
              <EmptyState icon={<FolderOpen size={18} />} title="No matches" hint={remoteFilter ? `Nothing here matches “${remoteFilter}”.` : "No items of this type."}
                action={<button onClick={() => { setRemoteFilter(""); setTypeFilter("all"); }} className="text-xs text-pylon-cyan hover:underline">Clear filter</button>} />
            ) : (
              <EmptyState icon={<FolderOpen size={18} />} title="This folder is empty" hint="Drop files here to upload them." />
            )
          }
        />
        <AnimatePresence>
          {selectedRemote.size > 1 && (
            <BulkToolbar
              key="bulk"
              count={selectedRemote.size}
              side="remote"
              canTransfer
              transferTarget={localPath}
              onDownload={() => download(selectedRows)}
              onDelete={() => remove(selectedRows)}
              onDeselect={clearSelection}
            />
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {ctx && <ContextMenu key="ctx" x={ctx.x} y={ctx.y} items={menuFor(ctx.row)} onClose={() => setCtx(null)} />}
        {chmod && (
          <ChmodModal
            key="chmod"
            path={chmod.path}
            currentPerm={chmod.perm}
            onApply={async (mode) => {
              try {
                await api.chmodRemote(session.id, chmod.path, mode);
                toast.success("Permissions updated", chmod.path.split("/").pop());
                refreshRemote(session.id);
              } catch (e) {
                toast.error("chmod failed", errMsg(e));
              }
            }}
            onClose={() => setChmod(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
