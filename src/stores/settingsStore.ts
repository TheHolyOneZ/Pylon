import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeName = "deep-void" | "night" | "soft-void" | "neon" | "amber" | "rose" | "forest";
export type HostKeyPolicy = "ask" | "auto-accept" | "strict";
export type DefaultShell = "/bin/bash" | "/bin/zsh" | "/bin/sh" | "/bin/fish";

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

  vaultAutoLockMinutes: number;
  hostKeyPolicy: HostKeyPolicy;

  theme: ThemeName;
  sidebarWidth: number;

  defaultLocalPath: string;
  autoReconnect: boolean;
}

interface SettingsStore extends AppSettings {
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  reset: () => void;
}

const DEFAULTS: AppSettings = {
  maxConcurrentTransfers: 4,
  defaultChunkKb: 512,
  bandwidthLimitKbps: 0,
  autoVerifyChecksum: true,
  autoStripMetadata: false,
  termFontFamily: "JetBrains Mono, Fira Code, monospace",
  termFontSize: 13,
  termScrollback: 10000,
  defaultShell: "/bin/bash",
  vaultAutoLockMinutes: 30,
  hostKeyPolicy: "ask",
  theme: "deep-void",
  sidebarWidth: 220,
  defaultLocalPath: "",
  autoReconnect: false,
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (key, value) => set({ [key]: value } as Partial<AppSettings>),
      reset: () => set(DEFAULTS),
    }),
    { name: "pylon-settings" }
  )
);
