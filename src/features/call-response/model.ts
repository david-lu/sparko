import { playableResult, type CallResponseInterstitial, type Interstitial } from '../../../shared/interstitials';
/** Clip types and connections shared by the project, timeline and video player. */
export type SceneId = 'intro' | 'call' | 'wait' | 'correct' | 'incorrect' | 'continue';
export type Outcome = 'correct' | 'incorrect';
type ClipMedia = { id: string; assetId: string; inFrame: number; outFrame: number };
export type VideoClip = ClipMedia & { kind: 'video' };
export type CallClip = ClipMedia & { kind: 'call' };
export type IdleClip = ClipMedia & { kind: 'idle'; repeat: 'until-answer'; exitAt: 'loop-boundary' };
export type ResponseClip = ClipMedia & { kind: 'response'; outcome: Outcome };
export type TimelineClip = VideoClip | CallClip | IdleClip | ResponseClip;
export type TimelineScene = {
  id: SceneId;
  label: string;
  role: 'source' | 'call' | 'wait' | 'response';
  dialogue: string;
  clip: TimelineClip;
  interstitialId?: string;
};
export type FlowEdge = {
  id: string;
  from: SceneId;
  to: SceneId;
  when: 'ended' | 'pending' | Outcome;
  label: string;
  transitionFrames: number;
};
export type CallResponseFlow = {
  version: 1;
  interstitial: CallResponseInterstitial;
  fps: number;
  entrySceneId: SceneId;
  scenes: TimelineScene[];
  edges: FlowEdge[];
  interaction: { question: string; acceptedAnswers: string[]; waitSceneId: SceneId };
};

/** Older examples had separate child jobs but no saved parent interstitial. */
export function groupCallResponse(flow: Omit<CallResponseFlow, 'interstitial'> & { interstitial?: CallResponseInterstitial }): CallResponseFlow {
  const intro = flow.scenes.find(scene => scene.id === 'intro');
  return { ...flow, interstitial: {
    id: flow.interstitial?.id ?? crypto.randomUUID(), kind: 'call-response',
    label: flow.interstitial?.label ?? 'Call Response Interstitial', time: flow.interstitial?.time ?? (intro ? (intro.clip.outFrame - intro.clip.inFrame) / flow.fps : 0),
    clipIds: flow.scenes.filter(scene => scene.clip.kind !== 'video').map(scene => scene.clip.id),
  } };
}
export const clipTypeLabel = (clip: TimelineClip) => clip.kind === 'video' ? '' : clip.kind === 'response'
  ? `${clip.outcome === 'correct' ? 'Correct' : 'Incorrect'} Response` : clip.kind === 'idle' ? 'Idle' : 'Call';
export const interstitialScenes = (flow: CallResponseFlow) => flow.scenes.filter(scene => flow.interstitial.clipIds.includes(scene.clip.id));

export function createTestFlow(): CallResponseFlow {
  const scene = (id: SceneId, label: string, role: TimelineScene['role'], dialogue: string, frames: number, assetId = `mock:${id}`, inFrame = 0): TimelineScene =>
    ({ id, label, role, dialogue, clip: { id: `clip:${id}`, assetId, inFrame, outFrame: inFrame + frames,
      ...(role === 'source' ? { kind: 'video' as const } : role === 'call' ? { kind: 'call' as const }
        : role === 'wait' ? { kind: 'idle' as const, repeat: 'until-answer' as const, exitAt: 'loop-boundary' as const }
        : { kind: 'response' as const, outcome: id === 'correct' ? 'correct' as const : 'incorrect' as const }) } });
  return groupCallResponse({
    version: 1, fps: 24, entrySceneId: 'intro',
    interaction: { question: 'What is 2 + 2?', acceptedAnswers: ['4', 'four'], waitSceneId: 'wait' },
    scenes: [
      scene('intro', 'Meet Sparko', 'source', 'Hi! Let’s solve a little puzzle together.', 72, 'mock:original'),
      scene('call', 'Ask a question', 'call', 'What is 2 + 2?', 96),
      scene('wait', 'Idle · waiting for an answer', 'wait', 'Take your time. I’m listening…', 48),
      scene('correct', 'Celebrate', 'response', 'That’s right! Two plus two is four. Nice work!', 96),
      scene('incorrect', 'Give a hint', 'response', 'Good try! Two stars plus two more makes four.', 96),
      scene('continue', 'Back to the story', 'source', 'Let’s keep exploring. Our next adventure awaits!', 72, 'mock:original', 72),
    ],
    edges: [
      { id: 'intro-call', from: 'intro', to: 'call', when: 'ended', label: 'Next', transitionFrames: 6 },
      { id: 'call-wait', from: 'call', to: 'wait', when: 'ended', label: 'Listen', transitionFrames: 6 },
      { id: 'wait-loop', from: 'wait', to: 'wait', when: 'pending', label: 'No answer · repeat', transitionFrames: 0 },
      { id: 'wait-correct', from: 'wait', to: 'correct', when: 'correct', label: 'answer = correct', transitionFrames: 6 },
      { id: 'wait-incorrect', from: 'wait', to: 'incorrect', when: 'incorrect', label: 'answer = incorrect', transitionFrames: 6 },
      { id: 'correct-continue', from: 'correct', to: 'continue', when: 'ended', label: 'Rejoin', transitionFrames: 6 },
      { id: 'incorrect-continue', from: 'incorrect', to: 'continue', when: 'ended', label: 'Rejoin', transitionFrames: 6 },
    ],
  });
}

