import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeName = "deep-void" | "night" | "soft-void" | "neon" | "amber" | "rose" | "forest";
export type HostKeyPolicy = "ask" | "auto-accept" | "strict";
export type DefaultShell = "" | "bash" | "zsh" | "fish" | "sh";

export interface AppSettings {
  maxConcurrentTransfers: number;
  defaultChunkKb: number;
  bandwidthLimitKbps: number;
  autoVerifyChecksum: boolean;
  autoStripMetadata: boolean;

  termFontFamily: string;
  termFontSize: number;
  termScrollback: number;
  defaultShell: DefaultShell;
  terminalFollowsBrowser: boolean;

  vaultAutoLockMinutes: number;
  hostKeyPolicy: HostKeyPolicy;

  theme: ThemeName;
  sidebarWidth: number;

  defaultLocalPath: string;
  autoReconnect: boolean;
  confirmDeletes: boolean;
}

interface SettingsStore extends AppSettings {
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  reset: () => void;
}

export const DEFAULT_SETTINGS: AppSettings = {
  maxConcurrentTransfers: 4,
  defaultChunkKb: 256,
  bandwidthLimitKbps: 0,
  autoVerifyChecksum: true,
  autoStripMetadata: false,
  termFontFamily: '"JetBrains Mono", "JetBrainsMono Nerd Font", "Cascadia Code", Menlo, Consolas, "Symbols Nerd Font Mono", monospace',
  termFontSize: 13,
  termScrollback: 10000,
  defaultShell: "",
  terminalFollowsBrowser: true,
  vaultAutoLockMinutes: 30,
  hostKeyPolicy: "ask",
  theme: "deep-void",
  sidebarWidth: 232,
  defaultLocalPath: "",
  autoReconnect: true,
  confirmDeletes: true,
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (key, value) => set({ [key]: value } as Partial<AppSettings>),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: "pylon-settings",
      version: 2,
      migrate: (persisted: any, version) => {
        const s = { ...DEFAULT_SETTINGS, ...(persisted ?? {}) };
        if (version < 2) {
          const old = String(s.defaultShell ?? "");
          s.defaultShell = old === "/bin/bash" || old === "" ? "" : ((old.split("/").pop() ?? "") as DefaultShell);
          if (s.defaultChunkKb === 512) s.defaultChunkKb = 256;
        }
        return s;
      },
    },
  ),
);
