import type { Interstitial } from '../../../shared/interstitials';

export const phaseLabel = (item: Interstitial) => ({
  draft: 'Draft',
  preparing: `Preparing reference${item.progress === undefined ? '' : ` · ${Math.round(item.progress * 100)}%`}`,
  uploading: 'Uploading reference',
  queued: item.queuePosition === undefined ? 'Queued' : `Queued · position ${item.queuePosition + 1}`,
  rendering: `${item.progressDetails?.stage || 'Generating scene'}${item.progressDetails?.step === undefined || !item.progressDetails.steps ? '' : ` · step ${item.progressDetails.step}/${item.progressDetails.steps}`}${item.progress === undefined ? '' : ` · ${Math.round(item.progress * 100)}%`}`,
  loading: 'Loading generated video',
  ready: 'Ready',
  error: 'Needs attention',
  cancelled: 'Cancelled',
}[item.phase]);
