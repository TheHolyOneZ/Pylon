import { create } from "zustand";
import { ConnectionInfo, Credential, HostKeyVerification } from "../types";
import * as api from "../lib/tauri";
import type { AuthArgs } from "../lib/tauri";
import { useActivityStore } from "./activityStore";
import { useTerminalStore } from "./terminalStore";
import { useFileStore } from "./fileStore";
import { useSettingsStore } from "./settingsStore";

export type ConnectOutcome =
  | { kind: "connected"; info: ConnectionInfo }
  | { kind: "host_key"; verification: HostKeyVerification };

interface ConnectionStore {
  connections: ConnectionInfo[];
  activeSessionId: string | null;
  connecting: string[];
  credentials: Credential[];
  vaultUnlocked: boolean;
  credentialIdBySession: Record<string, string>;

  setActiveSession: (id: string | null) => void;
  registerConnection: (info: ConnectionInfo, credentialId?: string) => void;
  addConnection: (info: ConnectionInfo) => void;
  setCredentialId: (sessionId: string, credentialId: string) => void;
  fetchConnections: () => Promise<void>;

  connectQuick: (args: AuthArgs & { label: string }) => Promise<ConnectOutcome>;
  acceptQuick: (args: AuthArgs & { label: string }, fingerprint: string, permanent: boolean) => Promise<ConnectionInfo>;
  connectVault: (credentialId: string) => Promise<ConnectOutcome>;
  acceptVault: (credentialId: string, fingerprint: string, permanent: boolean) => Promise<ConnectionInfo>;
  disconnectFromServer: (id: string) => Promise<void>;
  sessionAlias: Record<string, string>;
  aliasSession: (oldId: string, newId: string) => void;
  resolveSessionId: (id: string) => string;

  fetchCredentials: () => Promise<void>;
  refreshVaultState: () => Promise<void>;
  unlockVault: (passphrase: string) => Promise<void>;
  createVault: (passphrase: string) => Promise<void>;
  lockVault: () => Promise<void>;
}

function policyGate(verification: HostKeyVerification): "prompt" | "accept" {
  const policy = useSettingsStore.getState().hostKeyPolicy;
  const changed = verification.status === "changed";
  if (policy === "strict") {
    throw new Error(
      changed
        ? `Host key for ${verification.host} has CHANGED — strict policy refused the connection.`
        : `Unknown host key for ${verification.host} — strict policy only allows hosts already in known_hosts.`,
    );
  }
  if (policy === "auto-accept" && !changed) return "accept";
  return "prompt";
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  connections: [],
  activeSessionId: null,
  sessionAlias: {},
  aliasSession: (oldId, newId) => set((s) => ({ sessionAlias: { ...s.sessionAlias, [oldId]: newId } })),
  resolveSessionId: (id) => {
    const alias = get().sessionAlias;
    let cur = id;
    for (let i = 0; i < 16 && alias[cur]; i++) cur = alias[cur];
    return cur;
  },
  connecting: [],
  credentials: [],
  vaultUnlocked: false,
  credentialIdBySession: {},

  setActiveSession: (id) => set({ activeSessionId: id }),

  registerConnection: (info, credentialId) => {
    set((s) => ({
      connections: [...s.connections.filter((c) => c.id !== info.id), info],
      activeSessionId: info.id,
      credentialIdBySession: credentialId ? { ...s.credentialIdBySession, [info.id]: credentialId } : s.credentialIdBySession,
    }));
    useActivityStore.getState().add({
      type: "success",
      message: `Connected to ${info.label}`,
      detail: `${info.username}@${info.host}:${info.port}${info.server_version ? ` · ${info.server_version}` : ""}`,
    });
  },

  addConnection: (info) => get().registerConnection(info),

  setCredentialId: (sessionId, credentialId) =>
    set((s) => ({ credentialIdBySession: { ...s.credentialIdBySession, [sessionId]: credentialId } })),

  fetchConnections: async () => set({ connections: await api.listConnections() }),

  connectQuick: async (args) => {
    const result = await api.connect(args);
    if (result.status === "connected" && result.info) {
      get().registerConnection(result.info);
      return { kind: "connected", info: result.info };
    }
    const v = result.verification!;
    if (policyGate(v) === "accept") {
      const info = await get().acceptQuick(args, v.fingerprint, false);
      return { kind: "connected", info };
    }
    return { kind: "host_key", verification: v };
  },

  acceptQuick: async (args, fingerprint, permanent) => {
    const info = await api.acceptHostKeyAndConnect({ ...args, fingerprint, permanent });
    get().registerConnection(info);
    return info;
  },

  connectVault: async (credentialId) => {
    const result = await api.vaultConnect(credentialId);
    if (result.status === "connected" && result.info) {
      get().registerConnection(result.info, credentialId);
      get().fetchCredentials();
      return { kind: "connected", info: result.info };
    }
    const v = result.verification!;
    if (policyGate(v) === "accept") {
      const info = await get().acceptVault(credentialId, v.fingerprint, false);
      return { kind: "connected", info };
    }
    return { kind: "host_key", verification: v };
  },

  acceptVault: async (credentialId, fingerprint, permanent) => {
    const info = await api.vaultAcceptHostKeyAndConnect({ credentialId, fingerprint, permanent });
    get().registerConnection(info, credentialId);
    get().fetchCredentials();
    return info;
  },

  disconnectFromServer: async (id) => {
    const conn = get().connections.find((c) => c.id === id);
    useTerminalStore.getState().clearTabsForSession(id);
    useFileStore.getState().forgetSession(id);
    set((s) => {
      const { [id]: _dropped, ...restCreds } = s.credentialIdBySession;
      const remaining = s.connections.filter((c) => c.id !== id);
      return {
        connections: remaining,
        activeSessionId: s.activeSessionId === id ? (remaining.at(-1)?.id ?? null) : s.activeSessionId,
        credentialIdBySession: restCreds,
      };
    });
    await api.disconnect(id).catch(() => {});
    if (conn) useActivityStore.getState().add({ type: "info", message: `Disconnected from ${conn.label}` });
  },

  fetchCredentials: async () => {
    try {
      set({ credentials: await api.vaultListCredentials(), vaultUnlocked: true });
    } catch {
      set({ credentials: [] });
    }
  },

  refreshVaultState: async () => {
    const unlocked = await api.vaultIsUnlocked().catch(() => false);
    set({ vaultUnlocked: unlocked });
    if (unlocked) await get().fetchCredentials();
    else set({ credentials: [] });
  },

  unlockVault: async (passphrase) => {
    await api.vaultUnlock(passphrase);
    set({ vaultUnlocked: true });
    await get().fetchCredentials();
  },

  createVault: async (passphrase) => {
    await api.vaultCreate(passphrase);
    set({ vaultUnlocked: true, credentials: [] });
  },

  lockVault: async () => {
    await api.vaultLock();
    set({ vaultUnlocked: false, credentials: [] });
  },
}));