export type PlaybackSession = {
  sceneId: SceneId;
  frame: number;
  elapsedFrames: number;
  playing: boolean;
  finished: boolean;
  loopIteration: number;
  outcome: Outcome | null;
  answer: string;
  attempts: number;
  visit: number;
  lastEdgeId: string | null;
  traversedEdgeIds: string[];
};

export function startSession(flow: CallResponseFlow, playing = false): PlaybackSession {
  return { sceneId: flow.entrySceneId, frame: 0, elapsedFrames: 0, playing, finished: false,
    loopIteration: 1, outcome: null, answer: '', attempts: 0, visit: 0, lastEdgeId: null, traversedEdgeIds: [] };
}
export const sceneFrames = (scene: TimelineScene) => scene.clip.outFrame - scene.clip.inFrame;
export const getScene = (flow: CallResponseFlow, id: SceneId) => flow.scenes.find(scene => scene.id === id)!;
export const responseInterstitialIds = (flow: CallResponseFlow) => flow.scenes.flatMap(scene => scene.clip.kind === 'response' && scene.interstitialId ? [scene.interstitialId] : []);

/** A submitted answer is latched; branching happens only at the end of a complete loop. */
export function answerSession(flow: CallResponseFlow, session: PlaybackSession, answer: string): PlaybackSession {
  const normalized = answer.trim().toLowerCase().replace(/[.!?]+$/, '').trim();
  if (getScene(flow, session.sceneId).clip.kind !== 'idle' || session.outcome || !normalized) return session;
  return { ...session, answer: answer.trim(), attempts: session.attempts + 1,
    outcome: flow.interaction.acceptedAnswers.includes(normalized) ? 'correct' : 'incorrect' };
}

export function nextEdge(flow: CallResponseFlow, session: PlaybackSession) {
  const idle = getScene(flow, session.sceneId).clip.kind === 'idle';
  const when = idle ? session.outcome ?? 'pending' : 'ended';
  return flow.edges.find(edge => edge.from === session.sceneId && edge.when === when)
    ?? (idle ? { id: `idle:${session.sceneId}`, from: session.sceneId, to: session.sceneId, when: 'pending' as const, label: 'No answer · repeat', transitionFrames: 0 } : undefined);
}

export function advanceSession(flow: CallResponseFlow, session: PlaybackSession, frames: number): PlaybackSession {
  if (!session.playing || session.finished || !Number.isFinite(frames) || frames <= 0) return session;
  let remaining = Math.floor(frames), state = { ...session };
  while (remaining > 0) {
    const length = sceneFrames(getScene(flow, state.sceneId));
    const step = Math.min(remaining, length - state.frame);
    state = { ...state, frame: state.frame + step, elapsedFrames: state.elapsedFrames + step };
    remaining -= step;
    if (state.frame < length) break;
    const edge = nextEdge(flow, state);
    if (!edge) return { ...state, playing: false, finished: true };
    const looping = edge.to === state.sceneId;
    const enteringWait = getScene(flow, edge.to).clip.kind === 'idle' && !looping;
    state = { ...state, sceneId: edge.to, frame: 0, visit: state.visit + 1,
      loopIteration: looping ? state.loopIteration + 1 : 1,
      outcome: enteringWait ? null : state.outcome, answer: enteringWait ? '' : state.answer,
      lastEdgeId: edge.id, traversedEdgeIds: [...new Set([...state.traversedEdgeIds, edge.id])] };
  }
  return state;
}

/** Debug controls use the same queued outcome and loop boundary as a submitted answer. */
export function branchSession(flow: CallResponseFlow, session: PlaybackSession, outcome: Outcome): PlaybackSession {
  if (getScene(flow, session.sceneId).clip.kind !== 'idle' || session.outcome) return session;
  return { ...session, outcome, answer: `[Debug: ${outcome}]`, attempts: session.attempts + 1 };
}

