import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowPlayback } from '../../src/features/call-response/FlowPlayback';
import { createTestFlow, createTimelineExample, getScene, sceneFrames } from '../../src/features/call-response/model';
import { composeFlows } from '../../src/features/call-response/compose';
import type { PlaybackLayer } from '../../src/features/player/CanvasMediaDecks';
import { flowTransition } from '../../src/features/call-response/transitions';
import { createNode, edge, migrateGraph, runtimeFlow, splitClip, type StoryGraph } from '../../src/features/story-flow/model';
import { readFile } from 'node:fs/promises';
import { FADE_PRESETS, fadeLevel, fadeMix } from '../../shared/fade-curves';
import { projectFlows, type Project } from '../../src/features/project/types';

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
  it('keeps the tail audible through the last fractional frame of a source loop', () => {
    const graph: StoryGraph = { version: 1, entryId: 'loop', nodes: [{ id: 'loop', name: 'Loop', kind: 'source', loop: true, loopCount: 0, x: 0, y: 0,
      source: { assetId: 'mock:loop', duration: 1, inFrame: 0, outFrame: 24 } }], edges: [], templates: [] };
    const player = makePlayer(runtimeFlow(graph, [], 'mock:original', 20));
    player.seekScene('loop', 23, true); now += 20; tick(now);
    expect(player.session).toMatchObject({ frame: 23, loopIteration: 1 });
    expect(layers()).toHaveLength(2);
    expect(layers()[0]).toMatchObject({ muted: false, still: false });
    expect(layers()[0].time).toBeCloseTo(23 / 24 + .02);
    expect(layers()[0].gain + layers()[1].gain).toBeCloseTo(1);
    player.dispose();
  });
  it.each([
    { video: 12, audio: 4 }, { video: 4, audio: 12 },
    { video: 0, audio: 12 }, { video: 12, audio: 0 }, { video: 0, audio: 0 },
  ])('repeats a trimmed full render with independent video $video and audio $audio fades', ({ video, audio }) => {
    const { node, item } = createNode('looped');
    node.loopVideoCrossfade = video / 24; node.loopAudioCrossfade = audio / 24;
    node.trim = { inFrame: 24, outFrame: 72 };
    const saved = { ...item, phase: 'ready' as const, result: { assetId: 'mock:finished', url: 'blob:finished', start: 0, duration: 4, totalDuration: 4,
      fullAssetId: 'mock:full', fullRange: { start: 2, duration: 4, totalDuration: 8 } } };
    const graph: StoryGraph = { version: 1, entryId: node.id, nodes: [node], edges: [], templates: [] };
    const flow = runtimeFlow(graph, [saved], 'mock:original', 20); flow.scenes[0].volume = .4;
    const player = makePlayer(flow), overlap = Math.max(video, audio);
    for (const frame of [42, 46]) {
      player.seekScene(node.id, frame);
      const weight = (frames: number) => frames ? Math.max(0, (frame - 48 + frames) / frames) : 0;
      expect(layers()[0]).toMatchObject({ key: `${node.id}:0:body`, opacity: 1, gain: 1 - weight(audio),
        source: { assetId: 'mock:full', volume: .4 } });
      expect(layers()[0].time).toBeCloseTo(3 + frame / 24);
      if (overlap) {
        expect(layers()).toHaveLength(2);
        expect(layers()[1]).toMatchObject({ key: `${node.id}:1:body`, opacity: weight(video), gain: weight(audio),
          source: { assetId: 'mock:full', volume: .4 } });
        expect(layers()[1].time).toBeCloseTo(3 + (frame - 48 + overlap) / 24);
      } else expect(layers()).toHaveLength(1);
    }
    player.seekScene(node.id, 47, true); advance();
    expect(player.session).toMatchObject({ loopIteration: 2, frame: overlap });
    expect(layers()).toHaveLength(1);
    expect(layers()[0]).toMatchObject({ key: `${node.id}:1:body`, opacity: 1, gain: 1 });
    expect(layers()[0].time).toBeCloseTo(3 + (overlap + .2) / 24);
    player.seekScene(node.id, 47, true); player.setCrossfade(false); advance();
    expect(player.session).toMatchObject({ loopIteration: 2, frame: 0 });
    expect(layers()).toHaveLength(1);
    player.dispose();
  });
  it('skips repeat fades for drafts, the last counted visit and a queued exit', () => {
    const { node, item } = createNode('looped'), next = createNode('simple');
    node.loopCount = 2;
    const graph: StoryGraph = { version: 1, entryId: node.id, nodes: [node, next.node], edges: [{ ...edge(node.id, next.node.id), crossfade: 0 }], templates: [] };
    const saved = { ...item, phase: 'ready' as const, result: { assetId: 'mock:loop', url: 'blob:loop', start: 0, duration: 2, totalDuration: 2 } };
    const draft = makePlayer(runtimeFlow(graph, [item, next.item], 'mock:original', 20));
    draft.seekScene(node.id, 95, true); expect(layers()).toHaveLength(1); advance();
    expect(draft.session.frame).toBe(0); draft.dispose();
    const player = makePlayer(runtimeFlow(graph, [saved, next.item], 'mock:original', 20));
    player.seekScene(node.id, 47, true); advance();
    expect(player.session.loopIteration).toBe(2);
    for (let i = 0; i < 34; i++) advance();
    expect(player.session.frame).toBe(47); expect(layers()).toHaveLength(1);
    advance(); expect(player.session.sceneId).toBe(next.node.id);
    player.seekScene(node.id, 46);
    expect(layers()).toHaveLength(2);
    player.branch(node.id, `${node.id}:continue`); expect(layers()).toHaveLength(1);
    player.dispose();
  });
  it.each([0, .4, 1])('uses asset volume %s even when a saved loop has the retired mute flag', volume => {
    const { node, item } = createNode('looped');
    const saved = { ...item, loopAudio: false, phase: 'ready' as const,
      result: { assetId: 'mock:loop', url: 'blob:loop', start: 0, duration: 4, totalDuration: 4 } };
    const graph: StoryGraph = { version: 1, entryId: node.id, nodes: [node], edges: [], templates: [] };
    const flow = runtimeFlow(graph, [saved], 'mock:original', 20);
    flow.scenes[0].volume = volume;
    const player = makePlayer(flow); player.seekScene(node.id, 24);
    expect(layers()[0]).toMatchObject({ muted: false, source: { assetId: 'mock:loop', volume } });
    player.dispose();
  });
  it.each([
    { video: 1, audio: .5, frame: 126, opacity: .25, gain: 0, rate: 0 },
    { video: 1, audio: .5, frame: 138, opacity: .75, gain: .5, rate: 2 },
    { video: .5, audio: 1, frame: 126, opacity: 0, gain: .25, rate: 1 },
    { video: 0, audio: 1, frame: 138, opacity: 0, gain: .75, rate: 1 },
    { video: 1, audio: 0, frame: 138, opacity: .75, gain: 0, rate: 0 },
  ])('plays video=$video and audio=$audio independently at frame $frame', ({ video, audio, frame, opacity, gain, rate }) => {
    const a = createNode('simple'), b = createNode('simple');
    const items = [a,b].map(p => ({ ...p.item, phase: 'ready' as const,
      result: { assetId: `mock:${p.node.id}`, url: 'blob:generated', start: 2, duration: 6, totalDuration: 10 } }));
    const graph: StoryGraph = { version: 1, entryId: a.node.id, nodes: [a.node,b.node], templates: [],
      edges: [{ ...edge(a.node.id,b.node.id), videoCrossfade: video, audioCrossfade: audio }] };
    const player = makePlayer(runtimeFlow(graph, items, 'mock:original', 20));
    player.seekScene(a.node.id, frame);
    const before = layers().find(l => l.source.assetId === items[0].result.assetId)!;
    const after = layers().find(l => l.source.assetId === items[1].result.assetId)!;
    expect(after.opacity).toBeCloseTo(opacity);
    expect(after.gain).toBeCloseTo(gain); expect(after.gainRate).toBeCloseTo(rate);
    expect(before.gain).toBeCloseTo(1-gain);
    expect(after.time).toBeCloseTo(2+(frame-144)/24);
    expect(player.session.frame).toBe(frame);
    player.seekScene(b.node.id, 0);
    expect(layers()).toHaveLength(1); expect(layers()[0]).toMatchObject({ opacity: 1, gain: 1, time: 2 });
    player.dispose();
  });

  it('shapes each channel of a connection fade with its own curve', () => {
    const a = createNode('simple'), b = createNode('simple');
    const items = [a,b].map(p => ({ ...p.item, phase: 'ready' as const,
      result: { assetId: `mock:${p.node.id}`, url: 'blob:generated', start: 2, duration: 6, totalDuration: 10 } }));
    const [, slow, , sCurve] = FADE_PRESETS.map(preset => preset.curve);
    const graph: StoryGraph = { version: 1, entryId: a.node.id, nodes: [a.node,b.node], templates: [],
      edges: [{ ...edge(a.node.id,b.node.id), videoCrossfade: 1, audioCrossfade: 1, videoCrossfadeCurve: sCurve, audioCrossfadeCurve: slow }] };
    const player = makePlayer(runtimeFlow(graph, items, 'mock:original', 20));
    // The one-second fade finishes at the cut, so frame 126 is a quarter of the way through.
    for (const [frame, progress] of [[126, .25], [138, .75]]) {
      player.seekScene(a.node.id, frame);
      const before = layers().find(l => l.source.assetId === items[0].result.assetId)!;
      const after = layers().find(l => l.source.assetId === items[1].result.assetId)!;
      expect(after.opacity).toBeCloseTo(fadeMix(sCurve, progress));
      expect(after.gain).toBeCloseTo(fadeMix(slow, progress)); expect(before.gain).toBeCloseTo(1 - fadeMix(slow, progress));
      expect(after.gainRate).toBeCloseTo(fadeLevel(slow, progress, 1).rate); expect(before.gainRate).toBeCloseTo(-after.gainRate!);
    }
    expect(fadeMix(sCurve, .25)).toBeLessThan(.25); expect(fadeMix(slow, .75)).toBeLessThan(.75);
    player.dispose();
  });
  it('shapes repeat fades with the clip\'s loop curves', () => {
    const { node, item } = createNode('looped');
    const [, slow, fast] = FADE_PRESETS.map(preset => preset.curve);
    Object.assign(node, { loopVideoCrossfade: .5, loopAudioCrossfade: .5, loopVideoCrossfadeCurve: fast, loopAudioCrossfadeCurve: slow });
    const saved = { ...item, phase: 'ready' as const, result: { assetId: 'mock:finished', url: 'blob:finished', start: 0, duration: 4, totalDuration: 4 } };
    const player = makePlayer(runtimeFlow({ version: 1, entryId: node.id, nodes: [node], edges: [], templates: [] }, [saved], 'mock:original', 20));
    player.seekScene(node.id, 96 - 6);
    expect(layers()).toHaveLength(2);
    expect(layers()[1].opacity).toBeCloseTo(fadeMix(fast, .5)); expect(layers()[1].gain).toBeCloseTo(fadeMix(slow, .5));
    expect(layers()[0].gain + layers()[1].gain).toBeCloseTo(1);
    player.dispose();
  });

  it('supports an incoming video dissolve and an outgoing audio fade at the same time', () => {
    const a = createNode('simple'), c = createNode('simple');
    const items = [a,c].map(p => ({ ...p.item, phase: 'ready' as const,
      result: { assetId: `mock:${p.node.id}`, url: 'blob:generated', start: 2, duration: 6, totalDuration: 10 } }));
    const graph: StoryGraph = { version: 1, entryId: a.node.id, templates: [],
      nodes: [a.node, { id: 'middle', name: 'Middle', kind: 'source', x: 0, y: 0, loopCount: 0,
        source: { assetId: 'mock:original', duration: 20, inFrame: 240, outFrame: 264 } }, c.node],
      edges: [{ ...edge(a.node.id,'middle'), videoCrossfade: 1, audioCrossfade: 0 },
        { ...edge('middle',c.node.id), videoCrossfade: 0, audioCrossfade: 1 }] };
    const player = makePlayer(runtimeFlow(graph, items, 'mock:original', 20));
    player.seekScene('middle', 12);
    expect(layers()).toHaveLength(3);
    expect(layers().map(l => ({ opacity: l.opacity, gain: l.gain }))).toEqual([
      { opacity: 1, gain: 0 }, { opacity: .5, gain: .5 }, { opacity: 0, gain: .5 }]);
    expect(layers().map(l => l.time)).toEqual([8.5, 10.5, 1.5]);
    player.setCrossfade(false);
    expect(layers()).toHaveLength(1); expect(layers()[0]).toMatchObject({ opacity: 1, gain: 1, time: 10.5 });
    player.dispose();
  });

  it('viewer seeks retain the chosen route and playback state while allowing a new answer', () => {
    const player = makePlayer();
    player.seekScene('wait', sceneFrames(getScene(player.flow, 'wait')) - 1);
    player.branch('wait', 'correct'); advance();
    expect(player.session.sceneId).toBe('correct');
    player.seekScene('continue', 12, true, true);
    expect(player.session).toMatchObject({ sceneId: 'continue', frame: 12, playing: true, outcome: 'correct', traversedEdgeIds: ['wait-correct'] });
    player.seekScene('wait', 0, false, true);
    expect(player.session.outcome).toBeNull();
    player.branch('wait', 'incorrect'); expect(player.session.outcome).toBe('incorrect');
    player.seekScene('intro');
    expect(player.session).toMatchObject({ playing: false, outcome: null, traversedEdgeIds: [] });
    player.dispose();
  });
  it('matches every fade window and video timestamp in the original saved Sparko example',async()=>{
    const project=JSON.parse(await readFile('tests/fixtures/legacy-sample-project.json','utf8')) as Project;
    const flows=projectFlows(project),duration=Math.max(...flows.flatMap(f=>f.scenes.filter(s=>s.clip.kind==='video').map(s=>s.clip.outFrame)))/24;
    const legacy=composeFlows(flows,project.interstitials,project.source.assetId!,duration)!;
    const graph=runtimeFlow(migrateGraph(project,duration),project.interstitials,project.source.assetId!,duration);
    let checked=0;
    for(const link of legacy.edges){
      const old=flowTransition(legacy,link,14),nextLink=graph.edges.find(e=>e.id===link.id)??graph.edges.find(e=>link.from===link.to&&e.from===link.from&&e.when==='repeat')!;
      expect(nextLink,link.id).toBeDefined();const next=flowTransition(graph,nextLink);
      expect(next&&{start:next.startFrame,frames:next.frames},link.id).toEqual(old&&{start:old.startFrame,frames:old.frames});
      if(!old)continue;checked++;
      const snapshot=(flow:typeof legacy,edge:typeof link)=>{
        const player=makePlayer(flow);player.setCrossfade(true,14);
        if(old.startFrame<0){player.seekScene(edge.from,sceneFrames(getScene(flow,edge.from))-7);player.session.outcome=edge.when;player.session.outcomeQueuedFrame=0;}
        else {player.seekScene(edge.to,7);player.session.lastEdgeId=edge.id;}
        player.pause();const result=layers().map(l=>({asset:l.source.assetId,time:l.time,opacity:l.opacity}));player.dispose();return result;
      };
      const expected=snapshot(legacy,link),actual=snapshot(graph,nextLink);expect(actual,link.id).toHaveLength(2);
      actual.forEach((layer,i)=>{expect(layer.asset,link.id).toBe(expected[i].asset);expect(layer.time,link.id).toBeCloseTo(expected[i].time,8);expect(layer.opacity,link.id).toBeCloseTo(expected[i].opacity,8);});
    }
    expect(checked).toBe(12);
  });
  it('keeps fades for rewired and trimmed clips while respecting available footage',()=>{
    const a=createNode('simple'),b=createNode('simple'),items=[a,b].map(p=>({...p.item,phase:'ready' as const,result:{assetId:`mock:${p.node.id}`,url:'blob:generated',start:2,duration:6,totalDuration:10}}));
    items[1].result={...items[1].result,start:.125};
    const graph:StoryGraph={version:1,entryId:a.node.id,nodes:[a.node,b.node],edges:[{...edge(a.node.id,b.node.id),crossfade:1}],templates:[]};
    let flow=runtimeFlow(graph,items,'mock:original',20);expect(flowTransition(flow,flow.edges[0])).toMatchObject({startFrame:-3,frames:3});
    flow.scenes[1].generated!.reference={before:{sceneId:a.node.id,assetId:'wrong:asset',inFrame:48,outFrame:192}};
    expect(flowTransition(flow,flow.edges[0])).toMatchObject({startFrame:-3,frames:3});
    const player=makePlayer(flow);player.seekScene(a.node.id,143,true);expect(layers()).toHaveLength(2);expect(layers()[1].opacity).toBeCloseTo(2/3);advance();expect(player.session.sceneId).toBe(b.node.id);expect(layers()).toHaveLength(1);player.dispose();
    delete flow.scenes[1].generated!.reference;b.node.trim={inFrame:24,outFrame:144};flow=runtimeFlow(graph,items,'mock:original',20);
    expect(flowTransition(flow,flow.edges[0])).toMatchObject({startFrame:0,frames:24});
  });
  it('uses each imported source duration instead of clamping playback to the primary video',()=>{
    const graph:StoryGraph={version:1,entryId:'extra',nodes:[{id:'extra',name:'Extra video',kind:'source',source:{assetId:'mock:extra',duration:12,inFrame:0,outFrame:288},x:0,y:0,crossfadeStart:0,crossfadeEnd:0,loopCount:0}],edges:[],templates:[]};
    const player=makePlayer(runtimeFlow(graph,[],'mock:original',2));player.seekScene('extra',240);expect(layers()[0].time).toBe(10);expect(layers()[0].sourceFootage).toBe(false);expect(layers()[0].still).toBe(false);player.dispose();
  });
  it.each([false, true])('plays an imported exit fade with independent audio when references are mismatched: %s', mismatched => {
    const { node, item } = createNode('simple');
    item.phase = 'ready'; item.result = { assetId: 'mock:imported', url: 'blob:imported', start: 1.625, duration: 148/24, totalDuration: 226/24,
      reference: { mode: 'custom', ...(mismatched ? { after: { sceneId: 'old-parent', assetId: 'mock:old-parent', inFrame: 999, outFrame: 1100 } } : {}) } };
    const graph: StoryGraph = { version: 1, entryId: node.id, nodes: [node,
      { id: 'parent', name: 'Parent video', kind: 'source', x: 0, y: 0, loopCount: 0, source: { assetId: 'mock:original', duration: 10, inFrame: 48, outFrame: 240 } }],
      edges: [{ ...edge(node.id, 'parent'), videoCrossfade: 14/24, audioCrossfade: 21/24 }], templates: [] };
    const flow = runtimeFlow(graph, [item], 'mock:original', 10), player = makePlayer(flow);
    player.seekScene('parent', 7);
    expect(layers()).toHaveLength(2);
    expect(layers()[0].source.assetId).toBe('mock:imported');
    expect(layers()[0].time).toBeCloseTo(194/24);
    expect(layers()[0].gain).toBeCloseTo(2/3);
    expect(layers()[1]).toMatchObject({ opacity: .5, muted: false });
    expect(layers()[1].time).toBeCloseTo(55/24);
    expect(layers()[1].gain).toBeCloseTo(1/3);
    player.setCrossfade(false); expect(layers()).toHaveLength(1);
    player.dispose();
  });
  it('aligns graph entry fades with the reference prefix and seeks split generated media precisely',()=>{
    const a=createNode('simple'),b=createNode('simple');
    const items=[a,b].map(p=>({...p.item,phase:'ready' as const,result:{assetId:`mock:${p.node.id}`,url:'blob:generated',start:2,duration:6,totalDuration:10}}));
    const graph:StoryGraph={version:1,entryId:a.node.id,nodes:[a.node,b.node],edges:[{...edge(a.node.id,b.node.id),crossfade:.75}],templates:[]};
    const player=makePlayer(runtimeFlow(graph,items,'mock:original',20));player.seekScene(a.node.id,141);
    expect(layers()).toHaveLength(2);expect(layers()[1].opacity).toBeCloseTo(15/18);expect(layers()[1].time).toBeCloseTo(2-3/24);
    player.seekScene(b.node.id,0);expect(layers()).toHaveLength(1);expect(layers()[0].opacity).toBe(1);expect(layers()[0].time).toBe(2);
    const split=splitClip(graph,items,a.node.id,48);player.setFlow(runtimeFlow(split.graph,[...items,...split.items],'mock:original',20));player.seekScene(split.rightId!,0);
    expect(layers()).toHaveLength(1);expect(layers()[0].time).toBe(4);player.dispose();
  });
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
  it('fades video and audio from Idle into the chosen response', () => {
    const player = makePlayer(); player.seekScene('call', 94);
    expect(layers().map(layer => layer.key.split(':')[0])).toEqual(['call', 'wait']);
    expect(layers().map(layer => layer.gain)).toEqual([.5, .5]);
    expect(layers()[1]).toMatchObject({ time: 0, muted: false });
    player.seekScene('wait', 24);
    expect(layers()).toHaveLength(1); expect(layers()[0]).toMatchObject({ gain: 1, muted: false });
    player.seekScene('wait', 43); player.branch('wait', 'incorrect'); player.pause();
    expect(layers()).toHaveLength(1); expect(layers()[0].key).toMatch(/^wait:/);
    player.play(); advance(); advance();
    expect(player.session).toMatchObject({ sceneId: 'wait', outcome: 'incorrect' });
    expect(layers().map(layer => layer.key.split(':')[0])).toEqual(['wait', 'incorrect']);
    expect(layers()[0].gain).toBeGreaterThan(0); expect(layers()[1].gain).toBe(0);
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
    expect(layers()[1]).toMatchObject({ source: { id: 'mock:idle-full' }, muted: false });
    expect(layers()[1].time).toBeCloseTo(2 - 2 / 24);
    player.seekScene('wait', 0);
    expect(layers()).toHaveLength(1);
    expect(layers()[0]).toMatchObject({ source: { id: 'mock:idle-full' }, time: 2, muted: false });
    player.seekScene('wait', 47, true); advance();
    expect(player.session.loopIteration).toBe(2);
    expect(layers()).toHaveLength(1);
    expect(layers()[0].source.id).toBe('mock:idle-full');
    player.seekScene('wait', 46); player.branch('wait', 'correct'); player.pause();
    expect(layers()).toHaveLength(2);
    expect(layers()[0]).toMatchObject({ key: 'wait:0:body', source: { id: 'mock:idle-full' }, muted: false });
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
  it('plays original Idle audio regardless of the retired loop audio toggle', () => {
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
    expect(layers()[0]).toMatchObject({ source: { id: 'mock:idle-full' }, muted: false });
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
    response.generated.reference!.before!.assetId = 'mock:other-idle';
    expect(flowTransition(flow, edge, 12)).toMatchObject({ startFrame: -3, frames: 3 });
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
  it('caps connection fades while keeping the Idle repeat overlap independent', () => {
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
    expect(flowTransition(flow, retry)).toMatchObject({ startFrame: -14, frames: 14 });
    const player = makePlayer(flow); player.setCrossfade(true, 48);
    for (let frame = 0; frame < sceneFrames(getScene(flow, 'wait')); frame++) {
      player.seekScene('wait', frame);
      const weight = Math.max(0, (frame - 42) / 6);
      expect(layers()).toHaveLength(frame < 42 ? 1 : 2);
      expect(layers()[0]).toMatchObject({ opacity: 1, gain: 1 - weight, muted: false });
      if (frame >= 42) expect(layers()[1]).toMatchObject({ opacity: weight, gain: weight, muted: false });
    }
    player.seekScene('call', 20); expect(layers()).toHaveLength(1);
    player.seekScene('correct', 60); expect(layers()).toHaveLength(1);
    player.dispose();
  });
  it('retains the incoming loop deck and freezes fades while either deck buffers', () => {
    const player = makePlayer(); player.seekScene('wait', 47, true); advance();
    expect(player.session).toMatchObject({ sceneId: 'wait', loopIteration: 2, frame: 6 });
    expect(layers()).toHaveLength(1);
    expect(layers()[0]).toMatchObject({ gain: 1, muted: false });
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
