import { useCallback, useRef, useState } from "react";
import { OverwriteAction } from "../components/modals/OverwriteModal";
import { useFileStore } from "../stores/fileStore";

export interface ConflictModalState {
  open: boolean;
  conflicts: string[];
}

export type PreflightResult =
  | { proceed: false }
  | { proceed: true; skipPaths: Set<string> };

export function useOverwriteDecision() {
  const [modalState, setModalState] = useState<ConflictModalState>({ open: false, conflicts: [] });
  const resolveRef = useRef<((action: OverwriteAction) => void) | null>(null);

  const showModal = useCallback((conflicts: string[]): Promise<OverwriteAction> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setModalState({ open: true, conflicts });
    });
  }, []);

  const handleChoice = useCallback((action: OverwriteAction) => {
    setModalState({ open: false, conflicts: [] });
    resolveRef.current?.(action);
    resolveRef.current = null;
  }, []);

  const preflightCheck = useCallback(async (
    items: { name: string; destPath: string }[],
    checkExists: (path: string) => Promise<boolean>,
  ): Promise<PreflightResult> => {
    const { overwritePolicy, setOverwritePolicy } = useFileStore.getState();

    if (overwritePolicy === "overwrite_all") return { proceed: true, skipPaths: new Set() };

    const checked = await Promise.all(
      items.map(async (i) => ({ ...i, exists: await checkExists(i.destPath) })),
    );
    const conflicting = checked.filter((i) => i.exists);

    if (conflicting.length === 0) return { proceed: true, skipPaths: new Set() };

    if (overwritePolicy === "skip_all") {
      return { proceed: true, skipPaths: new Set(conflicting.map((i) => i.destPath)) };
    }

    const action = await showModal(conflicting.map((i) => i.name));
    if (action === "cancel") return { proceed: false };

    if (action === "overwrite") {
      setOverwritePolicy("overwrite_all");
      return { proceed: true, skipPaths: new Set() };
    }

    setOverwritePolicy("skip_all");
    return { proceed: true, skipPaths: new Set(conflicting.map((i) => i.destPath)) };
  }, [showModal]);

  return { modalState, handleChoice, preflightCheck };
}
