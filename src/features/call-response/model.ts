import { playableResult, type CallResponseInterstitial, type Interstitial } from '../../../shared/interstitials';
/** Clip types and connections shared by the project, timeline and video player. */
export type SceneId = string;
/** Stable answer IDs, independent of the text displayed to the user. */
export type Outcome = string;
export type AnswerOption = { id: Outcome; label: string; values: string[]; sceneId: SceneId };
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
  version: 2;
  interstitial: CallResponseInterstitial;
  fps: number;
  entrySceneId: SceneId;
  scenes: TimelineScene[];
  edges: FlowEdge[];
  interaction: { question: string; answers: AnswerOption[]; fallbackAnswerId: Outcome | null; waitSceneId: SceneId };
};

/** Older examples had separate child jobs but no saved parent interstitial. */
export function groupCallResponse(flow: Omit<CallResponseFlow, 'interstitial' | 'version' | 'interaction'> & {
  version: 1 | 2; interstitial?: CallResponseInterstitial;
  interaction: { question: string; waitSceneId: SceneId; answers?: AnswerOption[]; fallbackAnswerId?: Outcome | null; acceptedAnswers?: string[] };
}): CallResponseFlow {
  const intro = flow.scenes.find(scene => scene.id === 'intro');
  const { question, waitSceneId, answers, fallbackAnswerId, acceptedAnswers } = flow.interaction;
  return { ...flow, version: 2, interaction: { question, waitSceneId,
    answers: answers ?? [
      { id: 'correct', label: 'Correct', values: acceptedAnswers ?? ['4', 'four'], sceneId: 'correct' },
      { id: 'incorrect', label: 'Incorrect', values: [], sceneId: 'incorrect' },
    ], fallbackAnswerId: answers ? fallbackAnswerId ?? null : 'incorrect',
  }, interstitial: {
    id: flow.interstitial?.id ?? crypto.randomUUID(), kind: 'call-response',
    label: flow.interstitial?.label ?? 'Untitled', time: flow.interstitial?.time ?? (intro ? (intro.clip.outFrame - intro.clip.inFrame) / flow.fps : 0),
    clipIds: flow.scenes.filter(scene => scene.clip.kind !== 'video').map(scene => scene.clip.id),
  } };
}
export const answerLabel = (flow: CallResponseFlow, id: Outcome) => flow.interaction.answers.find(answer => answer.id === id)?.label ?? id;
export const clipTypeLabel = (clip: TimelineClip, flow: CallResponseFlow) => clip.kind === 'video' ? '' : clip.kind === 'response'
  ? `${answerLabel(flow, clip.outcome)} Response` : clip.kind === 'idle' ? 'Idle' : 'Call';
export const interstitialScenes = (flow: CallResponseFlow) => flow.scenes.filter(scene => flow.interstitial.clipIds.includes(scene.clip.id));
/** The response column stays in place even when a child is converted to another clip type. */
export const branchScenes = (flow: CallResponseFlow) => flow.scenes.filter(scene => !['intro', 'call', 'wait', 'continue'].includes(scene.id));
export const normalizeAnswer = (value: string) => value.trim().toLowerCase().replace(/[.!?]+$/, '').trim();

export function addAnswer(flow: CallResponseFlow): CallResponseFlow {
  if (flow.interaction.answers.length >= 100) return flow;
  const id = crypto.randomUUID(), sceneId = `response:${id}`;
  let index = flow.interaction.answers.length + 1;
  while (flow.interaction.answers.some(answer => answer.label === `Answer ${index}`)) index++;
  const answer: AnswerOption = { id, sceneId, label: `Answer ${index}`, values: [] };
  const previous = branchScenes(flow)[0] ?? getScene(flow, flow.interaction.waitSceneId);
  const scene: TimelineScene = { id: sceneId, label: answer.label, role: 'response', dialogue: '',
    interstitialId: `call-response-${id}`, clip: { ...previous.clip, id: `clip:${id}`, kind: 'response', outcome: id } };
  return groupCallResponse({ ...flow, interaction: { ...flow.interaction, answers: [...flow.interaction.answers, answer] },
    scenes: [...flow.scenes.filter(scene => scene.id !== 'continue'), scene, getScene(flow, 'continue')],
    edges: [...flow.edges,
      ...flow.scenes.filter(scene => scene.clip.kind === 'idle').map(idle => ({ id: `${idle.id}-${id}`, from: idle.id, to: sceneId,
        when: id, label: answer.label, transitionFrames: 6 })),
      { id: `${sceneId}-continue`, from: sceneId, to: 'continue', when: 'ended', label: 'Rejoin', transitionFrames: 6 }],
  });
}

export function editAnswer(flow: CallResponseFlow, id: Outcome, patch: Partial<Pick<AnswerOption, 'label' | 'values'>>): CallResponseFlow {
  const answer = flow.interaction.answers.find(answer => answer.id === id);
  if (!answer) return flow;
  const label = patch.label === undefined ? answer.label : patch.label.trim().slice(0, 200) || answer.label;
  const values = patch.values ? [...new Set(patch.values.map(value => value.trim().slice(0, 200)).filter(Boolean))].slice(0, 100) : answer.values;
  return { ...flow, interaction: { ...flow.interaction, answers: flow.interaction.answers.map(answer => answer.id === id ? { ...answer, label, values } : answer) },
    scenes: label === answer.label ? flow.scenes : flow.scenes.map(scene => scene.id === answer.sceneId ? { ...scene, label } : scene),
    edges: flow.edges.map(edge => edge.when === id ? { ...edge, label } : edge) };
}

