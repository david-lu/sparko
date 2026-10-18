import type { InterstitialResult } from '../../../shared/interstitials';

export function referenceSections(result: InterstitialResult) {
  const range = result.fullAssetId && result.fullRange ? result.fullRange : result;
  return {
    before: Math.max(0, range.start),
    after: Math.max(0, range.totalDuration - range.start - range.duration),
    total: range.totalDuration,
  };
}
