import { interstitialScenes, type CallResponseFlow } from './model';

export type GenerationSequence = {
  ids: string[];
  completedIds: string[];
  activeId?: string;
  phase: 'running' | 'cancelling' | 'cancelled' | 'error' | 'ready';
  message?: string;
};

export const sequenceActive = (sequence: GenerationSequence | null) => sequence?.phase === 'running' || sequence?.phase === 'cancelling';

/** Generation order is independent of playback branches and retry connections. */
export function generationOrder(flow: CallResponseFlow) {
  const members = interstitialScenes(flow);
  const rank = (id: string) => id === 'intro' ? 0 : id === 'call' ? 1 : id === 'wait' ? 2 : id === 'continue' ? 4 : 3;
  return members.filter(scene => scene.interstitialId).sort((a, b) => rank(a.id) - rank(b.id)).map(scene => scene.interstitialId!);
}

/** Text and settings edits can continue; a different clip structure needs a new sequence. */
export function sequenceStructure(flow?: CallResponseFlow) {
  return flow && JSON.stringify([flow.interstitial.id, flow.interstitial.time, flow.scenes.map(scene =>
    [scene.id, scene.interstitialId, scene.clip.kind, ...(scene.clip.kind === 'video' ? [scene.clip.assetId, scene.clip.inFrame, scene.clip.outFrame] : [])])]);
}
