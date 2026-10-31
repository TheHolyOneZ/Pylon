import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeftRight, Eye, FolderTree, KeyRound, Lock, Plug, RefreshCw, Search, Server, Settings, SquareTerminal, Unplug,
} from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useFileStore } from "../../stores/fileStore";
import { useServerStore } from "../../stores/serverStore";
import { modKey } from "../../lib/path";
import { openTerminalTab } from "../terminal/TerminalPane";
import { toast } from "../../stores/toastStore";
import { errMsg } from "../../lib/format";

interface Action {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  group: string;
  icon: React.ReactNode;
  run: () => void;
}

function score(q: string, text: string): number {
  const t = text.toLowerCase();
  if (!q) return 1;
  const i = t.indexOf(q);
  if (i === 0) return 100;
  if (i > 0) return 60 - i;
  let qi = 0;
  for (const ch of t) if (ch === q[qi]) qi++;
  return qi === q.length ? 10 : 0;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const ui = useUiStore();
  const { activeSessionId, connections, credentials, vaultUnlocked, disconnectFromServer, setActiveSession, connectVault, lockVault } = useConnectionStore();
  const fs = useFileStore();
  const servers = useServerStore((s) => s.servers);
  const mod = modKey();

  const actions = useMemo<Action[]>(() => {
    const a: Action[] = [
      { id: "connect", label: "New connection…", shortcut: `${mod}+N`, group: "Connections", icon: <Plug size={14} />, run: () => ui.setConnectModal(true) },
      { id: "vault", label: "Open ZVault", group: "Connections", icon: <KeyRound size={14} />, run: () => ui.setVaultModal(true) },
    ];
    if (vaultUnlocked) a.push({ id: "lock", label: "Lock ZVault", group: "Connections", icon: <Lock size={14} />, run: () => lockVault() });
    for (const c of connections) {
      if (c.id !== activeSessionId) a.push({ id: `sw-${c.id}`, label: `Switch to ${c.label}`, hint: `${c.username}@${c.host}`, group: "Sessions", icon: <Server size={14} />, run: () => setActiveSession(c.id) });
    }
    if (activeSessionId) {
      a.push({ id: "term", label: "New terminal", shortcut: `${mod}+Shift+T`, group: "Sessions", icon: <SquareTerminal size={14} />, run: () => { ui.setActiveTab("terminal"); openTerminalTab(activeSessionId); } });
      a.push({ id: "dc", label: "Disconnect current session", shortcut: `${mod}+Shift+D`, group: "Sessions", icon: <Unplug size={14} />, run: () => disconnectFromServer(activeSessionId) });
    }
    for (const s of servers) {
      a.push({ id: `srv-${s.id}`, label: `Connect to ${s.label}`, hint: `${s.username}@${s.host}`, group: "Saved servers", icon: <Server size={14} />, run: () => ui.setConnectModal(true, s) });
    }
    for (const c of credentials) {
      a.push({
        id: `cred-${c.id}`, label: `Connect to ${c.label}`, hint: `ZVault · ${c.username}@${c.host}`, group: "Saved servers", icon: <KeyRound size={14} />,
        run: () => connectVault(c.id).then((r) => { if (r.kind === "host_key") ui.setVaultModal(true); }).catch((e) => toast.error(`Couldn't connect to ${c.label}`, errMsg(e))),
      });
    }
    a.push(
      { id: "files", label: "Go to Files", group: "Navigate", icon: <FolderTree size={14} />, run: () => ui.setActiveTab("files") },
      { id: "terminal", label: "Go to Terminal", group: "Navigate", icon: <SquareTerminal size={14} />, run: () => ui.setActiveTab("terminal") },
      { id: "sync", label: "Go to Sync", group: "Navigate", icon: <RefreshCw size={14} />, run: () => ui.setActiveTab("sync") },
      { id: "transfers", label: "Go to Transfers", group: "Navigate", icon: <ArrowLeftRight size={14} />, run: () => ui.setActiveTab("transfers") },
      { id: "settings", label: "Settings", shortcut: `${mod}+,`, group: "Navigate", icon: <Settings size={14} />, run: () => ui.setActiveTab("settings") },
      { id: "drawer", label: "Show transfer queue", shortcut: `${mod}+J`, group: "Files", icon: <ArrowLeftRight size={14} />, run: () => ui.setTransferDrawer(true) },
      { id: "refresh", label: "Refresh both panes", shortcut: "F5", group: "Files", icon: <RefreshCw size={14} />, run: () => { fs.refreshLocal(); if (activeSessionId) fs.refreshRemote(activeSessionId); } },
      { id: "hidden", label: fs.showHidden ? "Hide hidden files" : "Show hidden files", group: "Files", icon: <Eye size={14} />, run: () => fs.toggleHidden() },
    );
    return a;
  }, [connections, activeSessionId, servers, credentials, vaultUnlocked, fs.showHidden, mod]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => actions.map((a) => ({ a, s: Math.max(score(q, a.label), score(q, a.hint ?? "") * 0.8) })).filter((x) => x.s > 0).sort((x, y) => (q ? y.s - x.s : 0)).map((x) => x.a),
    [actions, q],
  );

  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);
  useEffect(() => {
    list.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  function run(a: Action) {
    onClose();
    a.run();
  }

  let lastGroup = "";
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
          className="fixed inset-0 z-[300] flex justify-center bg-black/45 pt-[12vh]"
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            role="dialog"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.12 }}
            className="flex h-fit max-h-[60vh] w-[560px] max-w-[92vw] flex-col overflow-hidden rounded-xl bg-void-800 shadow-modal"
          >
            <div className="flex items-center gap-2.5 border-b border-void-600 px-4">
              <Search size={15} className="text-slate-500" />
              <input
                ref={input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); onClose(); }
                  if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(i + 1, filtered.length - 1)); }
                  if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
                  if (e.key === "Enter" && filtered[sel]) { e.preventDefault(); run(filtered[sel]); }
                }}
                placeholder="Type a command or server name…"
                spellCheck={false}
                className="h-12 flex-1 bg-transparent text-[14px] text-slate-100 outline-none"
              />
              <span className="kbd">Esc</span>
            </div>
            <div ref={list} className="min-h-0 overflow-y-auto p-1.5">
              {filtered.length === 0 && <p className="px-3 py-6 text-center text-xs text-slate-500">No matching commands</p>}
              {filtered.map((a, i) => {
                const header = !q && a.group !== lastGroup ? a.group : null;
                lastGroup = a.group;
                return (
                  <div key={a.id}>
                    {header && <div className="px-2.5 pb-1 pt-2.5 text-[11px] font-medium text-slate-500">{header}</div>}
                    <button
                      data-idx={i}
                      onMouseMove={() => setSel(i)}
                      onClick={() => run(a)}
                      className={`flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-left text-[13px] ${i === sel ? "bg-void-600 text-slate-50" : "text-slate-300"}`}
                    >
                      <span className="text-slate-400">{a.icon}</span>
                      <span className="truncate">{a.label}</span>
                      {a.hint && <span className="truncate text-xs text-slate-500">{a.hint}</span>}
                      <span className="flex-1" />
                      {a.shortcut && <span className="shrink-0 text-[11px] text-slate-500">{a.shortcut}</span>}
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
