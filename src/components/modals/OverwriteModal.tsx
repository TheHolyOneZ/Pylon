import { useState } from "react";
import { Copy } from "lucide-react";
import { Button, Modal, ModalBody, ModalFooter } from "../ui/primitives";
import type { OverwriteAction } from "../../stores/uiStore";

export type { OverwriteAction };

interface Props {
  conflicts: string[];
  onChoice: (r: { action: OverwriteAction; remember: boolean }) => void;
}

export function OverwriteModal({ conflicts, onChoice }: Props) {
  const [remember, setRemember] = useState(false);
  const n = conflicts.length;
  return (
    <Modal
      onClose={() => onChoice({ action: "cancel", remember: false })}
      width={460}
      icon={<Copy size={16} className="text-pylon-amber" />}
      title={n === 1 ? `“${conflicts[0]}” already exists` : `${n} items already exist`}
      subtitle="Choose what to do with files that are already at the destination."
    >
      {n > 1 && (
        <ModalBody className="max-h-48 py-3">
          <ul className="space-y-0.5">
            {conflicts.slice(0, 50).map((name) => (
              <li key={name} className="truncate rounded px-2 py-1 font-mono text-xs text-slate-300 odd:bg-void-900/60">{name}</li>
            ))}
            {n > 50 && <li className="px-2 py-1 text-xs text-slate-500">…and {n - 50} more</li>}
          </ul>
        </ModalBody>
      )}
      <ModalFooter className="justify-between">
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Don't ask again this session
        </label>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => onChoice({ action: "cancel", remember: false })}>Cancel</Button>
          <Button onClick={() => onChoice({ action: "skip", remember })}>Skip</Button>
          <Button variant="primary" onClick={() => onChoice({ action: "overwrite", remember })} data-autofocus>Replace</Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
