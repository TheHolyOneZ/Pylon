import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Edit2,
  FolderSync,
  KeyRound,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  ArrowLeftRight,
  Server,
  Settings,
  Terminal as TerminalIcon,
  Trash2,
  Unplug,
} from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { useServerStore, SavedServer } from "../../stores/serverStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { hasLockPassword } from "../AppLock";
import { PylonTab } from "../../types";
import { ContextMenu, ContextMenuEntry } from "../files/ContextMenu";

const NAV_ITEMS: { tab: PylonTab; icon: React.ReactNode; label: string }[] = [
  { tab: "files",     icon: <FolderSync size={18} />,    label: "Files" },
  { tab: "terminal",  icon: <TerminalIcon size={18} />,  label: "Terminal" },
  { tab: "sync",      icon: <RefreshCw size={18} />,     label: "Sync" },
  { tab: "transfers", icon: <ArrowLeftRight size={18} />,label: "Transfers" },
  { tab: "settings",  icon: <Settings size={18} />,      label: "Settings" },
];

export function Sidebar() {
  const { connections, activeSessionId, setActiveSession, disconnectFromServer } = useConnectionStore();
  const { servers, remove } = useServerStore();
  const { sidebarWidth } = useSettingsStore();
  const {
    sidebarOpen, toggleSidebar,
    activeTab, setActiveTab,
    setConnectModal, setVaultModal,
  } = useUiStore();

  const hasLock = hasLockPassword();
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; server: SavedServer } | null>(null);


  const sortedServers = [...servers].sort((a, b) => {
    if (a.lastConnected && b.lastConnected) return b.lastConnected.localeCompare(a.lastConnected);
    if (a.lastConnected) return -1;
    if (b.lastConnected) return 1;
    return a.label.localeCompare(b.label);
  });

  function handleServerClick(server: typeof servers[0]) {
    const live = connections.find(
      (c) => c.host === server.host && c.port === server.port && c.username === server.username
    );
    if (live) { setActiveSession(live.id); return; }
    setConnectModal(true, server);
  }

  return (
    <motion.aside
      animate={{ width: sidebarOpen ? sidebarWidth : 56 }}
      transition={{ type: "spring", stiffness: 400, damping: 35 }}
      className="flex flex-col bg-void-900 border-r border-void-600 overflow-hidden shrink-0"
    >
      {}
      <div className="flex justify-end p-2 border-b border-void-600">
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded hover:bg-void-700 text-slate-400 hover:text-pylon-cyan transition-colors"
        >
          {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </div>

      {}
      <nav className="flex flex-col gap-1 p-2 border-b border-void-600">
        {NAV_ITEMS.map(({ tab, icon, label }) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-3 px-2 py-2 rounded text-sm transition-all ${
              activeTab === tab
                ? "bg-pylon-cyan/10 text-pylon-cyan border border-pylon-cyan/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-void-700"
            }`}
          >
            <span className="shrink-0">{icon}</span>
            {sidebarOpen && <span className="truncate">{label}</span>}
          </button>
        ))}
      </nav>

      {}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sidebarOpen && (
          <div className="text-[10px] text-slate-600 uppercase tracking-widest mb-1.5 px-2 flex items-center gap-1.5">
            <Server size={9} />
            Servers
          </div>
        )}

        {}
        {sortedServers.map((server) => {
          const liveSession = connections.find(
            (c) => c.host === server.host && c.port === server.port && c.username === server.username
          );
          const isActive = liveSession && activeSessionId === liveSession.id;

          return (
            <div key={server.id} className="group relative">
              <button
                onClick={() => handleServerClick(server)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ x: e.clientX, y: e.clientY, server });
                }}
                className={`flex items-center gap-2 w-full px-2 py-2 rounded text-sm transition-all ${
                  isActive
                    ? "bg-pylon-violet/10 text-pylon-violet border border-pylon-violet/20"
                    : liveSession
                    ? "bg-pylon-green/5 text-slate-300 border border-pylon-green/15 hover:bg-pylon-green/10"
                    : "text-slate-400 hover:text-slate-200 hover:bg-void-700"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    liveSession
                      ? "bg-pylon-green animate-pulse"
                      : "bg-slate-600"
                  }`}
                />
                {sidebarOpen && (
                  <div className="flex-1 min-w-0 text-left">
                    <p className="truncate text-xs font-medium leading-none">{server.label}</p>
                    <p className="truncate text-[10px] text-slate-600 mt-0.5">
                      {server.username}@{server.host}
                      {server.savedPassword && <span className="ml-1 text-pylon-cyan/40">••••</span>}
                    </p>
                  </div>
                )}
              </button>
            </div>
          );
        })}

        {}
        {connections
          .filter((conn) => !servers.some((s) => s.host === conn.host && s.port === conn.port && s.username === conn.username))
          .map((conn) => (
            <button
              key={conn.id}
              onClick={() => setActiveSession(conn.id)}
              title={`${conn.username}@${conn.host} (unsaved)`}
              className={`flex items-center gap-2 w-full px-2 py-2 rounded text-sm transition-all ${
                activeSessionId === conn.id
                  ? "bg-pylon-violet/10 text-pylon-violet border border-pylon-violet/20"
                  : "text-slate-400 hover:text-slate-200 hover:bg-void-700"
              }`}
            >
              <span className="w-2 h-2 rounded-full shrink-0 bg-pylon-cyan animate-pulse" />
              {sidebarOpen && (
                <div className="flex-1 min-w-0 text-left">
                  <p className="truncate text-xs font-medium leading-none">{conn.label}</p>
                  <p className="truncate text-[10px] text-slate-600 mt-0.5">{conn.username}@{conn.host} · unsaved</p>
                </div>
              )}
            </button>
          ))}

        {sortedServers.length === 0 && connections.length === 0 && sidebarOpen && (
          <p className="text-[10px] text-slate-700 px-2 py-1">No servers saved yet</p>
        )}

        {}
        <button
          onClick={() => setConnectModal(true)}
          title="Quick connect"
          className="flex items-center gap-2 w-full px-2 py-1.5 mt-1 rounded text-sm text-slate-500 hover:text-pylon-cyan hover:bg-void-700 transition-colors border border-dashed border-void-600 hover:border-pylon-cyan/30"
        >
          <Plus size={14} className="shrink-0" />
          {sidebarOpen && <span className="text-xs">Quick Connect</span>}
        </button>

        {}
        {sidebarOpen && servers.length > 0 && !hasLock && (
          <div className="mt-1 px-2 py-1.5 rounded bg-pylon-amber/5 border border-pylon-amber/20 flex items-start gap-1.5">
            <AlertTriangle size={11} className="text-pylon-amber shrink-0 mt-0.5" />
            <p className="text-[10px] text-pylon-amber/80 leading-tight">
              Saved servers have no app lock — anyone with PC access can connect.{" "}
              <button onClick={() => setActiveTab("settings")} className="underline">Set one in Settings.</button>
            </p>
          </div>
        )}
      </div>

      {}
      <div className="p-2 border-t border-void-600">
        <button
          onClick={() => setVaultModal(true)}
          className="flex items-center gap-2 w-full px-2 py-2 rounded text-sm text-slate-400 hover:text-pylon-amber hover:bg-void-700 transition-colors"
          title="ZVault — encrypted credential store"
        >
          <KeyRound size={16} className="shrink-0" />
          {sidebarOpen && (
            <div className="flex-1 min-w-0 text-left">
              <p className="text-xs">ZVault</p>
              <p className="text-[10px] text-slate-600">Encrypted credentials</p>
            </div>
          )}
        </button>
      </div>

      {}
      <AnimatePresence>
        {ctxMenu && (() => {
          const liveSession = connections.find(
            (c) => c.host === ctxMenu.server.host && c.port === ctxMenu.server.port && c.username === ctxMenu.server.username
          );
          const items: ContextMenuEntry[] = [
            {
              label: "Edit / Reconnect",
              icon: <Edit2 size={12} />,
              onClick: () => { setConnectModal(true, ctxMenu.server); },
            },
            ...(liveSession ? [{
              label: "Disconnect",
              icon: <Unplug size={12} />,
              onClick: () => { disconnectFromServer(liveSession.id); },
              danger: true,
            } as ContextMenuEntry] : []),
            { separator: true as const },
            {
              label: "Remove from list",
              icon: <Trash2 size={12} />,
              onClick: () => { remove(ctxMenu.server.id); },
              danger: true,
            },
          ];
          return (
            <ContextMenu
              x={ctxMenu.x}
              y={ctxMenu.y}
              items={items}
              onClose={() => setCtxMenu(null)}
            />
          );
        })()}
      </AnimatePresence>
    </motion.aside>
  );
}