export function createTimelineExample(assetId: string, duration: number) {
  const flow = createTestFlow(), total = Math.floor(duration * flow.fps);
  if (total < 4) throw new Error('Open a video with at least four frames to create the example.');
  const split = Math.min(72, Math.floor(total / 2));
  flow.interstitial.time = split / flow.fps;
  const excerptPosition = { intro: 0, call: .2, wait: .4, correct: .6, incorrect: .8, continue: 0 };
  flow.scenes = flow.scenes.map(scene => {
    const frames = scene.role === 'source' ? split : Math.min(total, sceneFrames(scene));
    const inFrame = scene.role === 'source' ? scene.id === 'continue' ? split : 0 : Math.floor((total - frames) * excerptPosition[scene.id]);
    return { ...scene,
      label: scene.id === 'intro' ? 'Source · before' : scene.id === 'continue' ? 'Source · after' : scene.label,
      interstitialId: scene.role === 'source' ? undefined : `call-response-${scene.id}`,
      clip: { ...scene.clip, assetId, inFrame, outFrame: inFrame + frames },
    };
  });
  const interstitials: Interstitial[] = flow.scenes.filter(scene => scene.interstitialId).map(scene => ({
    id: scene.interstitialId!, label: scene.label, time: split / flow.fps, phase: 'ready',
    start_range: 2, end_range: 2, duration: 6, enable_prompt_expansion: false, prompt: scene.dialogue,
    result: { assetId, url: `asset:${assetId}`, start: scene.clip.inFrame / flow.fps,
      duration: sceneFrames(scene) / flow.fps, totalDuration: duration },
  }));
  return { flow, interstitials };
}

export function resolveFlow(flow: CallResponseFlow, interstitials: Interstitial[]): CallResponseFlow {
  return { ...flow, scenes: flow.scenes.map(scene => {
    if (!scene.interstitialId) return scene;
    const item = interstitials.find(item => item.id === scene.interstitialId), result = item && playableResult(item);
    return result?.assetId ? { ...scene, label: item!.label, clip: { ...scene.clip, assetId: result.assetId,
      inFrame: Math.round(result.start * flow.fps), outFrame: Math.round((result.start + result.duration) * flow.fps) } } : scene;
  }) };
}

/** One idle cycle and the longer branch are shown; actual elapsed time stays variable. */
export function flowLayout(flow: CallResponseFlow) {
  const starts = {} as Record<SceneId, number>;
  let cursor = 0;
  for (const id of ['intro', 'call', 'wait'] as const) { starts[id] = cursor; cursor += sceneFrames(getScene(flow, id)); }
  starts.correct = starts.incorrect = cursor;
  cursor += Math.max(sceneFrames(getScene(flow, 'correct')), sceneFrames(getScene(flow, 'incorrect')));
  starts.continue = cursor;
  return { starts, totalFrames: cursor + sceneFrames(getScene(flow, 'continue')) };
}

/** Scrubbing previews a scene, without evaluating an answer or advancing a live run. */
export function previewScene(flow: CallResponseFlow, id: SceneId): PlaybackSession {
  return { ...startSession(flow), sceneId: id };
}

export function reconnectEdge(flow: CallResponseFlow, id: string, to: SceneId): CallResponseFlow {
  const edge = flow.edges.find(item => item.id === id);
  if (!edge || edge.when === 'pending' || !flow.scenes.some(scene => scene.id === to)) return flow;
  // A repeat is explicit on the wait node. Other connections must advance to another scene.
  if (edge.from === to) return flow;
  return { ...flow, edges: flow.edges.map(item => item.id === id ? { ...item, to } : item) };
}

export function changeClipKind(flow: CallResponseFlow, id: SceneId, kind: TimelineClip['kind']): CallResponseFlow {
  const scene = getScene(flow, id);
  if (scene.clip.kind === kind) return flow;
  const { assetId, inFrame, outFrame, id: clipId } = scene.clip;
  const clip: TimelineClip = { id: clipId, assetId, inFrame, outFrame,
    ...(kind === 'idle' ? { kind, repeat: 'until-answer', exitAt: 'loop-boundary' }
      : kind === 'response' ? { kind, outcome: id === 'incorrect' ? 'incorrect' : 'correct' } : { kind }) };
  let edges = flow.edges;
  if (kind === 'idle') {
    edges = edges.filter(edge => edge.from !== id || edge.when !== 'ended');
    for (const when of ['pending', 'correct', 'incorrect'] as const) {
      if (edges.some(edge => edge.from === id && edge.when === when)) continue;
      edges = [...edges, { id: `${id}-${when}`, from: id,
        to: when === 'pending' ? id : id === when ? 'continue' : when, when,
        label: when === 'pending' ? 'No answer · repeat' : `answer = ${when}`, transitionFrames: 0 }];
    }
  } else if (scene.clip.kind === 'idle') {
    const next = edges.find(edge => edge.from === id && edge.when === 'correct')?.to ?? 'continue';
    edges = [...edges.filter(edge => edge.from !== id), ...(next === id ? [] : [{ id: `${id}-next`, from: id, to: next, when: 'ended' as const, label: 'Next', transitionFrames: 0 }])];
  }
  return groupCallResponse({ ...flow, edges, scenes: flow.scenes.map(scene => scene.id === id ? { ...scene, clip } : scene) });
}
