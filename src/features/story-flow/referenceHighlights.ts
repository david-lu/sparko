import { TIMELINE_FPS } from '../../../shared/constants';
import { isGenerating, playableResult, type GenerationReference, type Interstitial } from '../../../shared/interstitials';
import { referenceClips, referenceWindow } from '../../../shared/reference-clips';
import type { CallResponseFlow } from '../call-response/model';
import { sceneMediaRange } from './mediaRange';
import type { nodeMediaLayout, StoryNode } from './model';
import { storyGenerationItem } from './referenceInputs';

type ReferenceSelection = { item: Interstitial; node?: StoryNode; reference?: GenerationReference };
export type ReferenceHighlight = {
  generationId: string; label: string; side: 'start' | 'end'; held: boolean;
  start: number; end: number; mediaStart: number; mediaEnd: number;
};

/** Completed clips describe their saved render; drafts describe the next generation. */
function windows({ item, node, reference }: ReferenceSelection) {
  const result = playableResult(item), pending = !result && isGenerating(item) && item.requestReference;
  const input = result ? result.reference : pending || reference;
  const settings = result ? result.metadata?.settings ?? item.generationSettings
    : pending ? item.generationSettings ?? item : storyGenerationItem(item, node);
  const range = result && (result.fullAssetId
    ? result.fullRange ?? (result === item.result ? item.requestInsertion : undefined) ?? result.metadata?.media
    : result);
  const mode = input?.mode ?? result?.metadata?.references.mode;
  const clips = (side: 'before' | 'after') => {
    const local = referenceClips(input, side);
    return local.length ? local : referenceClips(result?.metadata?.references, side);
  };
  return (['before', 'after'] as const).flatMap(side => {
    const frames = range ? Math.round((side === 'before' ? range.start : Math.max(0, range.totalDuration - range.start - range.duration)) * TIMELINE_FPS)
      : settings ? Math.ceil((side === 'before' || mode === 'loop' ? settings.start_range : settings.end_range) * TIMELINE_FPS) : Infinity;
    if (frames <= 0 || side === 'after' && mode === 'extend') return [];
    const held = side === 'after' && (mode === 'loop' || mode === 'bridge' && !clips('after').length);
    const last = held && (clips('before').at(-1) ?? clips('after').at(-1));
    const selected = held ? last ? [{ ...last, inFrame: last.outFrame - 1 }] : [] : referenceWindow(clips(side), frames, side);
    return selected.map(clip => ({ clip, held, side: side === 'before' ? 'start' as const : 'end' as const }));
  });
}

/** Project source-media windows onto the visible filmstrips, including generated handles. */
export function referenceHighlights(flow: CallResponseFlow, selections: ReferenceSelection[], layouts: Record<string, ReturnType<typeof nodeMediaLayout>>, aliases: Record<string, string> = {}) {
  const highlights: Record<string, ReferenceHighlight[]> = {};
  for (const selection of selections) for (const { clip, side, held } of windows(selection)) {
    const assetId = aliases[clip.assetId] ?? clip.assetId;
    const result = playableResult(selection.item);
    const saved = referenceClips(result?.metadata?.references, side === 'start' ? 'before' : 'after')
      .find(ref => (aliases[ref.assetId] ?? ref.assetId) === assetId);
    const candidates = flow.scenes.filter(scene => !scene.draft && scene.interstitialId !== selection.item.id && (
      scene.clip.assetId === assetId || sceneMediaRange(scene, flow.fps).assetId === assetId
      || !!saved?.renderId && scene.generated?.metadata?.id === saved.renderId));
    const original = candidates.find(scene => scene.id === clip.sceneId);
    for (const scene of original ? [original] : candidates) {
      const layout = layouts[scene.id]; if (!layout?.total) continue;
      const media = sceneMediaRange(scene, flow.fps), visibleStart = media.start - layout.before;
      // A loop's playable file and full render use different time origins.
      const offset = assetId === scene.clip.assetId ? media.start - scene.clip.inFrame / flow.fps : 0;
      const start = Math.max(0, clip.inFrame / TIMELINE_FPS + offset - visibleStart);
      const end = Math.min(layout.total, clip.outFrame / TIMELINE_FPS + offset - visibleStart);
      if (end <= start) continue;
      (highlights[scene.id] ??= []).push({ generationId: selection.item.id, label: selection.item.label, side, held,
        start, end, mediaStart: visibleStart + start, mediaEnd: visibleStart + end });
    }
  }
  return highlights;
}
