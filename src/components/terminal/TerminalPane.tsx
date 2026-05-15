import { useEffect, useRef, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";
import {
  Clipboard, Minus, Plus, Terminal as TermIcon, Trash2, X, Zap,
} from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { useSnippets } from "./useSnippets";
import { useSettingsStore } from "../../stores/settingsStore";
import { useActivityStore } from "../../stores/activityStore";
import { useTerminalStore, TermTab } from "../../stores/terminalStore";
import * as api from "../../lib/tauri";
import { errMsg } from "../../lib/format";

interface TermRef {
  terminal: Terminal;
  fit: FitAddon;
  observer: ResizeObserver;
}

export function TerminalPane() {
  const { tabs, activeTabBySession, addTab, removeTab, setActiveTab, renameTab, deadTerminalIds, markTerminalDead } = useTerminalStore();
  const settings = useSettingsStore();
  const [fontSize, setFontSize] = useState(() => settings.termFontSize);
  const [renamingTab, setRenamingTab] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  const termRefs = useRef<Map<string, TermRef>>(new Map());

  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const renameInputRef = useRef<HTMLInputElement>(null);

  const { activeSessionId } = useConnectionStore();
  const { remoteTerminalCwd } = useUiStore();
  const { snippets } = useSnippets();
  const addActivity = useActivityStore((s) => s.add);

  const makeContainerRef = useCallback((tabId: string) => (el: HTMLDivElement | null) => {
    if (el) containerRefs.current.set(tabId, el);
    else containerRefs.current.delete(tabId);
  }, []);

  const visibleTabs = tabs.filter((t) => t.sessionId === activeSessionId);
  const activeTabId = activeSessionId ? (activeTabBySession[activeSessionId] ?? null) : null;
  const activeTab = visibleTabs.find((t) => t.id === activeTabId) ?? null;

  async function openNewTab() {
    if (!activeSessionId) return;
    const shell = useSettingsStore.getState().defaultShell;
    try {
      const terminalId = await api.createTerminal(activeSessionId, 120, 30, shell);
      const tabId = crypto.randomUUID();
      addTab({
        id: tabId,
        terminalId,
        label: `Shell ${visibleTabs.length + 1}`,
        sessionId: activeSessionId,
      });
      addActivity({ type: "info", message: `Terminal opened (${shell ?? "default shell"})` });
    } catch (e: any) {
      addActivity({ type: "error", message: `Failed to open terminal: ${errMsg(e)}` });
    }
  }

  async function closeTab(tabId: string) {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) {
      try { await api.closeTerminal(tab.terminalId); } catch {  }
      const ref = termRefs.current.get(tab.terminalId);
      if (ref) {
        ref.observer.disconnect();
        ref.terminal.dispose();
        termRefs.current.delete(tab.terminalId);
      }
    }
    containerRefs.current.delete(tabId);
    removeTab(tabId);
  }

  function startRenameTab(tab: TermTab) {
    setRenameVal(tab.label);
    setRenamingTab(tab.id);
    setTimeout(() => renameInputRef.current?.select(), 0);
  }

  function commitRename() {
    if (!renamingTab) return;
    const trimmed = renameVal.trim();
    if (trimmed) renameTab(renamingTab, trimmed);
    setRenamingTab(null);
  }

  function changeFontSize(delta: number) {
    const next = Math.min(24, Math.max(8, fontSize + delta));
    setFontSize(next);
    settings.set("termFontSize", next);
    termRefs.current.forEach(({ terminal, fit }) => {
      terminal.options.fontSize = next;
      fit.fit();
    });
  }

  function clearTerminal() {
    if (!activeTab) return;
    termRefs.current.get(activeTab.terminalId)?.terminal.clear();
  }

  function copySelection() {
    if (!activeTab) return;
    const text = termRefs.current.get(activeTab.terminalId)?.terminal.getSelection();
    if (text) navigator.clipboard.writeText(text).catch(() => {});
  }

  useEffect(() => {
    if (!activeTab) return;
    const container = containerRefs.current.get(activeTab.id);
    if (!container) return;

    if (termRefs.current.has(activeTab.terminalId)) {
      requestAnimationFrame(() => termRefs.current.get(activeTab.terminalId)?.fit.fit());
      return;
    }

    const terminalReady = { current: false };

    const { termFontFamily, termFontSize: initFontSize, termScrollback } = useSettingsStore.getState();
    const terminal = new Terminal({
      theme: {
        background: "#07090f",
        foreground: "#e2e8f0",
        cursor: "#00e5ff",
        cursorAccent: "#07090f",
        selectionBackground: "#00e5ff22",
        black: "#0d1018", brightBlack: "#1a2030",
        cyan: "#00e5ff", brightCyan: "#00e5ff",
        magenta: "#b44dff", brightMagenta: "#b44dff",
        yellow: "#ffaa00", brightYellow: "#ffaa00",
        green: "#00ff9d", brightGreen: "#00ff9d",
        red: "#ff4560", brightRed: "#ff4560",
        white: "#e2e8f0", brightWhite: "#ffffff",
        blue: "#4d9fff", brightBlue: "#4d9fff",
      },
      fontFamily: termFontFamily,
      fontSize: initFontSize,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: termScrollback,
    });

    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(container);
    fit.fit();
    terminalReady.current = true;

    const observer = new ResizeObserver(() => {
      if (terminalReady.current) fit.fit();
    });
    observer.observe(container);

    terminal.onData((data) => {
      const bytes = Array.from(new TextEncoder().encode(data));
      api.terminalInput(activeTab.terminalId, bytes).catch(() => {});
    });

    terminal.onResize(({ cols, rows }) => {
      if (terminalReady.current) {
        api.resizeTerminal(activeTab.terminalId, cols, rows).catch(() => {});
      }
    });

    termRefs.current.set(activeTab.terminalId, { terminal, fit, observer });
  }, [activeTabId, activeTab, visibleTabs.length]);

  useEffect(() => {
    const unlisten = listen<{ terminal_id: string; data: number[] }>(
      "terminal://output",
      (event) => {
        const { terminal_id, data } = event.payload;
        termRefs.current.get(terminal_id)?.terminal.write(new Uint8Array(data));
      }
    );
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    const unlisten = listen<{ terminal_id: string }>(
      "terminal://died",
      (event) => { markTerminalDead(event.payload.terminal_id); }
    );
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    termRefs.current.forEach(({ terminal }) => {
      terminal.options.scrollback = settings.termScrollback;
    });
  }, [settings.termScrollback]);

  useEffect(() => {
    if (!remoteTerminalCwd || !activeTab) return;
    api.terminalInput(activeTab.terminalId, Array.from(new TextEncoder().encode(`cd ${remoteTerminalCwd}\r`)));
  }, [remoteTerminalCwd]);

  useEffect(() => {
    setFontSize(settings.termFontSize);
    termRefs.current.forEach(({ terminal, fit }) => {
      terminal.options.fontSize = settings.termFontSize;
      terminal.options.fontFamily = settings.termFontFamily;
      fit.fit();
    });
  }, [settings.termFontSize, settings.termFontFamily]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === "T") { e.preventDefault(); openNewTab(); }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeSessionId, visibleTabs.length]);

  useEffect(() => {
    return () => {
      termRefs.current.forEach(({ terminal, observer }) => {
        observer.disconnect();
        terminal.dispose();
      });
      termRefs.current.clear();
    };
  }, []);

  function runSnippet(command: string) {
    if (!activeTab) return;
    api.terminalInput(activeTab.terminalId, Array.from(new TextEncoder().encode(command + "\r"))).catch(() => {});
  }

  const noSession = !activeSessionId;

  return (
    <div className="flex flex-col h-full bg-void-900 border-t border-void-600">
      {}
      <div className="flex items-center gap-1 px-2 py-1 bg-void-800 border-b border-void-600 overflow-x-auto shrink-0">
        <TermIcon size={13} className="text-pylon-cyan shrink-0 mr-1" />

        {visibleTabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs cursor-pointer transition-all group shrink-0 ${
              activeTabId === tab.id
                ? "bg-void-700 text-slate-200 border border-void-500"
                : "text-slate-500 hover:text-slate-300 hover:bg-void-700/50"
            }`}
          >
            {renamingTab === tab.id ? (
              <input
                ref={renameInputRef}
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setRenamingTab(null);
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
                className="bg-transparent border-b border-pylon-cyan/50 outline-none w-20 text-slate-200"
                autoFocus
              />
            ) : (
              <span onDoubleClick={(e) => { e.stopPropagation(); startRenameTab(tab); }}>
                {tab.label}
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              className="opacity-0 group-hover:opacity-100 hover:text-pylon-red transition-all"
            >
              <X size={10} />
            </button>
          </div>
        ))}

        <button
          onClick={openNewTab}
          disabled={noSession}
          title={noSession ? "Connect to a server first" : "New terminal tab (Ctrl+Shift+T)"}
          className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-pylon-cyan transition-colors disabled:opacity-30 shrink-0"
        >
          <Plus size={13} />
        </button>

        {}
        {activeTab && (
          <>
            <div className="w-px h-4 bg-void-600 mx-1 shrink-0" />
            <button onClick={copySelection} title="Copy selection"
              className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-300 transition-colors shrink-0">
              <Clipboard size={12} />
            </button>
            <button onClick={clearTerminal} title="Clear terminal"
              className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-300 transition-colors shrink-0">
              <Trash2 size={12} />
            </button>
            <div className="w-px h-4 bg-void-600 mx-1 shrink-0" />
            <button onClick={() => changeFontSize(-1)} title="Decrease font size"
              className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-300 transition-colors shrink-0">
              <Minus size={11} />
            </button>
            <span className="text-[10px] text-slate-600 font-mono shrink-0">{fontSize}</span>
            <button onClick={() => changeFontSize(1)} title="Increase font size"
              className="p-1 rounded hover:bg-void-700 text-slate-500 hover:text-slate-300 transition-colors shrink-0">
              <Plus size={11} />
            </button>
          </>
        )}

        {}
        {snippets.length > 0 && activeTab && (
          <>
            <div className="w-px h-4 bg-void-600 mx-1 shrink-0" />
            <div className="flex items-center gap-1 overflow-x-auto">
              {snippets.slice(0, 5).map((s) => (
                <button
                  key={s.id}
                  onClick={() => runSnippet(s.command)}
                  title={s.command}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-void-700/50 hover:bg-void-600 text-slate-400 hover:text-slate-200 transition-colors shrink-0 border border-void-600/50"
                  style={{ borderColor: s.color ? `${s.color}40` : undefined }}
                >
                  <Zap size={10} style={{ color: s.color ?? undefined }} />
                  {s.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex-1 overflow-hidden relative">
        {tabs.map((tab) => {
          const isVisible = tab.sessionId === activeSessionId && tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              ref={makeContainerRef(tab.id)}
              className={`absolute inset-0 p-1 ${isVisible ? "" : "invisible pointer-events-none"}`}
            />
          );
        })}
        {activeTab && deadTerminalIds.has(activeTab.terminalId) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-void-900/80 backdrop-blur-sm z-10">
            <TermIcon size={28} className="text-pylon-red/60" />
            <p className="text-sm text-slate-400">Session ended</p>
            <button
              onClick={() => closeTab(activeTab.id)}
              className="px-3 py-1.5 rounded-lg text-xs bg-void-700 border border-void-500 text-slate-400 hover:text-slate-200 hover:border-void-400 transition-colors"
            >
              Close tab
            </button>
          </div>
        )}
        {visibleTabs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
            <TermIcon size={28} className="opacity-30" />
            <p className="text-sm">
              {noSession ? "Connect to a server first" : "Click + to open a terminal"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
