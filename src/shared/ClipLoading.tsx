import { ImageOff } from 'lucide-react';
import './clip-loading.css';

export default function ClipLoading({ message = 'Loading clip…', failed = false }: { message?: string; failed?: boolean }) {
  return <span className={`clip-loading${failed ? ' failed' : ''}`} role="status" aria-label={message}>
    {failed ? <ImageOff size={14} aria-hidden="true" /> : <span className="spinner" aria-hidden="true" />}
    <span className="clip-loading-label" aria-hidden="true">{message}</span>
  </span>;
}

export function ClipJobStatus({ label, message }: { label: string; message: string }) {
  return <span className="clip-job-status" role="status" aria-label={`${label}: ${message}`} title={message}>
    <span className="spinner timeline-generation-spinner" aria-hidden="true" />
    <span aria-hidden="true">{message}</span>
  </span>;
}
