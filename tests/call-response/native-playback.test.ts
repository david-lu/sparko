import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowPlayback } from '../../src/features/call-response/FlowPlayback';
import { createTestFlow, createTimelineExample, getScene, sceneFrames } from '../../src/features/call-response/model';
import { composeFlows } from '../../src/features/call-response/compose';
import type { PlaybackLayer } from '../../src/features/player/CanvasMediaDecks';
import { flowTransition } from '../../src/features/call-response/transitions';

afterEach(() => vi.unstubAllGlobals());
const render = vi.hoisted(() => vi.fn((_layers: PlaybackLayer[], _playing: boolean, _settings?: unknown, _musicGain?: number) => true));
vi.mock('../../src/features/project/assets', () => ({ assets: { url: (id: string) => `blob:${id}` } }));

vi.mock('../../src/features/player/CanvasMediaDecks', () => ({ CanvasMediaDecks: class {
  private last = performance.now();
  constructor(public video: HTMLVideoElement) {}
  elapsed() { const current = performance.now(), elapsed = (current - this.last) / 1000; this.last = current; return elapsed; }
  setMatchFraming() {}
  render(layers: PlaybackLayer[], playing: boolean, settings: unknown, musicGain?: number) { return render(layers, playing, settings, musicGain); }
  prepareMusic() {}
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
  { id: 'original', assetId: 'mock:original', name: 'Original', url: 'blob:source' }, vi.fn(), undefined, false, true, 4);

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
  it('keeps the soundtrack active across Idle repeats and fades it at scene boundaries', () => {
    const player = makePlayer();
    player.seekScene('call', 94);
    expect(render.mock.calls.at(-1)?.[3]).toBeCloseTo(.5);
    player.seekScene('wait', 24, true);
    expect(render.mock.calls.at(-1)?.[3]).toBe(1);
    for (let i = 0; i < 25; i++) advance();
    expect(player.session.loopIteration).toBeGreaterThan(1);
    expect(render.mock.calls.at(-1)?.[3]).toBe(1);
    player.pause();
    player.seekScene('wait', 46);
    player.branch('wait', 'correct');
    advance();
    expect(render.mock.calls.at(-1)?.[3]).toBeGreaterThan(0);
    expect(render.mock.calls.at(-1)?.[3]).toBeLessThan(1);
    player.seekScene('correct', 0);
    expect(render.mock.calls.at(-1)?.[3]).toBe(0);
    player.dispose();
  });
  it('aligns the saved Idle body and Response prefix at their fade', () => {
    const flow = flowWithReferences(), idle = getScene(flow, 'wait');
    idle.generated = { ...idle.generated!, fullAssetId: 'mock:idle-full',
      fullRange: { start: 2, duration: 2, totalDuration: 6 } };
    expect(flowTransition(flow, flow.edges.find(edge => edge.id === 'call-wait')!, 4)).toMatchObject({ startFrame: -4, frames: 4 });
    expect(flowTransition(flow, flow.edges.find(edge => edge.id === 'wait-correct')!, 4)).toMatchObject({ startFrame: -4, frames: 4 });
    const player = makePlayer(flow);
    player.seekScene('call', 94);
    expect(layers()[1]).toMatchObject({ source: { id: 'mock:idle-full' }, muted: true });
    expect(layers()[1].time).toBeCloseTo(2 - 2 / 24);
    player.seekScene('wait', 0);
    expect(layers()).toHaveLength(1);
    expect(layers()[0]).toMatchObject({ source: { id: 'mock:idle-full' }, time: 2, muted: true });
    player.seekScene('wait', 47, true); advance();
    expect(player.session.loopIteration).toBe(2);
    expect(layers()).toHaveLength(1);
    expect(layers()[0].source.id).toBe('mock:idle-full');
    player.seekScene('wait', 46); player.branch('wait', 'correct'); player.pause();
    expect(layers()).toHaveLength(2);
    expect(layers()[0]).toMatchObject({ key: 'wait:0:body', source: { id: 'mock:idle-full' }, muted: true });
    expect(layers()[0].time).toBeCloseTo(2 + 2 - 2 / 24);
    expect(layers()[1].source.id).toBe('mock:correct');
    expect(layers()[1].time).toBeCloseTo(2 - 2 / 24);
    player.play(); advance();
    expect(player.session.sceneId).toBe('wait');
    expect(layers()[1].opacity).toBeGreaterThan(0);
    expect(layers()[1].opacity).toBeLessThan(1);
    advance();
    expect(player.session).toMatchObject({ sceneId: 'correct', frame: 0 });
    expect(layers()).toHaveLength(1);
    expect(layers()[0].time).toBeGreaterThanOrEqual(2);
    expect(layers()[0].time).toBeLessThan(2 + 1 / 24);
    player.dispose();
  });
  it('keeps the Idle to Response fade when the Response used the full Idle asset', () => {
    const flow = flowWithReferences(), idle = getScene(flow, 'wait'), response = getScene(flow, 'correct');
    idle.generated = { ...idle.generated!, fullAssetId: 'mock:idle-full',
      fullRange: { start: 2, duration: 2, totalDuration: 6 } };
    response.generated = { ...response.generated!, reference: { before: {
      sceneId: idle.id, assetId: 'mock:idle-full', inFrame: 48, outFrame: 96,
    } } };
    expect(flowTransition(flow, flow.edges.find(edge => edge.id === 'wait-correct')!, 4)).toMatchObject({ startFrame: -4, frames: 4 });
    const player = makePlayer(flow);
    player.seekScene('wait', 46); player.branch('wait', 'correct'); player.pause();
    expect(layers().map(layer => layer.source.id)).toEqual(['mock:idle-full', 'mock:correct']);
    player.dispose();
  });
  it('plays the original Idle audio with its video only when enabled', () => {
    const flow = flowWithReferences(), idle = getScene(flow, 'wait');
    idle.generated = { ...idle.generated!, fullAssetId: 'mock:idle-full',
      fullRange: { start: 2, duration: 2, totalDuration: 6 } };
    idle.loopAudio = true;
    const player = makePlayer(flow);
    player.seekScene('call', 94, true);
    expect(layers()[1]).toMatchObject({ key: 'wait:1:reference', muted: false, source: { id: 'mock:idle-full' } });
    advance(); advance();
    expect(player.session.sceneId).toBe('wait');
    expect(layers()[0].key).toBe('wait:1:body');
    expect(layers()[0].source.id).toBe('mock:idle-full');
    player.seekScene('wait', 24);
    expect(layers()).toHaveLength(1);
    expect(layers()[0]).toMatchObject({ key: 'wait:0:body', source: { id: 'mock:idle-full' }, muted: false, time: 3 });
    expect(layers()[0].audio).toBeUndefined();
    player.seekScene('wait', 46); player.branch('wait', 'correct'); player.pause();
    expect(layers()[0]).toMatchObject({ source: { id: 'mock:idle-full' }, muted: false });
    expect(layers()[0].time).toBeCloseTo(4 - 2 / 24);
    player.seekScene('wait', 24);
    const session = { ...player.session };
    idle.loopAudio = false; player.setFlow({ ...flow, scenes: [...flow.scenes] });
    expect(player.session).toEqual(session);
    expect(layers()[0]).toMatchObject({ source: { id: 'mock:idle-full' }, muted: true });
    expect(layers()[0].audio).toBeUndefined();
    player.dispose();
  });
  it('does not fade into a Response with no saved prefix range', () => {
    const flow = flowWithReferences(), response = getScene(flow, 'incorrect');
    response.generated = { ...response.generated!, start: 0 };
    const player = makePlayer(flow); player.seekScene('wait', 46);
    player.branch('wait', 'incorrect');
    expect(flowTransition(flow, flow.edges.find(edge => edge.id === 'wait-incorrect')!)).toBeUndefined();
    expect(layers()).toHaveLength(1);
    advance();
    expect(player.session).toMatchObject({ sceneId: 'wait', frame: 47 });
    expect(layers()).toHaveLength(1);
    advance();
    expect(player.session.sceneId).toBe('incorrect');
    expect(layers()).toHaveLength(1);
    expect(layers()[0]).toMatchObject({ opacity: 1, gain: 1, muted: false });
    player.dispose();
  });
  it('caps an Idle to Response fade by that Response generation’s saved prefix', () => {
    const flow = flowWithReferences(), idle = getScene(flow, 'wait'), response = getScene(flow, 'correct');
    idle.generated = { ...idle.generated!, fullAssetId: 'mock:idle-full',
      fullRange: { start: 2, duration: 2, totalDuration: 8 } };
    response.generated = { ...response.generated!, start: 3 / 24,
      reference: { before: { sceneId: idle.id, assetId: idle.clip.assetId, inFrame: idle.clip.inFrame, outFrame: idle.clip.outFrame } } };
    const edge = flow.edges.find(edge => edge.id === 'wait-correct')!;
    expect(flowTransition(flow, edge, 12)).toMatchObject({ startFrame: -3, frames: 3 });
    const player = makePlayer(flow); player.setCrossfade(true, 12);
    player.seekScene('wait', 44); player.branch('wait', 'correct'); player.pause();
    expect(layers()).toHaveLength(1);
    player.seekScene('wait', 45); player.branch('wait', 'correct'); player.pause();
    expect(layers()).toHaveLength(2);
    expect(layers()[0]).toMatchObject({ key: 'wait:0:body', source: { id: 'mock:idle-full' } });
    expect(layers()[0].time).toBeCloseTo(2 + 45 / 24);
    expect(layers()[1]).toMatchObject({ source: { id: 'mock:correct' }, time: 0 });
    response.generated.reference!.before.assetId = 'mock:other-idle';
    expect(flowTransition(flow, edge, 12)).toBeUndefined();
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
    expect(flowTransition(flow, retry)).toMatchObject({ startFrame: -12, frames: 12 });
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
  it('restores saved bounds for a partial project and retains its draft slots', () => {
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
    expect(partial.scenes.map(scene => scene.id)).toEqual(['intro', 'call', 'wait', 'correct', 'incorrect', 'continue']);
    expect(partial.scenes.filter(scene => scene.draft).map(scene => scene.id)).toEqual(['wait', 'correct', 'incorrect']);
    player.dispose();
  });
});
