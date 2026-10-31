import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { ClipboardCopy, ClipboardPaste, Eraser, Minus, Plus, RotateCcw, Terminal as TermIcon, X, Zap } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { useConnectionStore } from "../../stores/connectionStore";
import { useSnippets } from "./useSnippets";
import { useSettingsStore } from "../../stores/settingsStore";
import { useActivityStore } from "../../stores/activityStore";
import { useTerminalStore, TermTab } from "../../stores/terminalStore";
import { useUiStore } from "../../stores/uiStore";
import * as api from "../../lib/tauri";
import { errMsg } from "../../lib/format";
import { isMac, modKey } from "../../lib/path";
import {
  applyTerminalSettings, attachTerminal, clearTerminal, copySelection, disposeTerminal,
  ensureTerminalListeners, focusTerminal, initialSize, pasteInto, sendToTerminal,
} from "../../lib/terminalManager";
import { ContextMenu, ContextMenuEntry } from "../files/ContextMenu";
import { IconButton } from "../ui/primitives";
import { toast } from "../../stores/toastStore";

export async function openTerminalTab(sessionId: string) {
  const { defaultShell } = useSettingsStore.getState();
  const { tabs, addTab } = useTerminalStore.getState();
  ensureTerminalListeners();
  try {
    const terminalId = await api.createTerminal(sessionId, initialSize.cols, initialSize.rows, defaultShell || null);
    const n = tabs.filter((t) => t.sessionId === sessionId).length + 1;
    addTab({ id: crypto.randomUUID(), terminalId, label: `Shell ${n}`, sessionId });
    requestAnimationFrame(() => focusTerminal(terminalId));
  } catch (e) {
    const msg = errMsg(e);
    toast.error("Could not open terminal", msg);
    useActivityStore.getState().add({ type: "error", message: "Failed to open terminal", detail: msg });
  }
}

export async function closeTerminalTab(tab: TermTab) {
  await api.closeTerminal(tab.terminalId).catch(() => {});
  disposeTerminal(tab.terminalId);
  useTerminalStore.getState().removeTab(tab.id);
}

function TerminalHost({ terminalId, visible }: { terminalId: string; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!visible || !ref.current) return;
    const cleanup = attachTerminal(terminalId, ref.current);
    return cleanup;
  }, [terminalId, visible]);
  return <div ref={ref} className={`absolute inset-0 ${visible ? "" : "hidden"}`} />;
}

