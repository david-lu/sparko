import { describe, expect, it } from 'vitest';
import { createCallResponseDraft } from '../../src/features/call-response/draft';
import { composeFlows } from '../../src/features/call-response/compose';
import { advanceSession, answerSession, flowLayout, getScene, interstitialScenes, playbackPath, previewScene, resolveFlow, sceneFrames, startSession } from '../../src/features/call-response/model';
import { clipDependency } from '../../src/features/call-response/dependencies';
import { referenceTiming } from '../../src/features/call-response/generation';
import type { Interstitial } from '../../shared/interstitials';

const pin = (id = 'pin', time = 5): Interstitial => ({ id, label: id, time, kind: 'call-response', method: 'comfy', phase: 'draft',
  start_range: 2, end_range: 2, duration: 6, prompt: '', enable_prompt_expansion: false });
const ready = (item: Interstitial): Interstitial => ({ ...item, phase: 'ready',
  result: { url: `asset:${item.id}`, assetId: item.id, start: 0, duration: item.duration, totalDuration: item.duration } });
describe('call-response drafts', () => {
  it('creates real drafts with Comfy extension, short loop and bridge profiles', () => {
    const { flow, interstitials } = createCallResponseDraft(pin(), 'source', 20);
    expect(interstitials.map(item => item.method)).toEqual(['comfy-extend', 'comfy-loop', 'comfy', 'comfy']);
    expect(interstitials.map(item => item.duration)).toEqual([6, 2, 6, 6]);
    expect(flow.interaction.answers.map(answer => answer.label)).toEqual(['A', 'B']);
    expect(flow.interaction.answers.every(answer => answer.values.length === 0)).toBe(true);
    expect(interstitials.every(item => item.phase === 'draft' && !item.result && item.prompt && item.continuity)).toBe(true);
    expect(getScene(flow, 'continue').clip).toMatchObject({ inFrame: 120, outFrame: 480 });
    expect(sceneFrames(getScene(flow, 'wait'))).toBe(48);
    expect(clipDependency(flow, interstitials, 'call').reference).toMatchObject({ mode: 'extend', before: { inFrame: 0, outFrame: 120 } });
    expect(clipDependency(flow, interstitials, 'wait').blocked).toBe('Generate Call first.');
    const idle = clipDependency(flow, interstitials, 'wait').reference!;
    expect(idle.mode).toBe('loop'); expect(idle.after).toEqual(idle.before);
    expect(referenceTiming(interstitials[1], idle).after).toBe(48);
    expect(() => createCallResponseDraft(pin('early', .5), 'source', 20)).toThrow('1.625');
  });
  it('uses accepted output for both downstream references and draft previews', () => {
    const { flow, interstitials } = createCallResponseDraft(pin(), 'source', 20);
    interstitials[0] = { ...interstitials[0], phase: 'ready', result: { url: 'asset:call', assetId: 'call', start: 2, duration: 6, totalDuration: 8 } };
    const resolved = resolveFlow(flow, interstitials);
    expect(getScene(resolved, 'call').draft).toBe(false);
    expect(getScene(resolved, 'wait').clip).toMatchObject({ assetId: 'call', inFrame: 191, outFrame: 192 });
    expect(clipDependency(flow, interstitials, 'wait')).toMatchObject({ blocked: undefined, reference: { before: { assetId: 'call' }, after: { assetId: 'call' } } });
  });
  it('composes multiple pins and regular clips with independent answers and unabridged source footage', () => {
    const a = createCallResponseDraft(pin('a', 5), 'source', 20), b = createCallResponseDraft(pin('b', 12), 'source', 20);
    b.flow.interaction.fallbackAnswerId = 'incorrect';
    const regular = { ...pin('regular', 9), kind: 'regular' as const };
    const flow = composeFlows([a.flow, b.flow], [pin('a', 5), pin('b', 12), regular, ...a.interstitials.map(ready), ...b.interstitials.map(ready)], 'source', 20)!;
    expect(flow.groups).toHaveLength(2);
    expect(new Set(flow.scenes.map(scene => scene.id)).size).toBe(flow.scenes.length);
    const sources = flow.scenes.filter(scene => scene.id.startsWith('source:'));
    expect(sources.reduce((sum, scene) => sum + sceneFrames(scene), 0)).toBe(480);
    expect(flow.scenes.some(scene => scene.interstitialId === 'regular')).toBe(true);
    expect(answerSession(flow, previewScene(flow, 'a/wait'), 'unknown').outcome).toBeNull();
    expect(answerSession(flow, previewScene(flow, 'b/wait'), 'unknown').outcome).toBe('b/incorrect');
    expect(answerSession(flow, previewScene(flow, 'a/wait'), 'A').outcome).toBe('a/correct');
    expect(flow.edges.every(edge => flow.scenes.some(scene => scene.id === edge.to) && flow.scenes.some(scene => scene.id === edge.from))).toBe(true);
  });
  it.each([false, true])('shows only finished stages with no draft time or dangling connections (parent pin: %s)', parentPin => {
    const draft = createCallResponseDraft(pin(), 'source', 20);
    for (const completed of [['call'], ['call', 'wait'], ['call', 'wait', 'incorrect'], ['correct']]) {
      const items = draft.interstitials.map(item => completed.some(id => item.id === `pin:${id}`) ? ready(item) : item);
      const flow = composeFlows([draft.flow], [...(parentPin ? [pin()] : []), ...items], 'source', 20)!;
      const layout = flowLayout(flow);
      expect(interstitialScenes(flow).map(scene => scene.localId ?? scene.id)).toEqual(completed);
      expect(flow.scenes.some(scene => scene.draft)).toBe(false);
      expect(layout.totalFrames).toBe(480 + completed.reduce((sum, id) => sum + (id === 'wait' ? 48 : 144), 0));
      expect(flow.edges.every(edge => flow.scenes.some(scene => scene.id === edge.from) && flow.scenes.some(scene => scene.id === edge.to))).toBe(true);
      expect(playbackPath(flow, startSession(flow))).toEqual(flow.scenes.map(scene => scene.id));
      const continuation = flow.scenes.at(-1)!;
      expect(layout.starts[continuation.id]).toBe(120 + layout.totalFrames - 480);
      expect(flow.interaction.answers.map(answer => answer.sceneId.split('/').at(-1))).toEqual(completed.filter(id => !['call', 'wait'].includes(id)));
      if (!completed.includes('wait')) {
        expect(advanceSession(flow, startSession(flow, true), layout.totalFrames)).toMatchObject({ sceneId: continuation.id, finished: true });
      } else if (completed.includes('incorrect')) {
        const waiting = flow.scenes.find(scene => scene.clip.kind === 'idle')!;
        const answered = answerSession(flow, { ...previewScene(flow, waiting.id), playing: true }, 'B');
        expect(advanceSession(flow, answered, 48).sceneId).toBe(flow.interaction.answers[0].sceneId);
        expect(answerSession(flow, previewScene(flow, waiting.id), 'A').outcome).toBeNull();
      }
    }
    expect(draft.flow.scenes.filter(scene => scene.draft)).toHaveLength(4);
  });
});
