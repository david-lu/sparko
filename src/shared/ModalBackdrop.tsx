import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** The top layer keeps dialogs above every editor surface, also in fullscreen. */
export default function ModalBackdrop({ labelledBy, onCancel, restoreFocus, children }: {
  labelledBy: string; onCancel?: () => void; restoreFocus?: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const focus = useRef(restoreFocus); focus.current = restoreFocus;
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); focus.current?.(); };
  }, []);
  return <dialog ref={dialog} className="modal-backdrop" aria-labelledby={labelledBy}
    onCancel={event => { event.preventDefault(); onCancel?.(); }}>{children}</dialog>;
}
