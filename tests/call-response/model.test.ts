import { describe, expect, it } from 'vitest';
import { addAnswer, advanceSession, answerSession, assignResponseButton, branchSession, changeClipKind, createTestFlow, createTimelineExample, defaultAnswerLabel, editAnswer, flowLayout, getScene, interstitialScenes, lockCallResponseStructure, migrateDefaultAnswerLabels, previewScene, reconnectEdge, removeAnswer, responseInterstitialIds, sceneFrames, startSession } from '../../src/features/call-response/model';

describe('call-response example playback', () => {
  it('names new choices alphabetically, continuing beyond Z and avoiding custom label collisions', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(defaultAnswerLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
    let flow = addAnswer(createTestFlow());
    expect(flow.interaction.answers.map(answer => answer.label)).toEqual(['A', 'B', 'C']);
    flow = editAnswer(flow, flow.interaction.answers[2].id, { label: 'D' });
    expect(addAnswer(flow).interaction.answers.at(-1)?.label).toBe('E');
  });
  it('migrates untouched example names while retaining custom answers, media and branch IDs', () => {
    const flow = createTestFlow();
    flow.interaction.answers[0].label = 'Correct'; flow.interaction.answers[1].label = 'Incorrect';
    getScene(flow, 'correct').label = 'Celebrate'; getScene(flow, 'incorrect').label = 'Give a hint';
    const migrated = migrateDefaultAnswerLabels(flow);
    expect(migrated.interaction.answers.map(answer => answer.label)).toEqual(['A', 'B']);
    expect(migrated.interaction.answers.map(answer => answer.id)).toEqual(['correct', 'incorrect']);
    expect(getScene(migrated, 'correct').clip).toEqual(getScene(flow, 'correct').clip);
    expect(getScene(migrated, 'correct').label).toBe('A');
    expect(migrateDefaultAnswerLabels(migrated)).toBe(migrated);
    const custom = editAnswer(flow, 'correct', { label: 'Tell me more' });
    expect(migrateDefaultAnswerLabels(custom).interaction.answers.map(answer => answer.label)).toEqual(['Tell me more', 'B']);
    const authored = editAnswer(editAnswer(flow, 'correct', { label: 'My answer' }), 'correct', { label: 'Correct' });
    expect(migrateDefaultAnswerLabels(authored).interaction.answers[0].label).toBe('Correct');
  });
  it('restores fixed roles and connections on legacy groups without losing clip media', () => {
    let flow = createTestFlow();
    flow = changeClipKind(flow, 'wait', 'video');
    flow = changeClipKind(flow, 'call', 'idle');
    flow = reconnectEdge(flow, 'incorrect-continue', 'call');
    const locked = lockCallResponseStructure(flow);
    expect(locked.scenes.map(scene => scene.clip.kind)).toEqual(['video', 'call', 'idle', 'response', 'response', 'video']);
    for (const scene of locked.scenes) expect(scene.clip).toMatchObject({ assetId: getScene(flow, scene.id).clip.assetId,
      inFrame: getScene(flow, scene.id).clip.inFrame, outFrame: getScene(flow, scene.id).clip.outFrame });
    expect(interstitialScenes(locked).map(scene => scene.id)).toEqual(['call', 'wait', 'correct', 'incorrect']);
    const waiting = advanceSession(locked, startSession(locked, true), 72 + 96);
    expect(waiting.sceneId).toBe('wait');
    for (const answer of locked.interaction.answers) {
      const response = advanceSession(locked, branchSession(locked, waiting, answer.id), 48);
      expect(response.sceneId).toBe(answer.sceneId);
      expect(advanceSession(locked, response, sceneFrames(getScene(locked, answer.sceneId))).sceneId).toBe('continue');
    }
    expect(lockCallResponseStructure(locked)).toEqual(locked);
  });
  it('swaps response button assignments with one route per answer and preserves the actual clips', () => {
    const original = createTestFlow();
    const flow = assignResponseButton(original, 'correct', 'incorrect');
    expect(flow.interaction.answers.map(answer => answer.sceneId)).toEqual(['incorrect', 'correct']);
    for (const answer of flow.interaction.answers) {
      const scene = getScene(flow, answer.sceneId);
      expect(scene.clip).toMatchObject({ kind: 'response', outcome: answer.id, assetId: getScene(original, scene.id).clip.assetId });
      const queued = branchSession(flow, { ...previewScene(flow, 'wait'), playing: true }, answer.id);
      expect(advanceSession(flow, queued, 48).sceneId).toBe(answer.sceneId);
    }
    expect(assignResponseButton(flow, 'call', 'incorrect')).toBe(flow);
    expect(assignResponseButton(flow, 'correct', 'missing')).toBe(flow);
    expect(assignResponseButton(flow, 'correct', 'incorrect')).toBe(flow);
  });
  it('routes arbitrary labels and alternative text to independent response clips at loop boundaries', () => {
    let flow = addAnswer(createTestFlow());
    const added = flow.interaction.answers.at(-1)!;
    flow = editAnswer(flow, added.id, { label: 'Tell me more', values: ['Explain', 'WHY'] });
    flow = { ...flow, interaction: { ...flow.interaction, fallbackAnswerId: null } };
    const waiting = { ...previewScene(flow, 'wait'), playing: true, frame: 12 };
    for (const text of ['Tell me more', '  explain! ', 'why?']) {
      const answered = answerSession(flow, waiting, text);
      expect(answered.outcome).toBe(added.id);
      expect(advanceSession(flow, answered, 35).sceneId).toBe('wait');
      const response = advanceSession(flow, answered, 36);
      expect(response.sceneId).toBe(added.sceneId);
      expect(advanceSession(flow, response, sceneFrames(getScene(flow, added.sceneId))).sceneId).toBe('continue');
    }
    const unmatched = answerSession(flow, waiting, 'Something else');
    expect(unmatched.outcome).toBeNull();
    expect(advanceSession(flow, unmatched, 48 * 4).sceneId).toBe('wait');
    expect(branchSession(flow, waiting, 'unknown')).toBe(waiting);
    expect(branchSession(flow, waiting, added.id).outcome).toBe(added.id);
    const layout = flowLayout(flow);
    expect(layout.starts[added.sceneId]).toBe(layout.starts.correct);
    expect(layout.starts.continue - layout.starts[added.sceneId]).toBe(sceneFrames(getScene(flow, added.sceneId)));
    expect(interstitialScenes(flow).map(scene => scene.id)).toContain(added.sceneId);
    const changed = changeClipKind(flow, 'call', 'idle');
    expect(changed.edges.some(edge => edge.from === 'call' && edge.when === added.id && edge.to === added.sceneId)).toBe(true);
  });
  it('removes branches and repairs connections, with one answer retained as the minimum', () => {
    let flow = addAnswer(createTestFlow());
    const added = flow.interaction.answers.at(-1)!;
    flow = reconnectEdge(flow, 'correct-continue', added.sceneId);
    flow = { ...flow, interaction: { ...flow.interaction, fallbackAnswerId: added.id } };
    const removed = removeAnswer(flow, added.id);
    expect(removed.interaction.fallbackAnswerId).toBeNull();
    expect(removed.edges.find(edge => edge.id === 'correct-continue')?.to).toBe('continue');
    expect(removed.edges.some(edge => edge.from === added.sceneId || edge.to === added.sceneId || edge.when === added.id)).toBe(false);
    expect(removed.interstitial.clipIds).not.toContain(getScene(flow, added.sceneId).clip.id);
    const one = removeAnswer(removed, 'correct');
    expect(flowLayout(one).starts.incorrect).toBe(216);
    expect(removeAnswer(one, 'incorrect')).toBe(one);
    expect(answerSession(one, previewScene(one, 'wait'), 'B').outcome).toBe('incorrect');
  });
  it('owns all non-video clips in one stable interstitial as clip types change', () => {
    const { flow } = createTimelineExample('source-asset', 8);
    expect(flow.interstitial).toMatchObject({ kind: 'call-response', label: 'Untitled', time: 3 });
    expect(interstitialScenes(flow).map(scene => scene.id)).toEqual(['call', 'wait', 'correct', 'incorrect']);
    const ordinary = changeClipKind(flow, 'wait', 'video');
    expect(interstitialScenes(ordinary).map(scene => scene.id)).toEqual(['call', 'correct', 'incorrect']);
    const expanded = changeClipKind(ordinary, 'intro', 'call');
    expect(interstitialScenes(expanded).map(scene => scene.id)).toEqual(['intro', 'call', 'correct', 'incorrect']);
    expect(expanded.interstitial.id).toBe(flow.interstitial.id);
    expect(flow.interstitial.clipIds).toHaveLength(4);
  });
  it.each([8, 1])('aligns both example responses and their rejoin even with a %s-second source', duration => {
    const { flow, interstitials } = createTimelineExample('source-asset', duration);
    const layout = flowLayout(flow), correct = getScene(flow, 'correct'), incorrect = getScene(flow, 'incorrect');
    expect(sceneFrames(correct)).toBe(sceneFrames(incorrect));
    expect(layout.starts.correct).toBe(layout.starts.incorrect);
    expect(layout.starts.correct + sceneFrames(correct)).toBe(layout.starts.continue);
    expect(responseInterstitialIds(flow)).toEqual([correct.interstitialId, incorrect.interstitialId]);
    expect(new Set(interstitials.filter(item => responseInterstitialIds(flow).includes(item.id)).map(item => item.duration)).size).toBe(1);
  });
  it('keeps actual media lengths when a generated response differs from its sibling', () => {
    const flow = createTestFlow(); getScene(flow, 'correct').clip.outFrame = 72;
    const layout = flowLayout(flow);
    expect(sceneFrames(getScene(flow, 'correct'))).toBe(72);
    expect(layout.starts.continue - layout.starts.correct).toBe(96);
  });
  it('converting a call to idle supplies the branches used by its on-clip debug buttons', () => {
    const flow = changeClipKind(createTestFlow(), 'call', 'idle');
    expect(getScene(flow, 'call').clip.kind).toBe('idle');
    expect(flow.edges.filter(edge => edge.from === 'call').map(edge => edge.when).sort()).toEqual(['correct', 'incorrect', 'pending']);
    const queued = branchSession(flow, { ...previewScene(flow, 'call'), playing: true }, 'correct');
    expect(advanceSession(flow, queued, 96).sceneId).toBe('correct');
  });
  it('idle clips repeat without an explicit loop edge, while video clips end', () => {
    const flow = createTestFlow(); flow.edges = flow.edges.filter(edge => edge.from !== 'wait');
    const playing = { ...previewScene(flow, 'wait'), playing: true };
    expect(advanceSession(flow, playing, 48 * 3)).toMatchObject({ sceneId: 'wait', loopIteration: 4, finished: false });
    const scene = getScene(flow, 'wait'); scene.clip = { ...scene.clip, kind: 'video' };
    expect(advanceSession(flow, playing, 48 * 3)).toMatchObject({ sceneId: 'wait', finished: true, playing: false });
  });
  it('debug buttons queue the chosen branch using the idle boundary', () => {
    const flow = createTestFlow();
    let state = branchSession(flow, { ...previewScene(flow, 'wait'), playing: true }, 'incorrect');
    state = advanceSession(flow, state, 47); expect(state.sceneId).toBe('wait');
    state = advanceSession(flow, state, 1); expect(state.sceneId).toBe('incorrect');
  });
  it('the timeline example uses real asset ranges and linked interstitials', () => {
    const assetId = crypto.randomUUID(), { flow, interstitials } = createTimelineExample(assetId, 8);
    expect(flow.scenes.every(scene => scene.clip.assetId === assetId && scene.clip.outFrame <= 8 * 24)).toBe(true);
    expect(getScene(flow, 'correct').clip.inFrame).not.toBe(getScene(flow, 'incorrect').clip.inFrame);
    expect(interstitials).toHaveLength(4);
    expect(flow.scenes.filter(scene => scene.interstitialId).map(scene => scene.interstitialId)).toEqual(interstitials.map(item => item.id));
    expect(getScene(flow, 'wait').clip).toMatchObject({ kind: 'idle', repeat: 'until-answer', exitAt: 'loop-boundary' });
  });
  it('follows the question into an indefinite wait and records loop traversals', () => {
    const flow = createTestFlow();
    const state = advanceSession(flow, startSession(flow, true), 24 * 14);
    expect(state).toMatchObject({ sceneId: 'wait', loopIteration: 4, frame: 24, playing: true, outcome: null });
    expect(state.traversedEdgeIds).toEqual(['intro-call', 'call-wait', 'wait-loop']);
  });

  it.each([[' FOUR! ', 'correct', 'incorrect'], ['3', 'incorrect', 'correct']] as const)('queues %s until the loop boundary and plays only the %s branch', (answer, outcome, unchosen) => {
    const flow = createTestFlow();
    let state = { ...previewScene(flow, 'wait'), playing: true, frame: 10 };
    state = answerSession(flow, state, answer);
    expect(state).toMatchObject({ sceneId: 'wait', frame: 10, outcome, attempts: 1 });
    state = advanceSession(flow, state, 37);
    expect(state).toMatchObject({ sceneId: 'wait', frame: 47 });
    state = advanceSession(flow, state, 1);
    expect(state).toMatchObject({ sceneId: outcome, frame: 0 });
    state = advanceSession(flow, state, sceneFrames(getScene(flow, outcome)));
    expect(state.sceneId).toBe('continue');
    expect(state.traversedEdgeIds).not.toContain(`wait-${unchosen}`);
    state = advanceSession(flow, state, sceneFrames(getScene(flow, 'continue')));
    expect(state).toMatchObject({ sceneId: 'continue', finished: true, playing: false });
  });

  it('ignores blank, duplicate and out-of-scene answers, and never advances while paused', () => {
    const flow = createTestFlow(), initial = startSession(flow);
    expect(answerSession(flow, initial, '4')).toBe(initial);
    expect(advanceSession(flow, initial, 500)).toBe(initial);
    const waiting = previewScene(flow, 'wait');
    expect(answerSession(flow, waiting, '   ')).toBe(waiting);
    const answered = answerSession(flow, waiting, '4');
    expect(answerSession(flow, answered, '3')).toBe(answered);
    expect(advanceSession(flow, { ...waiting, playing: true }, NaN).sceneId).toBe('wait');
  });

  it('uses edited graph connections for playback and resets the answer on a retry', () => {
    const flow = reconnectEdge(createTestFlow(), 'incorrect-continue', 'wait');
    let state = answerSession(flow, { ...previewScene(flow, 'wait'), playing: true }, '3');
    state = advanceSession(flow, state, 48 + 96);
    expect(state).toMatchObject({ sceneId: 'wait', outcome: null, answer: '', attempts: 1, loopIteration: 1 });
    state = answerSession(flow, state, '4');
    state = advanceSession(flow, state, 48);
    expect(state).toMatchObject({ sceneId: 'correct', outcome: 'correct', attempts: 2 });
  });

  it('keeps the ambient self-loop fixed and source splits on adjacent ranges of the same asset', () => {
    const flow = createTestFlow();
    expect(reconnectEdge(flow, 'wait-loop', 'continue')).toBe(flow);
    expect(reconnectEdge(flow, 'intro-call', 'intro')).toBe(flow);
    const first = getScene(flow, 'intro').clip, second = getScene(flow, 'continue').clip;
    expect(first.assetId).toBe(second.assetId);
    expect(first.outFrame).toBe(second.inFrame);
  });
});
