import { create } from "zustand";

export interface TermTab {
  id: string;
  terminalId: string;
  label: string;
  sessionId: string;
}

interface TerminalStore {
  tabs: TermTab[];
  activeTabBySession: Record<string, string>;
  deadTerminalIds: Set<string>;

  addTab: (tab: TermTab) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  renameTab: (tabId: string, label: string) => void;
  clearTabsForSession: (sessionId: string) => void;
  markTerminalDead: (terminalId: string) => void;
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  tabs: [],
  activeTabBySession: {},
  deadTerminalIds: new Set<string>(),

  addTab: (tab) =>
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabBySession: { ...s.activeTabBySession, [tab.sessionId]: tab.id },
    })),

  removeTab: (tabId) =>
    set((s) => {
      const removed = s.tabs.find((t) => t.id === tabId);
      const remaining = s.tabs.filter((t) => t.id !== tabId);
      const newBySession = { ...s.activeTabBySession };
      if (removed && newBySession[removed.sessionId] === tabId) {
        const next = remaining.filter((t) => t.sessionId === removed.sessionId).at(-1);
        if (next) newBySession[removed.sessionId] = next.id;
        else delete newBySession[removed.sessionId];
      }
      return { tabs: remaining, activeTabBySession: newBySession };
    }),

  setActiveTab: (tabId) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab) return s;
      return { activeTabBySession: { ...s.activeTabBySession, [tab.sessionId]: tabId } };
    }),

  renameTab: (tabId, label) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, label } : t)),
    })),

  clearTabsForSession: (sessionId) =>
    set((s) => {
      const remaining = s.tabs.filter((t) => t.sessionId !== sessionId);
      const { [sessionId]: _dropped, ...rest } = s.activeTabBySession;
      return { tabs: remaining, activeTabBySession: rest };
    }),

  markTerminalDead: (terminalId) =>
    set((s) => ({ deadTerminalIds: new Set([...s.deadTerminalIds, terminalId]) })),
}));
