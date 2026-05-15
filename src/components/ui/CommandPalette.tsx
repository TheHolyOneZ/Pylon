import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Command, Search } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useFileStore } from "../../stores/fileStore";

interface PaletteAction {
  label: string;
  description?: string;
  shortcut?: string;
  group: string;
  action: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { setConnectModal, setVaultModal, setActiveTab, toggleTransferDrawer } = useUiStore();
  const { activeSessionId, disconnectFromServer } = useConnectionStore();
  const { refreshLocal, refreshRemote, toggleHidden, showHidden } = useFileStore();

  const actions: PaletteAction[] = [
    { label: "New Connection", description: "Open connect dialog", shortcut: "Ctrl+N", group: "Connections", action: () => { setConnectModal(true); onClose(); } },
    { label: "Open ZVault", description: "Manage saved credentials", group: "Connections", action: () => { setVaultModal(true); onClose(); } },
    ...(activeSessionId ? [
      { label: "Disconnect", description: "Disconnect active session", shortcut: "Ctrl+D", group: "Connections", action: () => { disconnectFromServer(activeSessionId); onClose(); } },
    ] : []),
    { label: "Go to Files", group: "Navigation", action: () => { setActiveTab("files"); onClose(); } },
    { label: "Go to Terminal", group: "Navigation", action: () => { setActiveTab("terminal"); onClose(); } },
    { label: "Go to Transfers", group: "Navigation", shortcut: "Ctrl+T", action: () => { setActiveTab("transfers"); onClose(); } },
    { label: "Go to Sync", group: "Navigation", action: () => { setActiveTab("sync"); onClose(); } },
    { label: "Go to Settings", group: "Navigation", action: () => { setActiveTab("settings"); onClose(); } },
    { label: "Refresh Files", description: "Reload both panes", shortcut: "F5", group: "Files", action: () => { refreshLocal(); if (activeSessionId) refreshRemote(activeSessionId); onClose(); } },
    { label: showHidden ? "Hide Hidden Files" : "Show Hidden Files", group: "Files", action: () => { toggleHidden(); onClose(); } },
    { label: "Toggle Transfer Drawer", shortcut: "Ctrl+T", group: "Transfers", action: () => { toggleTransferDrawer(); onClose(); } },
  ];

  const filtered = query.trim()
    ? actions.filter((a) =>
        a.label.toLowerCase().includes(query.toLowerCase()) ||
        a.description?.toLowerCase().includes(query.toLowerCase()) ||
        a.group.toLowerCase().includes(query.toLowerCase())
      )
    : actions;

  useEffect(() => { setSelectedIdx(0); }, [query]);
  useEffect(() => { if (open) { setQuery(""); inputRef.current?.focus(); } }, [open]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); filtered[selectedIdx]?.action(); }
    if (e.key === "Escape") onClose();
  }

  const groups = Array.from(new Set(filtered.map((a) => a.group)));

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[600] bg-black/50 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 450, damping: 30 }}
            className="fixed left-1/2 top-24 z-[610] w-[520px] -translate-x-1/2 bg-void-800 border border-void-500 rounded-xl shadow-2xl overflow-hidden"
          >
            {}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-void-600">
              <Search size={14} className="text-slate-500 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a command…"
                className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 outline-none"
              />
              <kbd className="text-[10px] px-1.5 py-0.5 bg-void-700 border border-void-500 rounded text-slate-500 font-mono">ESC</kbd>
            </div>

            {}
            <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <p className="text-center text-xs text-slate-600 py-8">No commands found</p>
              ) : (
                groups.map((group) => {
                  const groupItems = filtered.filter((a) => a.group === group);
                  const startIdx = filtered.indexOf(groupItems[0]);
                  return (
                    <div key={group}>
                      <p className="px-4 py-1 text-[10px] text-slate-600 font-semibold uppercase tracking-wider">{group}</p>
                      {groupItems.map((item, i) => {
                        const globalIdx = startIdx + i;
                        return (
                          <button
                            key={item.label}
                            onClick={item.action}
                            onMouseEnter={() => setSelectedIdx(globalIdx)}
                            className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                              selectedIdx === globalIdx ? "bg-pylon-cyan/10 text-slate-100" : "text-slate-300 hover:bg-void-700"
                            }`}
                          >
                            <Command size={12} className="text-slate-600 shrink-0" />
                            <span className="text-sm flex-1">{item.label}</span>
                            {item.description && (
                              <span className="text-xs text-slate-600 hidden md:block">{item.description}</span>
                            )}
                            {item.shortcut && (
                              <kbd className="text-[10px] px-1.5 py-0.5 bg-void-700 border border-void-600 rounded text-slate-500 font-mono shrink-0">
                                {item.shortcut}
                              </kbd>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
