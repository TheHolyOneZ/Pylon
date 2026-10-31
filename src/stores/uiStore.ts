import { create } from "zustand";
import { PylonTab } from "../types";
import { SavedServer } from "./serverStore";

export type BottomMode = "terminal" | "log" | "split" | "hidden";
export type OverwriteAction = "overwrite" | "skip" | "cancel";

interface OverwritePrompt {
  conflicts: string[];
  resolve: (r: { action: OverwriteAction; remember: boolean }) => void;
}

interface UiStore {
  activeTab: PylonTab;
  sidebarOpen: boolean;
  vaultModalOpen: boolean;
  connectModalOpen: boolean;
  connectPrefill: SavedServer | null;
  transferDrawerOpen: boolean;
  commandPaletteOpen: boolean;
  bottomMode: BottomMode;
  bottomSize: number;
  overwritePrompt: OverwritePrompt | null;

  setActiveTab: (tab: PylonTab) => void;
  toggleSidebar: () => void;
  setVaultModal: (open: boolean) => void;
  setConnectModal: (open: boolean, prefill?: SavedServer | null) => void;
  toggleTransferDrawer: () => void;
  setTransferDrawer: (open: boolean) => void;
  setCommandPalette: (open: boolean) => void;
  setBottomMode: (mode: BottomMode) => void;
  setBottomSize: (n: number) => void;
  askOverwrite: (conflicts: string[]) => Promise<{ action: OverwriteAction; remember: boolean }>;
  closeOverwritePrompt: () => void;
}

export const useUiStore = create<UiStore>((set, get) => ({
  activeTab: "files",
  sidebarOpen: true,
  vaultModalOpen: false,
  connectModalOpen: false,
  connectPrefill: null,
  transferDrawerOpen: false,
  commandPaletteOpen: false,
  bottomMode: "terminal",
  bottomSize: 36,
  overwritePrompt: null,

  setActiveTab: (tab) => set({ activeTab: tab }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setVaultModal: (open) => set({ vaultModalOpen: open }),
  setConnectModal: (open, prefill = null) => set({ connectModalOpen: open, connectPrefill: open ? prefill : null }),
  toggleTransferDrawer: () => set((s) => ({ transferDrawerOpen: !s.transferDrawerOpen })),
  setTransferDrawer: (open) => set({ transferDrawerOpen: open }),
  setCommandPalette: (open) => set({ commandPaletteOpen: open }),
  setBottomMode: (mode) => set({ bottomMode: mode }),
  setBottomSize: (n) => set({ bottomSize: n }),

  askOverwrite: (conflicts) =>
    new Promise((resolve) => {
      get().overwritePrompt?.resolve({ action: "cancel", remember: false });
      set({
        overwritePrompt: {
          conflicts,
          resolve: (r) => {
            set({ overwritePrompt: null });
            resolve(r);
          },
        },
      });
    }),
  closeOverwritePrompt: () => get().overwritePrompt?.resolve({ action: "cancel", remember: false }),
}));
