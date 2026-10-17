import { describe, expect, it, vi } from 'vitest';
import { FlowBufferPlan } from '../../src/features/call-response/FlowBufferPlan';
import { PreparedSceneBuffers } from '../../src/features/call-response/PreparedSceneBuffers';
import { answerSession, createTestFlow, getScene, previewScene, startSession, type TimelineScene } from '../../src/features/call-response/model';

describe('branch buffer planning', () => {
  it('replaces only future idle visits when an answer arrives, keeping its current loop and exact frame', () => {
    const flow = createTestFlow(), plan = new FlowBufferPlan(flow, startSession(flow));
    for (let i = 0; i < 5; i++) plan.append();
    expect(plan.visits.map(visit => visit.state.sceneId)).toEqual(['intro', 'call', 'wait', 'wait', 'wait', 'wait']);
    const frame = 72 + 96 + 48 + 17, current = plan.at(frame, true);
    expect(current).toMatchObject({ sceneId: 'wait', frame: 17, loopIteration: 2 });
    const cut = plan.choose(frame, answerSession(flow, current, '4'));
    expect(cut).toBe(72 + 96 + 48 * 2);
    expect(plan.at(frame, true)).toMatchObject({ sceneId: 'wait', frame: 17, outcome: 'correct' });
    expect(plan.append()?.state).toMatchObject({ sceneId: 'correct', frame: 0, lastEdgeId: 'wait-correct' });
    expect(plan.at(cut - 1, true).sceneId).toBe('wait');
    expect(plan.at(cut, true)).toMatchObject({ sceneId: 'correct', frame: 0 });
  });
  it('maps partial seeks, retries, terminal playback and bounded visit retention', () => {
    const flow = createTestFlow(); flow.edges.find(edge => edge.id === 'incorrect-continue')!.to = 'wait';
    const state = { ...previewScene(flow, 'wait'), frame: 21 }, plan = new FlowBufferPlan(flow, state);
    expect(plan.at(0, false)).toMatchObject({ sceneId: 'wait', frame: 21, playing: false });
    expect(plan.visits[0].endFrame).toBe(27);
    plan.choose(0, answerSession(flow, state, 'wrong')); plan.append(); plan.append();
    expect(plan.visits.at(-1)?.state).toMatchObject({ sceneId: 'wait', outcome: null, attempts: 1 });
    const retryAt = plan.visits.at(-1)!.startFrame;
    plan.choose(retryAt, answerSession(flow, plan.at(retryAt, true), 'four')); plan.append(); plan.append();
    expect(plan.append()).toBeUndefined();
    expect(plan.at(plan.visits.at(-1)!.endFrame, true)).toMatchObject({ finished: true, playing: false });
    plan.prune(retryAt); expect(plan.visits[0].state.sceneId).toBe('wait');
  });
  it('retains an already committed idle cycle for a late answer and branches at the next undecided boundary', () => {
    const flow = createTestFlow(), plan = new FlowBufferPlan(flow, previewScene(flow, 'wait'));
    plan.append(); plan.append();
    const current = plan.at(47, true);
    const cut = plan.choose(47, answerSession(flow, current, '4'), 96);
    expect(cut).toBe(96);
    expect(plan.at(48, true)).toMatchObject({ sceneId: 'wait', loopIteration: 2, outcome: 'correct' });
    plan.append(); expect(plan.at(96, true)).toMatchObject({ sceneId: 'correct', frame: 0 });
  });
});

describe('prepared response cache', () => {
  it('deduplicates loop media, limits concurrent renders, and prioritizes the chosen response', async () => {
    const flow = createTestFlow(), finish: Array<() => void> = [];
    const render = vi.fn<(scene: TimelineScene, first: number, count: number, signal: AbortSignal) => Promise<Uint8Array>>(() => new Promise<Uint8Array>(resolve => finish.push(() => resolve(new Uint8Array(8)))));
    const cache = new PreparedSceneBuffers(24, render);
    const idle = cache.get(getScene(flow, 'wait'), 0), repeated = cache.get(getScene(flow, 'wait'), 0);
    const call = cache.get(getScene(flow, 'call'), 0, 10);
    const unchosen = cache.get(getScene(flow, 'incorrect'), 0, 10), chosen = cache.get(getScene(flow, 'correct'), 0, 10);
    cache.get(getScene(flow, 'correct'), 0, 0);
    expect(idle).toBe(repeated); expect(render).toHaveBeenCalledTimes(2);
    finish[0](); await idle;
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(3));
    expect(render.mock.calls[2][0].id).toBe('correct');
    finish[1](); finish[2](); await Promise.all([call, chosen]);
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(4));
    finish[3](); await unchosen;
    expect(cache.ready(getScene(flow, 'wait'))).toBe(true); cache.dispose();
  });
  it('evicts old prepared bytes and aborts pending preparation on disposal', async () => {
    const flow = createTestFlow(), render = vi.fn(async () => new Uint8Array(8));
    const cache = new PreparedSceneBuffers(24, render, 8);
    await cache.get(getScene(flow, 'wait'), 0); await cache.get(getScene(flow, 'correct'), 0);
    expect(cache.statistics.bytes).toBe(8); expect(cache.ready(getScene(flow, 'wait'))).toBe(false);
    expect(cache.ready(getScene(flow, 'correct'))).toBe(true); cache.dispose();
    await expect(cache.get(getScene(flow, 'wait'), 0)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('cancels active renders and rejects queued branches without starting them', async () => {
    const flow = createTestFlow();
    const render = vi.fn<(scene: TimelineScene, first: number, count: number, signal: AbortSignal) => Promise<Uint8Array>>(
      (_scene, _first, _count, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    );
    const cache = new PreparedSceneBuffers(24, render);
    const pending = [cache.get(getScene(flow, 'wait'), 0), cache.get(getScene(flow, 'correct'), 0), cache.get(getScene(flow, 'incorrect'), 0)];
    cache.dispose();
    const settled = await Promise.allSettled(pending);
    expect(settled.every(result => result.status === 'rejected' && result.reason.name === 'AbortError')).toBe(true);
    expect(render).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(cache.statistics.active).toBe(0));
  });
});
