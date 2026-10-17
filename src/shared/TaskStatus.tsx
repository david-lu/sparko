import { X } from 'lucide-react';

// Keep the same space through every phase, including when the task is idle.
export default function TaskStatus({ active, message, cancelLabel, onCancel, progress }: {
  active: boolean; message: string; cancelLabel: string; onCancel: () => void;
  progress?: { label: string; value?: number; title?: string };
}) {
  return <div className="task-status" data-active={active} aria-hidden={!active} role={active ? 'status' : undefined}>
    <span className="spinner" /><span className="task-status-message" title={message}>{message}</span>
    <button type="button" className="icon-button small" aria-label={cancelLabel} disabled={!active} onClick={onCancel}><X size={13} /></button>
    {active && progress && <progress aria-label={progress.label} title={progress.title} max="1" value={progress.value} />}
  </div>;
}
