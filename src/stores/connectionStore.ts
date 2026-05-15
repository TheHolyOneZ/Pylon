import { create } from "zustand";
import { ConnectionInfo, Credential } from "../types";
import * as api from "../lib/tauri";
import { ConnectResult } from "../lib/tauri";
import { useActivityStore } from "./activityStore";
import { useTerminalStore } from "./terminalStore";
import { useFileStore } from "./fileStore";
import { useSettingsStore } from "./settingsStore";

interface ConnectionStore {
  connections: ConnectionInfo[];
  activeSessionId: string | null;
  credentials: Credential[];
  vaultUnlocked: boolean;

  credentialIdBySession: Record<string, string>;

  setActiveSession: (id: string | null) => void;
  addConnection: (info: ConnectionInfo) => void;
  setCredentialId: (sessionId: string, credentialId: string) => void;
  fetchConnections: () => Promise<void>;
  connectToServer: (
    host: string,
    port: number,
    username: string,
    password: string | undefined,
    privateKey: string | undefined,
    label: string
  ) => Promise<ConnectionInfo>;
  disconnectFromServer: (id: string) => Promise<void>;

  fetchCredentials: () => Promise<void>;
  unlockVault: (passphrase: string) => Promise<void>;
  lockVault: () => Promise<void>;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  connections: [],
  activeSessionId: null,
  credentials: [],
  vaultUnlocked: false,
  credentialIdBySession: {},

  setActiveSession: (id) => set({ activeSessionId: id }),

  addConnection: (info) =>
    set((s) => ({ connections: [...s.connections, info], activeSessionId: info.id })),

  setCredentialId: (sessionId, credentialId) =>
    set((s) => ({ credentialIdBySession: { ...s.credentialIdBySession, [sessionId]: credentialId } })),

  fetchConnections: async () => {
    const connections = await api.listConnections();
    set({ connections });
  },

  connectToServer: async (host, port, username, password, privateKey, label) => {
    const hostKeyPolicy = useSettingsStore.getState().hostKeyPolicy;
    const result: ConnectResult = await api.connect({
      host, port, username,
      password, privateKey, label,
    });
    if (result.status === "host_key_unknown" || result.status === "host_key_changed") {
      if (hostKeyPolicy === "strict") {
        throw new Error(`Strict host key policy: ${result.status === "host_key_changed" ? "host key changed" : "unknown host key"} for ${host}. Connection rejected.`);
      }
      if (hostKeyPolicy === "auto-accept") {
        const info = await api.acceptHostKeyAndConnect({
          host, port, username, password, privateKey, label, permanent: false,
        });
        set((s) => ({ connections: [...s.connections, info], activeSessionId: info.id }));
        useFileStore.getState().setOverwritePolicy("ask");
        useActivityStore.getState().add({ type: "success", message: `Connected (auto-accepted key): ${label} (${username}@${host}:${port})` });
        return info;
      }
      throw Object.assign(new Error(result.status), { verification: result.verification });
    }
    if (!result.info) throw new Error("No connection info returned");
    const info = result.info;
    set((s) => ({ connections: [...s.connections, info], activeSessionId: info.id }));
    useFileStore.getState().setOverwritePolicy("ask");
    useActivityStore.getState().add({ type: "success", message: `Connected: ${label} (${username}@${host}:${port})` });
    return info;
  },

  disconnectFromServer: async (id) => {
    const conn = get().connections.find((c) => c.id === id);

    const { tabs, clearTabsForSession } = useTerminalStore.getState();
    const sessionTabs = tabs.filter((t) => t.sessionId === id);
    await Promise.allSettled(sessionTabs.map((t) => api.closeTerminal(t.terminalId)));
    clearTabsForSession(id);

    await api.disconnect(id);
    set((s) => {
      const { [id]: _dropped, ...restCreds } = s.credentialIdBySession;
      return {
        connections: s.connections.filter((c) => c.id !== id),
        activeSessionId: s.activeSessionId === id
          ? (s.connections.find((c) => c.id !== id)?.id ?? null)
          : s.activeSessionId,
        credentialIdBySession: restCreds,
      };
    });
    if (conn) {
      useActivityStore.getState().add({ type: "info", message: `Disconnected: ${conn.label} (${conn.username}@${conn.host})` });
    }
  },

  fetchCredentials: async () => {
    try {
      const credentials = await api.vaultListCredentials();
      set({ credentials });
    } catch {

    }
  },

  unlockVault: async (passphrase) => {
    await api.vaultUnlock(passphrase);
    set({ vaultUnlocked: true });
    await get().fetchCredentials();
  },

  lockVault: async () => {
    await api.vaultLock();
    set({ vaultUnlocked: false, credentials: [] });
  },
}));