/** Remove the owned response and repair incoming connections without leaving dangling edges. */
export function removeAnswer(flow: CallResponseFlow, id: Outcome): CallResponseFlow {
  const answer = flow.interaction.answers.find(answer => answer.id === id);
  if (!answer || flow.interaction.answers.length <= 1) return flow;
  return groupCallResponse({ ...flow,
    interaction: { ...flow.interaction, answers: flow.interaction.answers.filter(answer => answer.id !== id),
      fallbackAnswerId: flow.interaction.fallbackAnswerId === id ? null : flow.interaction.fallbackAnswerId },
    scenes: flow.scenes.filter(scene => scene.id !== answer.sceneId).map(scene => scene.clip.kind === 'response' && scene.clip.outcome === id
      ? { ...scene, clip: { ...scene.clip, outcome: flow.interaction.answers.find(answer => answer.id !== id)!.id } } : scene),
    edges: flow.edges.filter(edge => edge.from !== answer.sceneId && edge.when !== id)
      .map(edge => edge.to === answer.sceneId ? { ...edge, to: 'continue' } : edge)
      .filter(edge => edge.from !== edge.to || edge.when === 'pending'),
  });
}

export function createTestFlow(): CallResponseFlow {
  const scene = (id: SceneId, label: string, role: TimelineScene['role'], dialogue: string, frames: number, assetId = `mock:${id}`, inFrame = 0): TimelineScene =>
    ({ id, label, role, dialogue, clip: { id: `clip:${id}`, assetId, inFrame, outFrame: inFrame + frames,
      ...(role === 'source' ? { kind: 'video' as const } : role === 'call' ? { kind: 'call' as const }
        : role === 'wait' ? { kind: 'idle' as const, repeat: 'until-answer' as const, exitAt: 'loop-boundary' as const }
        : { kind: 'response' as const, outcome: id === 'correct' ? 'correct' as const : 'incorrect' as const }) } });
  return groupCallResponse({
    version: 2, fps: 24, entrySceneId: 'intro',
    interaction: { question: 'What is 2 + 2?', waitSceneId: 'wait', fallbackAnswerId: 'incorrect', answers: [
      { id: 'correct', label: 'Correct', values: ['4', 'four'], sceneId: 'correct' },
      { id: 'incorrect', label: 'Incorrect', values: [], sceneId: 'incorrect' },
    ] },
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
  const normalized = normalizeAnswer(answer);
  if (getScene(flow, session.sceneId).clip.kind !== 'idle' || session.outcome || !normalized) return session;
  const outcome = flow.interaction.answers.find(option => [option.label, ...option.values].some(value => normalizeAnswer(value) === normalized))?.id
    ?? flow.interaction.fallbackAnswerId;
  return { ...session, answer: answer.trim(), attempts: session.attempts + 1,
    outcome: outcome && flow.edges.some(edge => edge.from === session.sceneId && edge.when === outcome) ? outcome : null };
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
  if (getScene(flow, session.sceneId).clip.kind !== 'idle' || session.outcome
    || !flow.interaction.answers.some(answer => answer.id === outcome)
    || !flow.edges.some(edge => edge.from === session.sceneId && edge.when === outcome)) return session;
  return { ...session, outcome, answer: `[Debug: ${outcome}]`, attempts: session.attempts + 1 };
}

export function createTimelineExample(assetId: string, duration: number) {
  const flow = createTestFlow(), total = Math.floor(duration * flow.fps);
  if (total < 4) throw new Error('Open a video with at least four frames to create the example.');
  const split = Math.min(72, Math.floor(total / 2));
  flow.interstitial.time = split / flow.fps;
  const excerptPosition: Record<SceneId, number> = { intro: 0, call: .2, wait: .4, correct: .6, incorrect: .8, continue: 0 };
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
  const starts: Record<SceneId, number> = Object.create(null);
  let cursor = 0;
  for (const id of ['intro', 'call', 'wait'] as const) { starts[id] = cursor; cursor += sceneFrames(getScene(flow, id)); }
  const branches = branchScenes(flow);
  for (const scene of branches) starts[scene.id] = cursor;
  cursor += Math.max(0, ...branches.map(sceneFrames));
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
      : kind === 'response' ? { kind, outcome: flow.interaction.answers.find(answer => answer.sceneId === id)?.id ?? flow.interaction.answers[0].id } : { kind }) };
  let edges = flow.edges;
  if (kind === 'idle') {
    edges = edges.filter(edge => edge.from !== id || edge.when !== 'ended');
    for (const when of ['pending', ...flow.interaction.answers.map(answer => answer.id)]) {
      if (edges.some(edge => edge.from === id && edge.when === when)) continue;
      const destination = flow.interaction.answers.find(answer => answer.id === when)?.sceneId ?? 'continue';
      edges = [...edges, { id: `${id}-${when}`, from: id,
        to: when === 'pending' ? id : id === destination ? 'continue' : destination, when,
        label: when === 'pending' ? 'No answer · repeat' : answerLabel(flow, when), transitionFrames: 0 }];
    }
  } else if (scene.clip.kind === 'idle') {
    const next = edges.find(edge => edge.from === id && flow.interaction.answers.some(answer => answer.id === edge.when))?.to ?? 'continue';
    edges = [...edges.filter(edge => edge.from !== id), ...(next === id ? [] : [{ id: `${id}-next`, from: id, to: next, when: 'ended' as const, label: 'Next', transitionFrames: 0 }])];
  }
  return groupCallResponse({ ...flow, edges, scenes: flow.scenes.map(scene => scene.id === id ? { ...scene, clip } : scene) });
}
