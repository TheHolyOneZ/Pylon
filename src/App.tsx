import { useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { MainWorkspace } from "./components/layout/MainWorkspace";
import { StatusBar } from "./components/layout/StatusBar";
import { ConnectModal } from "./components/modals/ConnectModal";
import { VaultModal } from "./components/modals/VaultModal";
import { OverwriteModal } from "./components/modals/OverwriteModal";
import { ToastContainer } from "./components/ui/Toast";
import { ConfirmProvider, useConfirm } from "./components/ui/ConfirmDialog";
import { LockPasswordProvider } from "./components/ui/LockPasswordPrompt";
import { TransferDrawer } from "./components/transfers/TransferDrawer";
import { CommandPalette } from "./components/ui/CommandPalette";
import { DragLayer } from "./components/files/DragLayer";
import { AppLock } from "./components/AppLock";
import { openTerminalTab } from "./components/terminal/TerminalPane";
import { useTransferStore, isActive } from "./stores/transferStore";
import { useSyncStore } from "./stores/syncStore";
import { useFileStore } from "./stores/fileStore";
import { useUiStore } from "./stores/uiStore";
import { useDragStore } from "./stores/dragStore";
import { handleBatchDone, handleBatchNew, handleTransferNew, handleTransferProgress } from "./stores/ghostStore";
import { useConnectionStore } from "./stores/connectionStore";
import { useActivityStore } from "./stores/activityStore";
import { useSettingsStore } from "./stores/settingsStore";
import { toast } from "./stores/toastStore";
import { errMsg } from "./lib/format";
import { isMac, parentLocal } from "./lib/path";
import { uploadDroppedPaths } from "./lib/fileOps";
import { ensureTerminalListeners } from "./lib/terminalManager";

function inTerminal(t: EventTarget | null) {
  return !!(t as HTMLElement | null)?.closest?.(".xterm");
}
function inField(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function useGlobalShortcuts() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mac = isMac();
      const mod = mac ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      const term = inTerminal(e.target);
      if (term && !mac && !e.shiftKey) return;
      const ui = useUiStore.getState();
      const conn = useConnectionStore.getState();
      const field = inField(e.target);

      const act = (fn: () => void) => { e.preventDefault(); e.stopPropagation(); fn(); };
      if (k === "k" || (e.shiftKey && k === "p")) return act(() => ui.setCommandPalette(!ui.commandPaletteOpen));
      if (k === "n" && !e.shiftKey) return act(() => ui.setConnectModal(true));
      if (k === "j" || (k === "t" && !e.shiftKey && !term)) return act(() => ui.toggleTransferDrawer());
      if (k === "t" && e.shiftKey) return act(() => {
        if (!conn.activeSessionId) return toast.info("Not connected", "Connect to a server to open a terminal");
        if (ui.activeTab !== "terminal" && !(ui.activeTab === "files" && ui.bottomMode !== "hidden" && ui.bottomMode !== "log")) ui.setActiveTab("terminal");
        openTerminalTab(conn.activeSessionId);
      });
      if (k === "d" && e.shiftKey && conn.activeSessionId) return act(() => conn.disconnectFromServer(conn.activeSessionId!));
      if (k === ",") return act(() => ui.setActiveTab("settings"));
      if (k === "b" && !field) return act(() => ui.toggleSidebar());
      if (k === "`") return act(() => ui.setBottomMode(ui.bottomMode === "hidden" ? "terminal" : "hidden"));
      const tabs = ["files", "terminal", "sync", "transfers"] as const;
      if (/^[1-4]$/.test(k) && !field) return act(() => ui.setActiveTab(tabs[Number(k) - 1]));
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

function useAutoLock() {
  useEffect(() => {
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const events = ["mousemove", "keydown", "mousedown", "wheel"];
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    const timer = setInterval(async () => {
      const minutes = useSettingsStore.getState().vaultAutoLockMinutes;
      const { vaultUnlocked, lockVault } = useConnectionStore.getState();
      if (!minutes || !vaultUnlocked) return;
      if (Date.now() - last > minutes * 60_000) {
        await lockVault().catch(() => {});
        toast.info("ZVault locked", `No activity for ${minutes} min`);
      }
    }, 15_000);
    return () => {
      clearInterval(timer);
      events.forEach((ev) => window.removeEventListener(ev, bump));
    };
  }, []);
}

function useBackendEvents() {
  const addActivity = useActivityStore((s) => s.add);
  useEffect(() => {
    ensureTerminalListeners();
    useTransferStore.getState().startListening();
    useConnectionStore.getState().refreshVaultState();
    useConnectionStore.getState().fetchConnections().catch(() => {});

    const subs = [
      listen<{ session_id: string }>("ssh://session-died", async (e) => {
        const sessionId = e.payload.session_id;
        const store = useConnectionStore.getState();
        const conn = store.connections.find((c) => c.id === sessionId);
        if (!conn) return;
        const credentialId = store.credentialIdBySession[sessionId];
        addActivity({ type: "error", message: `Connection lost: ${conn.label}` });
        const fs = useFileStore.getState();
        const lastPath = fs.remotePathBySession[sessionId] ?? (store.activeSessionId === sessionId ? fs.remotePath : undefined);
        await store.disconnectFromServer(sessionId);
        if (useSettingsStore.getState().autoReconnect && credentialId && useConnectionStore.getState().vaultUnlocked) {
          try {
            const r = await useConnectionStore.getState().connectVault(credentialId);
            if (r.kind === "connected") {
              useConnectionStore.getState().aliasSession(sessionId, r.info.id);
              if (lastPath) {
                useFileStore.setState((s) => ({ remotePathBySession: { ...s.remotePathBySession, [r.info.id]: lastPath } }));
                if (useConnectionStore.getState().activeSessionId === r.info.id) {
                  useFileStore.getState().navigateRemote(r.info.id, lastPath).catch(() => {});
                }
              }
              toast.success("Reconnected", `${conn.label} — failed transfers can be retried and will resume`);
            }
            else toast.warning("Reconnect needs attention", `${conn.label}: the host key must be confirmed in ZVault`);
          } catch (err) {
            toast.error(`Couldn't reconnect to ${conn.label}`, errMsg(err));
          }
        } else {
          toast.error("Connection lost", `${conn.label} stopped responding`);
        }
      }),
      listen<any>("ssh://host-key-changed", (e) => {
        addActivity({ type: "warning", message: `Host key changed for ${e.payload.host}`, detail: `${e.payload.old_fingerprint} → ${e.payload.fingerprint}` });
      }),
      listen<any>("transfer://batch-new", (e) => {
        handleBatchNew(e.payload);
        addActivity({
          type: "transfer",
          message: `${e.payload.direction === "upload" ? "Uploading" : "Downloading"} folder ${e.payload.name} (${e.payload.total_files} files)`,
          detail: e.payload.direction === "upload" ? e.payload.remote_dir : e.payload.local_dir,
        });
      }),
      listen<any>("transfer://batch-done", (e) => {
        handleBatchDone(e.payload);
        if (e.payload.failed) addActivity({ type: "error", message: `Folder transfer: ${e.payload.failed} of ${e.payload.total_files} files failed`, detail: (e.payload.errors ?? []).join("\n") });
      }),
      listen<any>("transfer://new", (e) => handleTransferNew(e.payload)),
      listen<any>("transfer://progress", (e) => {
        const p = e.payload;
        handleTransferProgress(p);
        if (p.state && typeof p.state === "object" && "failed" in p.state) {
          addActivity({ type: "error", message: "Transfer failed", detail: p.state.failed });
        }
      }),
    ];
    const unlistenSync = useSyncStore.getState().startListening();
    return () => {
      subs.forEach((p) => p.then((fn) => fn()));
      unlistenSync();
    };
  }, [addActivity]);
}

function useOsDrop() {
  useEffect(() => {
    const hit = (pos?: { x: number; y: number }) => {
      if (!pos) return { pane: null as "local" | "remote" | null, dir: null as string | null };
      const dpr = window.devicePixelRatio || 1;
      const el = document.elementFromPoint(pos.x / dpr, pos.y / dpr) as HTMLElement | null;
      const pane = (el?.closest<HTMLElement>("[data-pane]")?.dataset.pane as "local" | "remote" | undefined) ?? null;
      const dir = el?.closest<HTMLElement>("[data-drop-dir]")?.dataset.dropDir ?? null;
      return { pane, dir };
    };
    const un = getCurrentWebview().onDragDropEvent(async (event) => {
      const p = event.payload as any;
      if (p.type === "enter" || p.type === "over") {
        const { pane, dir } = hit(p.position);
        useDragStore.setState({ active: true, items: [], source: null, overPane: pane, overDir: pane === "remote" ? dir : null });
        return;
      }
      useDragStore.setState({ active: false, overPane: null, overDir: null });
      if (p.type !== "drop" || !p.paths?.length) return;
      const { pane, dir } = hit(p.position);
      const sid = useConnectionStore.getState().activeSessionId;
      if (pane === "remote") {
        if (!sid) return toast.info("Not connected", "Connect to a server to upload");
        await uploadDroppedPaths(sid, p.paths, dir ?? useFileStore.getState().remotePath);
      } else {
        const first = String(p.paths[0]).replace(/\\/g, "/");
        await useFileStore.getState().navigateLocal(parentLocal(first));
        useFileStore.getState().setSelection("local", p.paths.map((x: string) => x.replace(/\\/g, "/")));
      }
    });
    return () => { un.then((fn) => fn()); };
  }, []);
}

function useCloseGuard() {
  const confirm = useConfirm();
  useEffect(() => {
    const win = getCurrentWindow();
    const un = win.onCloseRequested(async (event) => {
      const running = useTransferStore.getState().transfers.filter((t) => isActive(t.state)).length;
      if (!running) return;
      event.preventDefault();
      const ok = await confirm({
        title: "Quit while transfers are running?",
        message: `${running} transfer${running > 1 ? "s are" : " is"} still in progress. Interrupted transfers can be resumed later by retrying them.`,
        confirmLabel: "Quit",
        danger: true,
      });
      if (ok) await win.destroy();
    });
    return () => { un.then((fn) => fn()); };
  }, [confirm]);
}

function Shell() {
  const { connectModalOpen, vaultModalOpen, transferDrawerOpen, setTransferDrawer, commandPaletteOpen, setCommandPalette, overwritePrompt } = useUiStore();
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);
  useGlobalShortcuts();
  useAutoLock();
  useBackendEvents();
  useOsDrop();
  useCloseGuard();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-void-950 text-slate-200">
      <TitleBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <MainWorkspace />
      </div>
      <StatusBar />

      <AnimatePresence>
        {connectModalOpen && <ConnectModal key="connect" />}
        {vaultModalOpen && <VaultModal key="vault" />}
        {overwritePrompt && <OverwriteModal key="overwrite" conflicts={overwritePrompt.conflicts} onChoice={overwritePrompt.resolve} />}
      </AnimatePresence>
      <TransferDrawer open={transferDrawerOpen} onClose={() => setTransferDrawer(false)} />
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPalette(false)} />
      <DragLayer />
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <AppLock>
      <LockPasswordProvider>
        <ConfirmProvider>
          <Shell />
        </ConfirmProvider>
      </LockPasswordProvider>
    </AppLock>
  );
}