export function TerminalPane() {
  const { tabs, activeTabBySession, setActiveTab, renameTab, deadTerminalIds } = useTerminalStore();
  const settings = useSettingsStore();
  const { activeSessionId, connections } = useConnectionStore();
  const { snippets } = useSnippets();
  const [renamingTab, setRenamingTab] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const [opening, setOpening] = useState(false);

  const session = connections.find((c) => c.id === activeSessionId);
  const visibleTabs = tabs.filter((t) => t.sessionId === activeSessionId);
  const activeTabId = activeSessionId ? activeTabBySession[activeSessionId] ?? null : null;
  const activeTab = visibleTabs.find((t) => t.id === activeTabId) ?? null;
  const activeDead = !!activeTab && deadTerminalIds.has(activeTab.terminalId);

  useEffect(() => { ensureTerminalListeners(); }, []);

  useEffect(() => {
    applyTerminalSettings();
  }, [settings.termFontSize, settings.termFontFamily, settings.termScrollback, settings.theme]);

  useEffect(() => {
    if (activeTab) requestAnimationFrame(() => focusTerminal(activeTab.terminalId));
  }, [activeTab?.terminalId]);

  async function newTab() {
    if (!activeSessionId || opening) return;
    setOpening(true);
    try {
      await openTerminalTab(activeSessionId);
    } finally {
      setOpening(false);
    }
  }

  async function restart(tab: TermTab) {
    await closeTerminalTab(tab);
    await newTab();
  }

  function commitRename() {
    if (renamingTab && renameVal.trim()) renameTab(renamingTab, renameVal.trim());
    setRenamingTab(null);
  }

  function changeFontSize(delta: number) {
    settings.set("termFontSize", Math.min(28, Math.max(8, settings.termFontSize + delta)));
  }

  const ctxItems: ContextMenuEntry[] = activeTab
    ? [
        { label: "Copy", icon: <ClipboardCopy size={13} />, shortcut: isMac() ? "⌘C" : "Ctrl+Shift+C", onClick: () => copySelection(activeTab.terminalId) },
        { label: "Paste", icon: <ClipboardPaste size={13} />, shortcut: isMac() ? "⌘V" : "Ctrl+Shift+V", onClick: () => pasteInto(activeTab.terminalId) },
        { label: "Clear", icon: <Eraser size={13} />, onClick: () => clearTerminal(activeTab.terminalId) },
        { separator: true },
        { label: "Close tab", icon: <X size={13} />, danger: true, onClick: () => closeTerminalTab(activeTab) },
      ]
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-void-900">
      {(activeSessionId || visibleTabs.length > 0) && <div className="flex h-9 shrink-0 items-center gap-1 border-b border-void-600 bg-void-900 px-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {visibleTabs.map((tab) => {
            const active = tab.id === activeTabId;
            const dead = deadTerminalIds.has(tab.terminalId);
            return (
              <div
                key={tab.id}
                onMouseDown={() => setActiveTab(tab.id)}
                onDoubleClick={() => { setRenameVal(tab.label); setRenamingTab(tab.id); }}
                onAuxClick={(e) => { if (e.button === 1) closeTerminalTab(tab); }}
                className={`group flex h-7 shrink-0 items-center gap-2 rounded-md pl-2.5 pr-1 text-xs transition-colors ${
                  active ? "bg-void-700 text-slate-100" : "text-slate-400 hover:bg-void-800 hover:text-slate-200"
                }`}
                title="Double-click to rename · middle-click to close"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${dead ? "bg-pylon-red" : "bg-pylon-green"}`} />
                {renamingTab === tab.id ? (
                  <input
                    autoFocus
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setRenamingTab(null);
                    }}
                    className="w-24 rounded border border-pylon-cyan/50 bg-void-950 px-1 text-xs text-slate-100 outline-none"
                  />
                ) : (
                  <span className="max-w-[140px] truncate">{tab.label}</span>
                )}
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); closeTerminalTab(tab); }}
                  className={`rounded p-0.5 text-slate-500 hover:bg-void-600 hover:text-slate-200 ${active ? "" : "opacity-0 group-hover:opacity-100"}`}
                  title="Close"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
          <IconButton
            onClick={newTab}
            disabled={!activeSessionId || opening}
            title={activeSessionId ? `New terminal (${modKey()}+Shift+T)` : "Connect to a server first"}
          >
            {opening ? <span className="h-3 w-3 animate-spin rounded-full border border-slate-400 border-t-transparent" /> : <Plus size={14} />}
          </IconButton>
        </div>

        {activeTab && (
          <div className="flex shrink-0 items-center gap-0.5">
            {snippets.slice(0, 4).map((s) => (
              <button
                key={s.id}
                onClick={() => { sendToTerminal(activeTab.terminalId, s.command + "\r"); focusTerminal(activeTab.terminalId); }}
                title={s.command}
                className="flex h-6 max-w-[130px] items-center gap-1 rounded-md border border-void-600 px-2 text-[11px] text-slate-300 hover:border-void-500 hover:bg-void-700"
              >
                <Zap size={10} style={{ color: s.color ?? undefined }} className="shrink-0" />
                <span className="truncate">{s.label}</span>
              </button>
            ))}
            {snippets.length > 0 && <div className="mx-1 h-4 w-px bg-void-600" />}
            <IconButton onClick={() => copySelection(activeTab.terminalId)} title="Copy selection"><ClipboardCopy size={13} /></IconButton>
            <IconButton onClick={() => pasteInto(activeTab.terminalId)} title="Paste"><ClipboardPaste size={13} /></IconButton>
            <IconButton onClick={() => clearTerminal(activeTab.terminalId)} title="Clear scrollback"><Eraser size={13} /></IconButton>
            <div className="mx-1 h-4 w-px bg-void-600" />
            <IconButton onClick={() => changeFontSize(-1)} title="Smaller text"><Minus size={13} /></IconButton>
            <span className="tabular w-5 text-center text-[11px] text-slate-500">{settings.termFontSize}</span>
            <IconButton onClick={() => changeFontSize(1)} title="Larger text"><Plus size={13} /></IconButton>
          </div>
        )}
      </div>}

      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onContextMenu={(e) => { if (activeTab) { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY }); } }}
      >
        <div className="absolute inset-0 px-2 pb-1 pt-1.5">
          <div className="relative h-full w-full">
            {tabs.map((tab) => (
              <TerminalHost key={tab.id} terminalId={tab.terminalId} visible={tab.id === activeTab?.id} />
            ))}
          </div>
        </div>

        {activeTab && activeDead && (
          <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-void-500 bg-void-800 px-3 py-2 text-xs text-slate-300 shadow-popover">
            <span>The shell has exited.</span>
            <button onClick={() => restart(activeTab)} className="flex items-center gap-1 rounded-md bg-pylon-cyan px-2 py-1 font-medium text-on-accent hover:brightness-110">
              <RotateCcw size={12} /> Restart
            </button>
            <button onClick={() => closeTerminalTab(activeTab)} className="rounded-md px-2 py-1 text-slate-400 hover:bg-void-700 hover:text-slate-200">Close</button>
          </div>
        )}

        {visibleTabs.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-void-600 bg-void-800 text-slate-500">
              <TermIcon size={18} />
            </div>
            {session ? (
              <>
                <p className="text-sm text-slate-400">No terminal open for <span className="text-slate-200">{session.label}</span></p>
                <button
                  onClick={newTab}
                  disabled={opening}
                  className="flex items-center gap-1.5 rounded-md bg-pylon-cyan px-3 py-1.5 text-xs font-medium text-on-accent hover:brightness-110 disabled:opacity-60"
                >
                  <Plus size={13} /> Open terminal
                </button>
                <span className="text-2xs text-slate-600">{modKey()}+Shift+T</span>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-400">Not connected</p>
                <button
                  onClick={() => useUiStore.getState().setConnectModal(true)}
                  className="rounded-md border border-void-500 px-3 py-1.5 text-xs text-slate-300 hover:bg-void-700"
                >
                  Connect to a server…
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {ctx && <ContextMenu key="tctx" x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
      </AnimatePresence>
    </div>
  );
}
