import { describe, expect, it } from 'vitest';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { emptyAnalysis, type Project } from '../../src/features/project/types';
import { addAnswer, answerSession, createTimelineExample, editAnswer, previewScene, reconnectEdge } from '../../src/features/call-response/model';
import { callResponseSchema } from '../../src/features/call-response/schema';
import { baselineReferences, clipDependency } from '../../src/features/call-response/dependencies';
import { createCallResponseDraft } from '../../src/features/call-response/draft';
import { interstitialSettings } from '../../shared/interstitials';

describe('call-response project persistence', () => {
  it('round-trips multiple draft pins, an inactive variant and short Comfy loop settings', async () => {
    const assetId = crypto.randomUUID();
    const pin = { id: 'first', label: 'First', time: 3, kind: 'regular' as const, method: 'comfy' as const, phase: 'draft' as const, prompt: 'Shared setting', start_range: 2, end_range: 2, duration: 6, enable_prompt_expansion: false };
    const second = { ...pin, id: 'second', label: 'Second', time: 9, kind: 'call-response' as const };
    const a = createCallResponseDraft(pin, assetId, 20), b = createCallResponseDraft(second, assetId, 20);
    a.interstitials[1].loopAudio = true;
    a.interstitials[1].requestPrompt = 'The exact Idle prompt sent to Comfy.';
    const project: Project = { id: 'drafts', name: 'Drafts', updatedAt: 0, source: { name: 'source.mp4', assetId },
      callResponse: a.flow, callResponses: [a.flow, b.flow], interstitials: [pin, second, ...a.interstitials, ...b.interstitials], subtitle: null, analysis: emptyAnalysis() };
    const signal = new AbortController().signal;
    const { project: restored } = await unpackProject(await packProject(project, [{ id: assetId, name: 'source.mp4', blob: new Blob(['video']) }], signal, () => {}), signal, () => {});
    expect(restored.callResponses).toHaveLength(2);
    expect(restored.interstitials[0].kind).toBe('regular');
    expect(restored.interstitials[3]).toMatchObject({ method: 'comfy-loop', duration: 2, loopAudio: true, continuity: 'Shared setting',
      requestPrompt: 'The exact Idle prompt sent to Comfy.' });
    expect(restored.callResponses!.every(flow => flow.scenes.every(scene => scene.clip.assetId === restored.source.assetId))).toBe(true);
    expect(restored.callResponses![0].interstitial).toMatchObject({ brief: 'Shared setting', linkResponseDurations: false });
    expect(restored.callResponses![0].scenes.find(scene => scene.id === 'wait')).toMatchObject({ draft: true, plannedFrames: 48 });
  });
  it('migrates binary projects without changing answer matching, scene IDs, or saved media', () => {
    const { flow } = createTimelineExample(crypto.randomUUID(), 12);
    const legacy = { ...flow, version: 1, interaction: { question: 'What is 2 + 2?', acceptedAnswers: ['4', 'four'], waitSceneId: 'wait' } };
    const restored = callResponseSchema.parse(legacy);
    expect(restored.version).toBe(2);
    expect(restored.scenes).toEqual(flow.scenes);
    expect(restored.interaction.answers.map(answer => answer.id)).toEqual(['correct', 'incorrect']);
    expect(answerSession(restored, previewScene(restored, 'wait'), 'FOUR!').outcome).toBe('correct');
    expect(answerSession(restored, previewScene(restored, 'wait'), 'other').outcome).toBe('incorrect');
  });
  it('rejects unknown answer targets, duplicate IDs, reserved IDs, and unknown fallbacks', () => {
    const { flow } = createTimelineExample(crypto.randomUUID(), 12);
    for (const answers of [
      [flow.interaction.answers[0], flow.interaction.answers[0]],
      [{ ...flow.interaction.answers[0], sceneId: 'missing' }],
      [{ ...flow.interaction.answers[0], id: 'pending' }],
    ]) expect(callResponseSchema.safeParse({ ...flow, interaction: { ...flow.interaction, answers } }).success).toBe(false);
    expect(callResponseSchema.safeParse({ ...flow, interaction: { ...flow.interaction, fallbackAnswerId: 'missing' } }).success).toBe(false);
    expect(callResponseSchema.safeParse({ ...flow, edges: [...flow.edges, { ...flow.edges[0], id: 'bad', from: 'missing', to: 'continue' }] }).success).toBe(false);
  });
  it('round-trips custom answer labels, matches, response media and dependencies', async () => {
    const id = crypto.randomUUID(), example = createTimelineExample(id, 12);
    let flow = addAnswer(example.flow);
    const answer = flow.interaction.answers.at(-1)!;
    flow = editAnswer(flow, answer.id, { label: 'Try another puzzle', values: ['Skip', 'Next please'], color: { hue: 212.5, saturation: 42, value: 63 } });
    flow = editAnswer(flow, flow.interaction.answers[0].id, { color: { hue: 43, saturation: 100 } }); // Legacy HSL remains readable.
    const scene = flow.scenes.find(scene => scene.id === answer.sceneId)!;
    const items = [...example.interstitials, { ...example.interstitials[2], id: scene.interstitialId!, label: scene.label }];
    const project: Project = { id: 'custom', name: 'Custom answers', updatedAt: 0, source: { name: 'source.mp4', assetId: id },
      interstitials: baselineReferences(flow, items), callResponse: flow, subtitle: null, analysis: emptyAnalysis() };
    const signal = new AbortController().signal;
    const packed = await packProject(project, [{ id, name: 'source.mp4', blob: new Blob(['video bytes'], { type: 'video/mp4' }) }], signal, () => {});
    const restored = (await unpackProject(packed, signal, () => {})).project;
    expect(restored.callResponse!.interaction).toEqual(flow.interaction);
    expect(restored.callResponse!.interaction.answers.at(-1)?.color).toEqual({ hue: 212.5, saturation: 42, value: 63 });
    expect(restored.callResponse!.interaction.answers[0].color).toEqual({ hue: 43, saturation: 100 });
    expect(answerSession(restored.callResponse!, previewScene(restored.callResponse!, 'wait'), 'next please').outcome).toBe(answer.id);
    expect(clipDependency(restored.callResponse!, restored.interstitials, answer.sceneId)).toMatchObject({ stale: false,
      reference: { before: { sceneId: 'wait', assetId: restored.source.assetId }, after: { sceneId: 'continue' } } });
  });
  it('accepts legacy answers without colors and rejects out-of-range color values', () => {
    const flow = createTimelineExample(crypto.randomUUID(), 12).flow;
    expect(callResponseSchema.parse(flow).interaction.answers.every(answer => !answer.color)).toBe(true);
    for (const color of [{ hue: -1, saturation: 50 }, { hue: 20, saturation: 101 }, { hue: 361, saturation: 50 },
      { hue: 20, saturation: 50, value: -1 }, { hue: 20, saturation: 50, value: 101 }]) {
      const answers = flow.interaction.answers.map((answer, index) => index ? answer : { ...answer, color });
      expect(callResponseSchema.safeParse({ ...flow, interaction: { ...flow.interaction, answers } }).success).toBe(false);
    }
  });
  it('migrates a legacy example into one parent and rejects invalid ownership', () => {
    const { flow } = createTimelineExample(crypto.randomUUID(), 12);
    const { interstitial, ...legacy } = flow;
    const restored = callResponseSchema.parse(legacy);
    expect(restored.interstitial).toMatchObject({ ...interstitial, id: expect.any(String) });
    expect(callResponseSchema.safeParse({ ...flow, interstitial: { ...interstitial, clipIds: [...interstitial.clipIds, flow.scenes[0].clip.id] } }).success).toBe(false);
    expect(callResponseSchema.safeParse({ ...flow, interstitial: { ...interstitial, clipIds: interstitial.clipIds.slice(1) } }).success).toBe(false);
  });
  it('round-trips idle behavior, connections and asset references in a normal project archive', async () => {
    const id = crypto.randomUUID(), example = createTimelineExample(id, 12);
    const project: Project = { id: 'test-flow', name: 'Call response', updatedAt: 0, source: { name: 'source.mp4', assetId: id },
      interstitials: baselineReferences(example.flow, example.interstitials), callResponse: reconnectEdge(example.flow, 'incorrect-continue', 'wait'), subtitle: null, analysis: emptyAnalysis() };
    const assets = [{ id, name: 'source.mp4', blob: new Blob(['video bytes'], { type: 'video/mp4' }) }];
    const signal = new AbortController().signal;
    const result = await unpackProject(await packProject(project, assets, signal, () => {}), signal, () => {});
    expect(result.project.callResponse?.scenes.find(scene => scene.id === 'wait')?.clip).toMatchObject({ kind: 'idle', repeat: 'until-answer', exitAt: 'loop-boundary' });
    expect(result.project.callResponse?.edges.find(edge => edge.id === 'incorrect-continue')?.to).toBe('wait');
    expect(result.project.callResponse?.interstitial).toEqual(example.flow.interstitial);
    expect(result.project.callResponse?.scenes.every(scene => scene.clip.assetId === result.project.source.assetId)).toBe(true);
    expect(result.project.source.assetId).not.toBe(id);
    expect(result.project.interstitials.every(item => item.result?.assetId === result.project.source.assetId)).toBe(true);
    expect(result.project.interstitials.every(item => item.result?.reference?.before!.assetId === result.project.source.assetId)).toBe(true);
    expect(clipDependency(result.project.callResponse!, result.project.interstitials, 'correct').stale).toBe(false);
    project.callResponse!.scenes[0].clip.outFrame = 0;
    await expect(packProject(project, assets, signal, () => {})).rejects.toThrow();
  });
  it('preserves each generation’s own reference settings and generated boundaries', async () => {
    const assetId = crypto.randomUUID(), { flow, interstitials } = createTimelineExample(assetId, 12);
    const idle = interstitials.find(item => item.id === 'call-response-wait')!;
    const response = interstitials.find(item => item.id === 'call-response-correct')!;
    idle.generationSettings = { ...interstitialSettings(idle), start_range: 2, end_range: 2 };
    idle.result = { ...idle.result!, start: 0, duration: 2, totalDuration: 2,
      fullAssetId: assetId, fullRange: { start: 2, duration: 2, totalDuration: 6 } };
    response.generationSettings = { ...interstitialSettings(response), start_range: 1.625, end_range: 3 };
    response.result = { ...response.result!, start: 1.625, duration: 4, totalDuration: 6.625 };
    const project: Project = { id: 'ranges', name: 'Ranges', updatedAt: 0, source: { name: 'source.mp4', assetId },
      callResponse: flow, interstitials, subtitle: null, analysis: emptyAnalysis() };
    const signal = new AbortController().signal;
    const saved = (await unpackProject(await packProject(project,
      [{ id: assetId, name: 'source.mp4', blob: new Blob(['video bytes'], { type: 'video/mp4' }) }], signal, () => {}), signal, () => {})).project;
    expect(saved.interstitials.find(item => item.id === idle.id)).toMatchObject({
      generationSettings: { start_range: 2, end_range: 2 },
      result: { start: 0, duration: 2, totalDuration: 2, fullRange: { start: 2, duration: 2, totalDuration: 6 } },
    });
    expect(saved.interstitials.find(item => item.id === response.id)).toMatchObject({
      generationSettings: { start_range: 1.625, end_range: 3 },
      result: { start: 1.625, duration: 4, totalDuration: 6.625 },
    });
  });
});
