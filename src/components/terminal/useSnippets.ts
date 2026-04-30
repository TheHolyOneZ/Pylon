import { useEffect, useState } from "react";
import { Snippet } from "../../types";
import * as api from "../../lib/tauri";

export function useSnippets() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);

  useEffect(() => {
    api.listSnippets().then(setSnippets).catch(() => {});
  }, []);

  async function addSnippet(label: string, command: string, color?: string) {
    const s = await api.saveSnippet({ label, command, color });
    setSnippets((prev) => [...prev, s]);
  }

  async function removeSnippet(id: string) {
    await api.deleteSnippet(id);
    setSnippets((prev) => prev.filter((s) => s.id !== id));
  }

  return { snippets, addSnippet, removeSnippet };
}
