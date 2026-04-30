import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SavedServer {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  authType: "password" | "key" | "agent";
  keyPath?: string;

  savedPassword?: string;

  timeout?: number | null;
  lastConnected?: string;
}

interface ServerStore {
  servers: SavedServer[];
  save: (s: SavedServer) => void;
  remove: (id: string) => void;
  touch: (id: string) => void;
}

export const useServerStore = create<ServerStore>()(
  persist(
    (set) => ({
      servers: [],
      save: (s) =>
        set((state) => ({
          servers: [
            ...state.servers.filter((x) => x.id !== s.id),
            s,
          ],
        })),
      remove: (id) =>
        set((state) => ({ servers: state.servers.filter((x) => x.id !== id) })),
      touch: (id) =>
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === id ? { ...s, lastConnected: new Date().toISOString() } : s
          ),
        })),
    }),
    { name: "pylon-servers" }
  )
);
