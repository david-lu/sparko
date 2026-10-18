import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowPlayback } from '../../src/features/call-response/FlowPlayback';
import { createTestFlow, createTimelineExample, getScene, sceneFrames } from '../../src/features/call-response/model';
import { composeFlows } from '../../src/features/call-response/compose';
import type { PlaybackLayer } from '../../src/features/player/CanvasMediaDecks';
import { flowTransition } from '../../src/features/call-response/transitions';

afterEach(() => vi.unstubAllGlobals());
const render = vi.hoisted(() => vi.fn((_layers: PlaybackLayer[], _playing: boolean) => true));
vi.mock('../../src/features/project/assets', () => ({ assets: { url: (id: string) => `blob:${id}` } }));

vi.mock('../../src/features/player/CanvasMediaDecks', () => ({ CanvasMediaDecks: class {
  private last = performance.now();
  constructor(public video: HTMLVideoElement) {}
  elapsed() { const current = performance.now(), elapsed = (current - this.last) / 1000; this.last = current; return elapsed; }
  setMatchFraming() {}
  render(layers: PlaybackLayer[], playing: boolean) { return render(layers, playing); }
  prepare() {} prepareMedia() {} setSubtitles() {} pause() {} dispose() {}
} }));

let now = 0, tick: FrameRequestCallback;
beforeEach(() => {
  render.mockReset().mockReturnValue(true); now = 0;
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { tick = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
const advance = () => { now += 50; tick(now); };
const layers = () => render.mock.calls.at(-1)![0] as PlaybackLayer[];
const flowWithReferences = () => {
  const flow = createTestFlow();
  for (const scene of flow.scenes.filter(scene => scene.clip.kind !== 'video')) {
    const duration = sceneFrames(scene) / flow.fps, start = scene.clip.kind === 'idle' ? 0 : 2;
    scene.generated = { url: `blob:${scene.id}`, start, duration, totalDuration: start + duration + (scene.clip.kind === 'response' ? 1 : 0) };
    scene.clip.inFrame = start * flow.fps; scene.clip.outFrame = (start + duration) * flow.fps;
  }
  return flow;
};
const makePlayer = (flow = flowWithReferences()) => new FlowPlayback(flow, { volume: 1, muted: false, playbackRate: 1, currentTime: 0, play: vi.fn(), pause: vi.fn() } as unknown as HTMLVideoElement,
  { id: 'original', assetId: 'mock:original', name: 'Original', url: 'blob:source' }, vi.fn());

describe('canvas flow playback', () => {
  it('keeps scene time and seeking independent of MediaSource support', async () => {
    vi.stubGlobal('MediaSource', undefined);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    class Video extends EventTarget {
      src = 'blob:source'; readyState = 2; loop = false; private position = 0;
      get currentTime() { return this.position; }
      set currentTime(value: number) { this.position = value; queueMicrotask(() => this.dispatchEvent(new Event('seeked'))); }
      play = vi.fn(async () => undefined);
      pause = vi.fn(); load = vi.fn();
    }
    const video = new Video(), changed = vi.fn();
    const player = new FlowPlayback(createTestFlow(), video as unknown as HTMLVideoElement,
      { id: 'original', assetId: 'mock:original', name: 'Original', url: 'blob:source' }, changed);
    player.play(); expect(player.session.playing).toBe(true);
    player.seekScene('intro', 12); await Promise.resolve();
    expect(layers()[0].time).toBe(.5); expect(player.sourceTime).toBe(.5);
    expect(player.session).toMatchObject({ sceneId: 'intro', frame: 12, playing: false });
    expect(changed.mock.calls.at(-1)?.[1]).toBe(false);
    player.dispose();
  });
  it.each([['intro', 70, 'intro', 'call'], ['continue', 2, 'correct', 'continue']] as const)(
    'blends only reference footage during %s without changing scene duration', (id, frame, before, after) => {
      const player = makePlayer(); player.seekScene(id, frame);
      expect(layers().map(layer => layer.key.split(':')[0])).toEqual([before, after]);
      expect(layers().map(layer => layer.opacity)).toEqual([1, .5]);
      expect(layers().map(layer => layer.gain)).toEqual([.5, .5]);
      expect(player.session).toMatchObject({ sceneId: id, frame, playing: false });
      player.dispose();
    });
  it('finishes the entry fade before the first generated frame and retains the prepared deck', () => {
    const player = makePlayer(); player.seekScene('intro', 71, true);
    const key = layers()[1].key;
    advance();
    expect(player.session.sceneId).toBe('call');
    expect(layers().map(layer => layer.key)).toEqual([key]);
    expect(layers()[0].gain).toBe(1);
    const session = { ...player.session };
    player.setCrossfade(false);
    expect(layers()).toHaveLength(1); expect(layers()[0].gain).toBe(1);
    player.setCrossfade(true);
    expect(layers()).toHaveLength(1); expect(player.session).toEqual(session);
    player.dispose();
  });
  it('fades into the chosen response entirely within silent Idle', () => {
    const player = makePlayer(); player.seekScene('call', 94);
    expect(layers().map(layer => layer.key.split(':')[0])).toEqual(['call', 'wait']);
    expect(layers().map(layer => layer.gain)).toEqual([.5, 0]);
    expect(layers()[1]).toMatchObject({ time: 0, muted: true });
    player.seekScene('wait', 24);
    expect(layers()).toHaveLength(1); expect(layers()[0]).toMatchObject({ gain: 0, muted: true });
    player.seekScene('wait', 43); player.branch('wait', 'incorrect'); player.pause();
    expect(layers()).toHaveLength(1); expect(layers()[0].key).toMatch(/^wait:/);
    player.play(); advance(); advance();
    expect(player.session).toMatchObject({ sceneId: 'wait', outcome: 'incorrect' });
    expect(layers().map(layer => layer.key.split(':')[0])).toEqual(['wait', 'incorrect']);
    expect(layers()[0].gain).toBe(0); expect(layers()[1].gain).toBe(0);
    expect(layers()[1].opacity).toBeGreaterThan(0);
    expect(layers()[1].time).toBeLessThan(2);
    for (let i = 0; i < 4; i++) advance();
    expect(player.session).toMatchObject({ sceneId: 'incorrect', outcome: 'incorrect' });
    expect(layers()).toHaveLength(1);
    expect(layers()[0]).toMatchObject({ muted: false, opacity: 1, gain: 1 });
    expect(layers()[0].time).toBeGreaterThanOrEqual(2);
    player.dispose();
  });
  it('starts a late answer fade when the answer is chosen and holds an opening frame without lead-in', () => {
    const flow = flowWithReferences(), response = getScene(flow, 'incorrect');
    response.generated = { ...response.generated!, start: 0 };
    const player = makePlayer(flow); player.seekScene('wait', 46);
    player.branch('wait', 'incorrect');
    expect(layers().map(layer => layer.key.split(':')[0])).toEqual(['wait', 'incorrect']);
    expect(layers()[1]).toMatchObject({ opacity: 0, time: 0, muted: true });
    advance();
    expect(player.session).toMatchObject({ sceneId: 'wait', frame: 47 });
    expect(layers()[1]).toMatchObject({ time: 0, muted: true });
    expect(layers()[1].opacity).toBeGreaterThan(0);
    advance();
    expect(player.session.sceneId).toBe('incorrect');
    expect(layers()).toHaveLength(1);
    expect(layers()[0]).toMatchObject({ opacity: 1, gain: 1, muted: false });
    player.dispose();
  });
  it('changes fade length in place for both automatic cuts and responses, retaining it when toggled', () => {
    const player = makePlayer(); player.seekScene('intro', 66);
    expect(layers()).toHaveLength(1);
    const session = { ...player.session };
    player.setCrossfade(true, 12);
    expect(layers().map(layer => layer.gain)).toEqual([.5, .5]);
    expect(player.session).toEqual(session);
    player.setCrossfade(false); player.setCrossfade(true);
    expect(layers().map(layer => layer.gain)).toEqual([.5, .5]);
    player.seekScene('continue', 3);
    expect(layers().map(layer => layer.gain)).toEqual([.75, .25]);
    player.seekScene('wait', 47); player.branch('wait', 'incorrect'); player.pause();
    expect(layers().map(layer => layer.key.split(':')[0])).toEqual(['wait', 'incorrect']);
    expect(layers()[1].opacity).toBe(0);
    player.dispose();
  });
  it('caps long fades while keeping the silent Idle cycle free of fades', () => {
    const flow = flowWithReferences();
    const incoming = flowTransition(flow, flow.edges.find(edge => edge.id === 'wait-correct')!, 48)!;
    const callToIdle = flowTransition(flow, flow.edges.find(edge => edge.id === 'call-wait')!, 48)!;
    const outgoing = flowTransition(flow, flow.edges.find(edge => edge.id === 'correct-continue')!, 48)!;
    expect(callToIdle).toMatchObject({ startFrame: -48, frames: 48 });
    expect(incoming).toMatchObject({ startFrame: -48, frames: 48 });
    expect(outgoing).toMatchObject({ startFrame: 0, frames: 24 });
    expect(flowTransition(flow, flow.edges.find(edge => edge.id === 'wait-loop')!, 48)).toBeUndefined();
    const retry = flow.edges.find(edge => edge.id === 'incorrect-continue')!;
    retry.to = 'wait';
    expect(flowTransition(flow, retry)).toMatchObject({ startFrame: -4, frames: 4 });
    const player = makePlayer(flow); player.setCrossfade(true, 48);
    for (let frame = 0; frame < sceneFrames(getScene(flow, 'wait')); frame++) {
      player.seekScene('wait', frame);
      expect(layers()).toHaveLength(1);
      expect(layers()[0]).toMatchObject({ opacity: 1, gain: 0, muted: true });
    }
    player.seekScene('call', 20); expect(layers()).toHaveLength(1);
    player.seekScene('correct', 60); expect(layers()).toHaveLength(1);
    player.dispose();
  });
  it('does not fade Idle repeats or advance a fade while either deck buffers', () => {
    const player = makePlayer(); player.seekScene('wait', 47, true); advance();
    expect(player.session).toMatchObject({ sceneId: 'wait', loopIteration: 2 });
    expect(layers()).toHaveLength(1);
    expect(layers()[0]).toMatchObject({ gain: 0, muted: true });
    player.seekScene('intro', 68, true); render.mockReturnValue(false); player.play();
    const frame = player.session.frame; advance(); advance();
    expect(player.session.frame).toBe(frame); expect(layers()).toHaveLength(2);
    render.mockReturnValue(true); advance(); advance();
    expect(player.session.frame).toBeGreaterThan(frame);
    player.dispose();
  });
  it('restores saved bounds for a partial project and skips a missing return reference', () => {
    const { flow, interstitials } = createTimelineExample('mock:original', 8);
    const items = interstitials.map(item => item.id === getScene(flow, 'call').interstitialId ? item : { ...item, phase: 'draft' as const, result: undefined });
    const call = items.find(item => item.id === getScene(flow, 'call').interstitialId)!;
    call.result = { ...call.result!, start: 2, duration: 4, totalDuration: 6 };
    call.start_range = 4; call.end_range = 4;
    const partial = composeFlows([flow], items, 'mock:original', 8)!;
    const player = makePlayer(partial);
    player.seekScene('call', sceneFrames(getScene(partial, 'call')) - 1);
    expect(layers().map(layer => layer.key.split(':')[0])).toEqual(['call']);
    expect(getScene(partial, 'call').generated).toEqual(call.result);
    expect(flowTransition(partial, partial.edges.find(edge => edge.from === 'call')!, 48)).toBeUndefined();
    expect(partial.scenes.map(scene => scene.id)).toEqual(['intro', 'call', 'continue']);
    player.dispose();
  });
});
