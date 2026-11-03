import type { Interstitial } from '../../../shared/interstitials';
import { comfyStepProgress } from '../../../shared/comfy-progress';

export const renderingProgress = (item: Interstitial) => comfyStepProgress(item.progressDetails);
function renderingLabel(item: Interstitial) {
  const progress = renderingProgress(item);
  const steps = progress === undefined ? '' : ` · step ${item.progressDetails!.step}/${item.progressDetails!.steps}`;
  // Keep the percentage visible when a narrow inspector truncates the stage text.
  return `${progress === undefined ? '' : `${Math.round(progress * 100)}% of stage · `}${item.progressDetails?.stage || 'Generating scene'}${steps}`;
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
