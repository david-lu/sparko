import type { Interstitial } from '../../../shared/interstitials';
import { estimateComfyProgress } from '../../../shared/comfy-progress';

function renderProgress(item: Interstitial) {
  const estimated = estimateComfyProgress(item.progressDetails);
  if (estimated !== undefined) return { value: estimated, label: 'estimated overall' };
  // Cloud can stream only value/nodes_done/nodes_total, without a stage or steps.
  // Show that snapshot as reported workflow progress, never as a time estimate.
  if (item.progress !== undefined && Number.isFinite(item.progress) && item.progress >= 0 && item.progress <= 1) {
    return { value: Math.min(.99, item.progress), label: 'reported by Comfy' };
  }
}
export const renderingProgress = (item: Interstitial) => renderProgress(item)?.value;
function renderingLabel(item: Interstitial) {
  const progress = renderProgress(item);
  const steps = item.progressDetails?.step === undefined || !item.progressDetails.steps ? '' : ` · step ${item.progressDetails.step}/${item.progressDetails.steps}`;
  // Keep the percentage visible when a narrow inspector truncates the stage text.
  return `${progress === undefined ? '' : `${Math.round(progress.value * 100)}% ${progress.label} · `}${item.progressDetails?.stage || 'Generating scene'}${steps}`;
}

export const phaseLabel = (item: Interstitial) => ({
  draft: 'Draft',
  preparing: `Preparing reference${item.progress === undefined ? '' : ` · ${Math.round(item.progress * 100)}%`}`,
  uploading: 'Uploading reference and submitting',
  queued: item.queuePosition === undefined ? 'Queued' : `Queued · position ${item.queuePosition + 1}`,
  rendering: renderingLabel(item),
  loading: `${item.progressDetails?.stage || 'Loading generated video'}${item.progress === undefined ? '' : ` · ${Math.round(item.progress * 100)}%`}`,
  ready: 'Ready',
  error: 'Needs attention',
  cancelled: 'Cancelled',
}[item.phase]);
