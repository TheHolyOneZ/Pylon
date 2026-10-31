import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import {
  ArrowLeftRight, FolderTree, KeyRound, Lock, PanelLeftClose, PanelLeftOpen, Pencil, Plug, Plus, RefreshCw,
  Settings, SquareTerminal, Trash2, Unplug,
} from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { useServerStore, SavedServer } from "../../stores/serverStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTransferStore, isActive } from "../../stores/transferStore";
import { useSyncStore } from "../../stores/syncStore";
import { PylonTab, Credential } from "../../types";
import { ContextMenu, ContextMenuEntry } from "../files/ContextMenu";
import { Spinner } from "../ui/primitives";
import { toast } from "../../stores/toastStore";
import { errMsg } from "../../lib/format";
import { modKey } from "../../lib/path";
import { useHostKeyFlow } from "../modals/HostKeyModal";

function NavItem({ icon, label, active, collapsed, onClick, badge, hint }: {
  icon: React.ReactNode; label: string; active: boolean; collapsed: boolean; onClick: () => void; badge?: number; hint?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? `${label}${hint ? ` (${hint})` : ""}` : hint}
      className={`relative flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors ${
        active ? "bg-void-700 text-slate-50" : "text-slate-400 hover:bg-void-800 hover:text-slate-100"
      }`}
    >
      {active && <span className="absolute -left-2 top-1.5 h-5 w-[3px] rounded-r bg-pylon-cyan" />}
      <span className={`shrink-0 ${active ? "text-pylon-cyan" : ""}`}>{icon}</span>
      {!collapsed && <span className="flex-1 truncate text-left">{label}</span>}
      {!!badge && (
        <span className={`tabular rounded-full bg-pylon-cyan/15 px-1.5 text-[10.5px] font-medium leading-[18px] text-pylon-cyan ${collapsed ? "absolute -right-0.5 -top-0.5" : ""}`}>
          {badge}
        </span>
      )}
    </button>
  );
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between px-2 pt-2">
      <span className="text-[11px] font-medium text-slate-500">{children}</span>
      {action}
    </div>
  );
}

