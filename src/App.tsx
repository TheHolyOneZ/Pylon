import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { PylonBeam } from "./components/layout/PylonBeam";
import { MainWorkspace } from "./components/layout/MainWorkspace";
import { ConnectModal } from "./components/modals/ConnectModal";
import { VaultModal } from "./components/modals/VaultModal";
import { StatusBar } from "./components/layout/StatusBar";
import { ToastContainer } from "./components/ui/Toast";
import { ConfirmProvider } from "./components/ui/ConfirmDialog";
import { LockPasswordProvider } from "./components/ui/LockPasswordPrompt";
import { useTransferStore } from "./stores/transferStore";
import { useSyncStore } from "./stores/syncStore";
import { useFileStore } from "./stores/fileStore";
import { useUiStore } from "./stores/uiStore";
import { handleBatchNew, handleTransferNew, handleTransferProgress } from "./stores/ghostStore";
import { useConnectionStore } from "./stores/connectionStore";
import { useActivityStore } from "./stores/activityStore";
import { useSettingsStore } from "./stores/settingsStore";
import * as api from "./lib/tauri";
import { normalizePath } from "./lib/tauri";
import { AppLock } from "./components/AppLock";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { toast } from "./stores/toastStore";
import { errMsg } from "./lib/format";
import { TransferDrawer } from "./components/transfers/TransferDrawer";
import { CommandPalette } from "./components/ui/CommandPalette";

