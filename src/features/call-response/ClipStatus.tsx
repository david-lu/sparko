import { Ban, CircleX, Clock3, FilePenLine, Film, LoaderCircle, TriangleAlert } from 'lucide-react';
import { isGenerating, playableResult, type Interstitial } from '../../../shared/interstitials';
import { phaseLabel } from '../interstitials/status';

export type ClipStatus = {
  kind: 'draft' | 'waiting' | 'generating' | 'failed' | 'stale' | 'cancelled' | 'video';
  label: string;
  detail: string;
};

export function clipStatus(item?: Interstitial, { waiting = false, stale = false }: { waiting?: boolean; stale?: boolean } = {}): ClipStatus {
  if (item && isGenerating(item)) return item.phase === 'queued'
    ? { kind: 'waiting', label: 'Queued', detail: phaseLabel(item) }
    : { kind: 'generating', label: 'Generating', detail: phaseLabel(item) };
  if (waiting) return { kind: 'waiting', label: 'Waiting', detail: 'Waiting in sequence' };
  if (item?.phase === 'error') return { kind: 'failed', label: 'Failed', detail: `${item.error || 'Generation failed'}${playableResult(item)?.assetId ? ' Previous video remains available.' : ''}` };
  if (stale) return { kind: 'stale', label: 'Stale', detail: 'Upstream video changed. Regenerate this clip.' };
  if (item?.phase === 'cancelled') return { kind: 'cancelled', label: 'Cancelled', detail: 'Generation cancelled' };
  if (item && playableResult(item)?.assetId) return { kind: 'video', label: 'Video ready', detail: 'Generated video available' };
  if (item?.phase === 'ready') return { kind: 'failed', label: 'Missing', detail: 'The generated video is unavailable.' };
  return { kind: 'draft', label: 'Draft', detail: 'No video generated yet' };
}

export function ClipStatusBadge({ status }: { status: ClipStatus }) {
  const Icon = {
    draft: FilePenLine, waiting: Clock3, generating: LoaderCircle, failed: CircleX,
    stale: TriangleAlert, cancelled: Ban, video: Film,
  }[status.kind];
  return <span className="clip-status-badge" data-status={status.kind} title={status.detail} aria-label={`Status: ${status.label}`}>
    <Icon size={12} aria-hidden="true" /><span>{status.label}</span>
  </span>;
}