function ServerRow({ title, sub, status, collapsed, active, busy, onClick, onContextMenu }: {
  title: string; sub: string; status: "live" | "idle"; collapsed: boolean; active: boolean; busy?: boolean;
  onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={collapsed ? `${title}\n${sub}` : sub}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${
        active ? "bg-void-700" : "hover:bg-void-800"
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {busy ? <Spinner className="h-3 w-3 text-pylon-cyan" /> : <span className={`h-2 w-2 rounded-full ${status === "live" ? "bg-pylon-green" : "border border-slate-600"}`} />}
      </span>
      {!collapsed && (
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[13px] leading-tight ${active ? "text-slate-50" : "text-slate-300"}`}>{title}</span>
          <span className="block truncate text-[11px] leading-tight text-slate-500">{sub}</span>
        </span>
      )}
    </button>
  );
}

export function Sidebar() {
  const { connections, activeSessionId, setActiveSession, disconnectFromServer, vaultUnlocked, credentials, credentialIdBySession, connectVault } = useConnectionStore();
  const { servers, remove } = useServerStore();
  const sidebarWidth = useSettingsStore((s) => s.sidebarWidth);
  const { sidebarOpen, toggleSidebar, activeTab, setActiveTab, setConnectModal, setVaultModal } = useUiStore();
  const activeTransfers = useTransferStore((s) => s.transfers.filter((t) => isActive(t.state)).length);
  const syncCount = useSyncStore((s) => s.syncs.length);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const [busyCred, setBusyCred] = useState<string | null>(null);
  const hostKey = useHostKeyFlow();
  const collapsed = !sidebarOpen;

  const liveFor = (host: string, port: number, user: string) =>
    connections.find((c) => c.host === host && c.port === port && c.username === user);

  const sortedServers = [...servers].sort((a, b) => (b.lastConnected ?? "").localeCompare(a.lastConnected ?? "") || a.label.localeCompare(b.label));
  const liveCredIds = new Set(Object.values(credentialIdBySession));
  const unsaved = connections.filter(
    (c) => !servers.some((s) => s.host === c.host && s.port === c.port && s.username === c.username) && !(credentialIdBySession[c.id] && vaultUnlocked),
  );

  function openServer(server: SavedServer) {
    const live = liveFor(server.host, server.port, server.username);
    if (live) {
      setActiveSession(live.id);
      if (activeTab !== "terminal") setActiveTab("files");
    } else setConnectModal(true, server);
  }

  async function openCredential(cred: Credential) {
    const liveId = Object.entries(credentialIdBySession).find(([, c]) => c === cred.id)?.[0];
    if (liveId) { setActiveSession(liveId); return; }
    setBusyCred(cred.id);
    try {
      const r = await connectVault(cred.id);
      if (r.kind === "host_key") await hostKey.prompt(r.verification, { credentialId: cred.id });
      setActiveTab(activeTab === "terminal" ? "terminal" : "files");
    } catch (e) {
      toast.error(`Couldn't connect to ${cred.label}`, errMsg(e));
    } finally {
      setBusyCred(null);
    }
  }

  const nav: { tab: PylonTab; icon: React.ReactNode; label: string; badge?: number }[] = [
    { tab: "files", icon: <FolderTree size={16} />, label: "Files" },
    { tab: "terminal", icon: <SquareTerminal size={16} />, label: "Terminal" },
    { tab: "sync", icon: <RefreshCw size={16} />, label: "Sync", badge: syncCount || undefined },
    { tab: "transfers", icon: <ArrowLeftRight size={16} />, label: "Transfers", badge: activeTransfers || undefined },
  ];

  return (
    <aside style={{ width: collapsed ? 52 : sidebarWidth }} className="flex shrink-0 flex-col overflow-hidden border-r border-void-600 bg-void-900 transition-[width] duration-150">
      <nav className="flex flex-col gap-0.5 px-2 pt-2">
        {nav.map((n) => (
          <NavItem key={n.tab} icon={n.icon} label={n.label} badge={n.badge} collapsed={collapsed} active={activeTab === n.tab} onClick={() => setActiveTab(n.tab)} />
        ))}
      </nav>

      <div className="mx-3 my-2 h-px bg-void-600" />

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!collapsed && (
          <SectionLabel
            action={
              <button onClick={() => setConnectModal(true)} title={`New connection (${modKey()}+N)`} className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-void-700 hover:text-slate-200">
                <Plus size={13} />
              </button>
            }
          >
            Servers
          </SectionLabel>
        )}

        <div className="space-y-px">
          {sortedServers.map((server) => {
            const live = liveFor(server.host, server.port, server.username);
            return (
              <ServerRow
                key={server.id}
                title={server.label}
                sub={`${server.username}@${server.host}${server.port !== 22 ? `:${server.port}` : ""}`}
                status={live ? "live" : "idle"}
                active={!!live && live.id === activeSessionId}
                collapsed={collapsed}
                onClick={() => openServer(server)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({
                    x: e.clientX, y: e.clientY,
                    items: [
                      { label: live ? "Show" : "Connect…", icon: <Plug size={13} />, onClick: () => openServer(server) },
                      { label: "Edit…", icon: <Pencil size={13} />, onClick: () => setConnectModal(true, server) },
                      ...(live ? [{ label: "Disconnect", icon: <Unplug size={13} />, onClick: () => disconnectFromServer(live.id) } as ContextMenuEntry] : []),
                      { separator: true },
                      { label: "Remove from list", icon: <Trash2 size={13} />, danger: true, onClick: () => remove(server.id) },
                    ],
                  });
                }}
              />
            );
          })}
          {unsaved.map((conn) => (
            <ServerRow
              key={conn.id}
              title={conn.label}
              sub={`${conn.username}@${conn.host} · not saved`}
              status="live"
              active={conn.id === activeSessionId}
              collapsed={collapsed}
              onClick={() => setActiveSession(conn.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({ x: e.clientX, y: e.clientY, items: [{ label: "Disconnect", icon: <Unplug size={13} />, onClick: () => disconnectFromServer(conn.id) }] });
              }}
            />
          ))}
          {!collapsed && sortedServers.length === 0 && unsaved.length === 0 && !(vaultUnlocked && credentials.length > 0) && (
            <button
              onClick={() => setConnectModal(true)}
              className="mt-1 flex w-full items-center gap-2 rounded-md border border-dashed border-void-500 px-2.5 py-2 text-xs text-slate-400 hover:border-pylon-cyan/50 hover:text-slate-200"
            >
              <Plus size={13} /> Add a server
            </button>
          )}
        </div>

        {vaultUnlocked && credentials.length > 0 && (
          <>
            {!collapsed && <SectionLabel>ZVault</SectionLabel>}
            {collapsed && <div className="mx-1 my-2 h-px bg-void-600" />}
            <div className="space-y-px">
              {credentials.map((cred) => {
                const liveId = Object.entries(credentialIdBySession).find(([, c]) => c === cred.id)?.[0];
                return (
                  <ServerRow
                    key={cred.id}
                    title={cred.label}
                    sub={`${cred.username}@${cred.host}${cred.port !== 22 ? `:${cred.port}` : ""}`}
                    status={liveCredIds.has(cred.id) ? "live" : "idle"}
                    active={!!liveId && liveId === activeSessionId}
                    busy={busyCred === cred.id}
                    collapsed={collapsed}
                    onClick={() => openCredential(cred)}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="space-y-0.5 border-t border-void-600 p-2">
        <button
          onClick={() => setVaultModal(true)}
          title={collapsed ? (vaultUnlocked ? "ZVault — unlocked" : "ZVault — locked") : "Encrypted credential vault"}
          className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-slate-400 hover:bg-void-800 hover:text-slate-100"
        >
          {vaultUnlocked ? <KeyRound size={16} className="shrink-0 text-pylon-amber" /> : <Lock size={16} className="shrink-0" />}
          {!collapsed && (
            <>
              <span className="flex-1 text-left">ZVault</span>
              <span className={`text-[11px] ${vaultUnlocked ? "text-pylon-amber" : "text-slate-500"}`}>{vaultUnlocked ? "Unlocked" : "Locked"}</span>
            </>
          )}
        </button>
        <NavItem icon={<Settings size={16} />} label="Settings" collapsed={collapsed} active={activeTab === "settings"} onClick={() => setActiveTab("settings")} />
        <button
          onClick={toggleSidebar}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-slate-500 hover:bg-void-800 hover:text-slate-200"
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>

      <AnimatePresence>{ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}</AnimatePresence>
      {hostKey.element}
    </aside>
  );
}