export default function App() {
  const { startListening } = useTransferStore();
  const startSyncListening = useSyncStore((s) => s.startListening);
  const { connectModalOpen, vaultModalOpen, transferDrawerOpen, toggleTransferDrawer, activeTab } = useUiStore();
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const { theme } = useSettingsStore();
  const addActivity = useActivityStore((s) => s.add);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function scheduleAutoLock() {
      const minutes = useSettingsStore.getState().vaultAutoLockMinutes;
      if (!minutes || minutes <= 0) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          await api.vaultLock();
          toast.info("ZVault locked", "Auto-locked after inactivity");
        } catch (e) {
          toast.warning("ZVault auto-lock failed", "Lock manually to be safe");
        }
      }, minutes * 60 * 1000);
    }

    const events = ["mousemove", "keydown", "mousedown", "touchstart"];
    events.forEach((ev) => window.addEventListener(ev, scheduleAutoLock, { passive: true }));
    scheduleAutoLock();

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, scheduleAutoLock));
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let closing = false;
    let unlisten: (() => void) | undefined;
    getCurrentWindow().onCloseRequested(async (event) => {
      if (closing) return;
      event.preventDefault();
      closing = true;
      const { connections, disconnectFromServer } = useConnectionStore.getState();
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await Promise.race([
        Promise.allSettled(connections.map((c) => disconnectFromServer(c.id))),
        timeout,
      ]);
      await getCurrentWindow().destroy();
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  useEffect(() => {
    const unlistenSync = startSyncListening();
    return () => { unlistenSync(); };
  }, [startSyncListening]);

  useEffect(() => {
    startListening();

    function handleKeys(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === "t") { e.preventDefault(); toggleTransferDrawer(); }
      if (e.ctrlKey && e.key === "n") { e.preventDefault(); useUiStore.getState().setConnectModal(true); }
      if (e.ctrlKey && e.key === "k") { e.preventDefault(); setCmdPaletteOpen((v) => !v); }
      if (e.ctrlKey && e.key === "d" && useConnectionStore.getState().activeSessionId) {
        e.preventDefault();
        const id = useConnectionStore.getState().activeSessionId!;
        useConnectionStore.getState().disconnectFromServer(id);
      }
    }
    window.addEventListener("keydown", handleKeys);

    const unlistenDied = listen("ssh://session-died", async (e: any) => {
      const sessionId: string = e.payload.session_id;
      const { connections, disconnectFromServer, credentialIdBySession } = useConnectionStore.getState();
      const conn = connections.find((c) => c.id === sessionId);
      const label = conn?.label ?? sessionId;

      addActivity({ type: "error", message: `Connection lost: ${label}` });

      const { autoReconnect } = useSettingsStore.getState();
      const credentialId = credentialIdBySession[sessionId];

      disconnectFromServer(sessionId).catch(() => {});

      if (autoReconnect && credentialId) {
        addActivity({ type: "info", message: `Auto-reconnecting: ${label}…` });
        try {
          const result = await api.vaultConnect(credentialId);
          if (result.status === "connected" && result.info) {
            useConnectionStore.getState().addConnection(result.info);
            useConnectionStore.getState().setCredentialId(result.info.id, credentialId);
            toast.success("Reconnected", label);
            addActivity({ type: "success", message: `Reconnected: ${label}` });
          }
        } catch (err: any) {
          toast.error("Auto-reconnect failed", String(err?.message ?? err));
          addActivity({ type: "error", message: `Auto-reconnect failed: ${label}`, detail: String(err?.message ?? err) });
        }
      } else {
        toast.error("Connection lost", `${label} — reconnect manually`);
      }
    });

    const unlisten = listen("ssh://host-key-verify", (e: any) => {
      toast.warning("Unknown host key", `${e.payload.host}: ${e.payload.fingerprint}`);
      addActivity({ type: "warning", message: `Unknown host key: ${e.payload.host}`, detail: e.payload.fingerprint });
    });

    const unlistenChanged = listen("ssh://host-key-changed", (e: any) => {
      toast.error("⚠ Host key changed!", `${e.payload.host} — possible MITM. Verify before reconnecting.`);
      addActivity({ type: "error", message: `Host key CHANGED: ${e.payload.host} — possible MITM attack` });
    });

    const unlistenBatch = listen("transfer://batch-new", (e: any) => {
      handleBatchNew(e.payload);
      addActivity({
        type: "transfer",
        message: `${e.payload.direction === "upload" ? "↑ Upload" : "↓ Download"} folder: ${e.payload.name} (${e.payload.total_files} files)`,
        detail: e.payload.remote_dir,
      });
    });

    const unlistenTransfer = listen("transfer://new", (e: any) => {
      const r = e.payload;
      handleTransferNew(r);
      if (!r.batch_id) {
        addActivity({
          type: "transfer",
          message: `${r.direction === "upload" ? "↑ Upload" : "↓ Download"}: ${r.local_path?.split(/[\\/]/).pop() ?? r.remote_path?.split(/[\\/]/).pop()}`,
          detail: r.remote_path,
        });
      }
    });

    const unlistenDone = listen("transfer://progress", (e: any) => {
      const p = e.payload;
      handleTransferProgress(p);
      if (p.state === "completed") {
        addActivity({ type: "success", message: `Transfer complete: ${p.id.slice(0, 8)}…` });
      } else if (p.state && typeof p.state === "object" && "failed" in p.state) {
        addActivity({ type: "error", message: `Transfer failed: ${p.state.failed}` });
      }
    });

    const unlistenDrop = getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type !== "drop") return;
      const paths: string[] = (event.payload as any).paths ?? [];
      if (!paths.length) return;

      const { activeSessionId } = useConnectionStore.getState();
      const fileStore = useFileStore.getState();
      const strip = useSettingsStore.getState().autoStripMetadata;

      const pos = (event.payload as any).position as { x: number; y: number } | undefined;
      const midX = window.innerWidth / 2;
      const isRemoteSide = pos ? pos.x > midX : !!activeSessionId;

      if (isRemoteSide && activeSessionId) {
        const { remotePath } = fileStore;
        for (const p of paths) {

          const normalizedP = normalizePath(p);
          const name = normalizedP.split("/").pop() ?? p;
          try {

            const looksLikeDir = !name.includes(".") || p.endsWith("/") || p.endsWith("\\");

            if (looksLikeDir) {
              await api.uploadDirectory(activeSessionId, p, `${remotePath}/${name}`, strip);
            } else if (strip) {
              await api.uploadFileClean(activeSessionId, p, `${remotePath}/${name}`);
            } else {
              await api.uploadFile(activeSessionId, p, `${remotePath}/${name}`);
            }
          } catch (e: any) {
            toast.error(`OS drop upload failed: ${name}`, errMsg(e));
          }
        }
      } else {

        const normalizedFirst = normalizePath(paths[0]);
        const firstParent = normalizedFirst.replace(/\/[^/]+$/, "");
        if (firstParent) {
          fileStore.navigateLocal(firstParent);
        } else {

          api.getHomeDir().then((home) => fileStore.navigateLocal(home)).catch(() => {});
        }
      }
    });

    return () => {
      window.removeEventListener("keydown", handleKeys);
      unlistenDied.then((fn) => fn());
      unlisten.then((fn) => fn());
      unlistenChanged.then((fn) => fn());
      unlistenBatch.then((fn) => fn());
      unlistenTransfer.then((fn) => fn());
      unlistenDone.then((fn) => fn());
      unlistenDrop.then((fn) => fn());
    };
  }, [startListening, toggleTransferDrawer]);

  return (
    <AppLock>
    <LockPasswordProvider>
    <ConfirmProvider>
      <div className="flex flex-col h-full bg-void-950 text-slate-200 overflow-hidden">
        {}
        <TitleBar />

        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          {activeTab !== "settings" && <PylonBeam />}
          <MainWorkspace />
        </div>

        <StatusBar />

        {}
        <AnimatePresence>
          {connectModalOpen && <ConnectModal key="connect" />}
          {vaultModalOpen && <VaultModal key="vault" />}
        </AnimatePresence>

        {}
        <TransferDrawer open={transferDrawerOpen} onClose={() => toggleTransferDrawer()} />

        {}
        <CommandPalette open={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} />

        {}
        <ToastContainer />
      </div>
    </ConfirmProvider>
    </LockPasswordProvider>
    </AppLock>
  );
}
