import { interstitialSettings, type InterstitialResult } from '../../../shared/interstitials';
import type { Project } from './types';

const resultContent = (result: InterstitialResult | undefined) => result && {
  ...result, url: result.assetId ? `asset:${result.assetId}` : result.url,
};
const stableJson = (content: unknown) => JSON.stringify(content, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);

/** Compare document metadata exactly, without hashing or rereading immutable media blobs. */
export function projectContent(project: Project, target: 'file' | 'browser' = 'file'): string {
  const content = { ...project, updatedAt: undefined,
    source: { ...project.source, url: project.source.assetId ? undefined : project.source.url },
    interstitials: project.interstitials.map(item => {
      const result = resultContent(item.result), previousResult = resultContent(item.previousResult);
      const revalidating = target === 'file' && item.phase === 'loading' && !!result?.assetId;
      return {
        ...item, ...interstitialSettings(item), interpolateMiddle: undefined, maskTransitionMs: undefined,
        imageReferences: item.imageReferences?.length ? item.imageReferences : undefined,
        keyframes: item.keyframes?.length ? item.keyframes : undefined,
        generationSettings: item.generationSettings && interstitialSettings(item.generationSettings),
        progress: undefined, progressDetails: undefined, queuePosition: undefined,
        // Reopening a stored render checks playback without changing the document.
        // Browser recovery still persists every phase transition, including validation finishing.
        phase: revalidating ? 'ready' : item.phase,
        result,
        // Revalidation retains the same render for playback until checking finishes.
        previousResult: revalidating && stableJson(previousResult) === stableJson(result) ? undefined : previousResult,
      };
    }),
  };
  return stableJson(content);
}
