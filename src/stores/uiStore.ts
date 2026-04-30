import { create } from "zustand";
import { PylonTab } from "../types";
import { SavedServer } from "./serverStore";

export type BottomMode = "terminal" | "log" | "split" | "hidden";

interface UiStore {
  activeTab: PylonTab;
  sidebarOpen: boolean;
  terminalHeight: number;
  syncPaneOpen: boolean;
  vaultModalOpen: boolean;
  connectModalOpen: boolean;
  connectPrefill: SavedServer | null;
  settingsModalOpen: boolean;
  transferDrawerOpen: boolean;
  remoteTerminalCwd: string | null;
  bottomMode: BottomMode;

  setActiveTab: (tab: PylonTab) => void;
  toggleSidebar: () => void;
  setTerminalHeight: (h: number) => void;
  toggleSyncPane: () => void;
  setVaultModal: (open: boolean) => void;
  setConnectModal: (open: boolean, prefill?: SavedServer | null) => void;
  setSettingsModal: (open: boolean) => void;
  toggleTransferDrawer: () => void;
  setTransferDrawer: (open: boolean) => void;
  setRemoteTerminalCwd: (path: string | null) => void;
  setBottomMode: (mode: BottomMode) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  activeTab: "files",
  sidebarOpen: true,
  terminalHeight: 280,
  syncPaneOpen: false,
  vaultModalOpen: false,
  connectModalOpen: false,
  connectPrefill: null,
  settingsModalOpen: false,
  transferDrawerOpen: false,
  remoteTerminalCwd: null,
  bottomMode: "terminal",

  setActiveTab: (tab) => set({ activeTab: tab }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setTerminalHeight: (h) => set({ terminalHeight: h }),
  toggleSyncPane: () => set((s) => ({ syncPaneOpen: !s.syncPaneOpen })),
  setVaultModal: (open) => set({ vaultModalOpen: open }),
  setConnectModal: (open, prefill = null) => set({ connectModalOpen: open, connectPrefill: open ? prefill : null }),
  setSettingsModal: (open) => set({ settingsModalOpen: open }),
  toggleTransferDrawer: () => set((s) => ({ transferDrawerOpen: !s.transferDrawerOpen })),
  setTransferDrawer: (open) => set({ transferDrawerOpen: open }),
  setRemoteTerminalCwd: (path) => set({ remoteTerminalCwd: path }),
  setBottomMode: (mode) => set({ bottomMode: mode }),
}));
