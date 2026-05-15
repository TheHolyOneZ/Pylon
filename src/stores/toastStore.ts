import { create } from "zustand";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration: number;
}

interface ToastStore {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

let counter = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  push: (toast) => {
    const id = `toast-${++counter}-${Date.now()}`;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    if (toast.duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, toast.duration);
    }
    return id;
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  dismissAll: () => set({ toasts: [] }),
}));

export const toast = {
  success: (title: string, message?: string) =>
    useToastStore.getState().push({ type: "success", title, message, duration: 3500 }),
  error: (title: string, message?: string) =>
    useToastStore.getState().push({ type: "error", title, message, duration: 6000 }),
  info: (title: string, message?: string) =>
    useToastStore.getState().push({ type: "info", title, message, duration: 4000 }),
  warning: (title: string, message?: string) =>
    useToastStore.getState().push({ type: "warning", title, message, duration: 5000 }),
  persistent: (title: string, message?: string) =>
    useToastStore.getState().push({ type: "info", title, message, duration: 0 }),
};
