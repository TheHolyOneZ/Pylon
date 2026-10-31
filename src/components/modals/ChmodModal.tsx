import { useState } from "react";
import { Lock } from "lucide-react";
import { Button, Input, Modal, ModalBody, ModalFooter } from "../ui/primitives";
import { formatPermissions } from "../../lib/format";

interface Props {
  path: string;
  currentPerm: number;
  onApply: (mode: number) => void;
  onClose: () => void;
}

const WHO = [["Owner", 6], ["Group", 3], ["Others", 0]] as const;
const WHAT = [["Read", 4], ["Write", 2], ["Execute", 1]] as const;

export function ChmodModal({ path, currentPerm, onApply, onClose }: Props) {
  const [mode, setMode] = useState(currentPerm & 0o7777);
  const [text, setText] = useState((currentPerm & 0o777).toString(8).padStart(3, "0"));
  const set = (m: number) => { setMode(m); setText((m & 0o777).toString(8).padStart(3, "0")); };
  const name = path.split("/").pop() || path;

  return (
    <Modal onClose={onClose} width={420} icon={<Lock size={16} />} title="Permissions" subtitle={<span className="font-mono">{name}</span>}>
      <ModalBody className="space-y-4">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-xs text-slate-500">
              <th className="pb-2 text-left font-medium" />
              {WHAT.map(([w]) => <th key={w} className="pb-2 font-medium">{w}</th>)}
            </tr>
          </thead>
          <tbody>
            {WHO.map(([who, shift]) => (
              <tr key={who} className="border-t border-void-600">
                <td className="py-2 text-slate-300">{who}</td>
                {WHAT.map(([w, bit]) => {
                  const mask = bit << shift;
                  return (
                    <td key={w} className="py-2 text-center">
                      <input type="checkbox" checked={(mode & mask) !== 0} onChange={(e) => set(e.target.checked ? mode | mask : mode & ~mask)} className="h-4 w-4" />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">Octal</span>
          <Input
            mono
            value={text}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-7]/g, "").slice(0, 4);
              setText(v);
              if (v.length >= 3) setMode((mode & ~0o777) | (parseInt(v, 8) & 0o7777));
            }}
            className="w-20"
          />
          <span className="font-mono text-xs text-slate-400">{formatPermissions(mode)}</span>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => { onApply(mode); onClose(); }} disabled={text.length < 3}>Apply</Button>
      </ModalFooter>
    </Modal>
  );
}
