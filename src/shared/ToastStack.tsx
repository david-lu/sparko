import { CircleAlert, X } from 'lucide-react';
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { dismissToast, getToasts, subscribeToasts } from './toasts';
import './toasts.css';

export default function ToastStack() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts), stack = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = stack.current!;
    if (toasts.length) element.showPopover();
    else if (element.matches(':popover-open')) element.hidePopover();
  }, [toasts]);
  return createPortal(<div ref={stack} className="toast-stack" popover="manual" role="region" aria-label="Notifications">
    {toasts.map(toast => <div key={toast.id} className="error-toast" role="alert" aria-atomic="true">
      <CircleAlert size={17} aria-hidden/>
      <div className="toast-copy"><strong>{toast.title}</strong>{toast.source && <span className="toast-source" title={toast.source}>{toast.source}</span>}<p>{toast.message}</p></div>
      <button className="icon-button small" type="button" aria-label="Dismiss notification" onClick={() => dismissToast(toast.id)}><X size={15}/></button>
    </div>)}
  </div>, document.body);
}
