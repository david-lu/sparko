import { CircleHelp, X } from 'lucide-react';
import { useId } from 'react';

/** One reserved line for idle, progress, errors and recovery. Full messages live in a dismissible popover. */
export default function GenerationFeedback({ busy, message, messages, error, progress, onCancel }: {
  busy: boolean; message: string; messages: string[]; error: boolean; progress?: number; onCancel: () => void;
}) {
  const id = useId();
  return <div className="task-status inspector-generation-status" data-active="true" data-error={error}>
    <span className="status-icon" aria-hidden>{busy ? <span className="spinner" /> : <span className="inspector-status-dot" />}</span>
    <span className="task-status-message" role="status" title={message}>{message}</span>
    <button type="button" className="icon-button small" aria-label="Generation details" title="Generation details" popoverTarget={id}><CircleHelp size={13} /></button>
    <button type="button" className="icon-button small inspector-cancel" aria-label="Cancel interstitial generation" aria-hidden={!busy} disabled={!busy} onClick={onCancel}><X size={13} /></button>
    <progress aria-label="Generating interstitial" aria-hidden={!busy} max="1" value={busy ? progress : 0} />
    <div id={id} popover="auto" className="inspector-status-popover">
      <div><strong>Generation details</strong><button type="button" className="icon-button small" aria-label="Close generation details" popoverTarget={id} popoverTargetAction="hide"><X size={14} /></button></div>
      {messages.map((text, index) => <p key={index}>{text}</p>)}
    </div>
  </div>;
}
