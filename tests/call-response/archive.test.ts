import { describe, expect, it } from 'vitest';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { emptyAnalysis, type Project } from '../../src/features/project/types';
import { createTimelineExample, reconnectEdge } from '../../src/features/call-response/model';
import { callResponseSchema } from '../../src/features/call-response/schema';
import { baselineReferences, clipDependency } from '../../src/features/call-response/dependencies';

describe('call-response project persistence', () => {
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
    expect(result.project.interstitials.every(item => item.result?.reference?.before.assetId === result.project.source.assetId)).toBe(true);
    expect(clipDependency(result.project.callResponse!, result.project.interstitials, 'correct').stale).toBe(false);
    project.callResponse!.scenes[0].clip.outFrame = 0;
    await expect(packProject(project, assets, signal, () => {})).rejects.toThrow();
  });
});
