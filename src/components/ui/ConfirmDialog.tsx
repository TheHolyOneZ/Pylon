import { createContext, useCallback, useContext, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { Button, Modal, ModalBody, ModalFooter } from "./primitives";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<{ options: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions | string) =>
      new Promise<boolean>((resolve) => {
        setDialog({ options: typeof options === "string" ? { message: options } : options, resolve });
      }),
    [],
  );

  const done = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  const o = dialog?.options;
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AnimatePresence>
        {o && (
          <Modal
            key="confirm"
            onClose={() => done(false)}
            width={420}
            icon={o.danger ? <AlertTriangle size={16} className="text-pylon-red" /> : <HelpCircle size={16} />}
            title={o.title ?? "Are you sure?"}
          >
            <ModalBody>
              <p className="text-[13px] leading-relaxed text-slate-300">{o.message}</p>
            </ModalBody>
            <ModalFooter>
              <Button variant="ghost" onClick={() => done(false)}>{o.cancelLabel ?? "Cancel"}</Button>
              <Button variant={o.danger ? "danger" : "primary"} onClick={() => done(true)} data-autofocus>
                {o.confirmLabel ?? "Confirm"}
              </Button>
            </ModalFooter>
          </Modal>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
