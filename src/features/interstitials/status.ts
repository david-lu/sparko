import { generationProvider, type Interstitial } from '../../../shared/interstitials';
import { estimateComfyProgress } from '../../../shared/comfy-progress';

const isComfyJob = (item: Interstitial) => generationProvider(item.requestMethod ?? item.generationSettings?.method ?? item.method) === 'comfy';
export const renderingProgress = (item: Interstitial) => isComfyJob(item) ? estimateComfyProgress(item.progressDetails) : item.progress;
function renderingLabel(item: Interstitial) {
  const progress = renderingProgress(item);
  const steps = item.progressDetails?.step === undefined || !item.progressDetails.steps ? '' : ` · step ${item.progressDetails.step}/${item.progressDetails.steps}`;
  return `${item.progressDetails?.stage || 'Generating scene'}${steps}${progress === undefined ? '' : ` · ${Math.round(progress * 100)}%${isComfyJob(item) ? ' estimated overall' : ' overall'}`}`;
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
