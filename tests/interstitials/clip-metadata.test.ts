import { describe, expect, it } from 'vitest';
import { captureClipOrigin, restoreClip, resolveClipReferences } from '../../src/features/interstitials/clipMetadata';
import type { StoryGraph, StoryNode } from '../../src/features/story-flow/model';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { assetIds, emptyAnalysis, type Project } from '../../src/features/project/types';
import { clipMetadata } from '../fixtures/clip-metadata';
import { parseClipMetadata, serializeClipMetadata } from '../../shared/clip-metadata';
const assetId = '44444444-4444-4444-8444-444444444444';
const source = (side: 'before' | 'after'): StoryNode => { const ref = clipMetadata.references[side]!; return { id: ref.sceneId, name: ref.name, kind: 'source', source: { assetId: ref.assetId, inFrame: ref.inFrame, outFrame: ref.outFrame }, x: 0, y: 0, loopCount: 0 }; };
const graph = (nodes: StoryNode[]): StoryGraph => ({ version: 1, entryId: nodes[0].id, nodes, edges: [], templates: [] });
describe('restoring generated clips', () => {
  it('preserves separate loop fade durations in submitted metadata and restored MP4s', () => {
    const metadata = parseClipMetadata(serializeClipMetadata({ ...clipMetadata,
      clip: { ...clipMetadata.clip, loop: true, loopVideoCrossfade: 0, loopAudioCrossfade: .75 } }))!;
    const restored = restoreClip(metadata, assetId, 4)!;
    expect(restored.node).toMatchObject({ loopVideoCrossfade: 0, loopAudioCrossfade: .75 });
    const origin = captureClipOrigin(restored.item, undefined, graph([restored.node]), [restored.item]);
    expect(origin.clip).toMatchObject({ loopVideoCrossfade: 0, loopAudioCrossfade: .75 });
  });
  it('retains Turbo when restoring a generated MP4 and its submitted settings', () => {
    const metadata = parseClipMetadata(serializeClipMetadata({ ...clipMetadata, settings: { ...clipMetadata.settings, turbo: true } }))!;
    const restored = restoreClip(metadata, assetId, 4)!;
    expect(restored.item.turbo).toBe(true);
    expect(restored.item.generationSettings?.turbo).toBe(true);
  });
  it('keeps image provenance from a standalone MP4 without requiring absent image assets', () => {
    const metadata = { ...clipMetadata, settings: { ...clipMetadata.settings, imageReferences: [{ assetId: crypto.randomUUID(), name: 'Character.jpg' }] } };
    const restored = restoreClip(metadata, assetId, 4)!;
    expect(restored.item.imageReferences).toBeUndefined(); expect(restored.item.generationSettings?.imageReferences).toBeUndefined();
    expect(restored.item.result?.metadata?.settings.imageReferences).toEqual(metadata.settings.imageReferences);
  });
  it('restores settings and matching reference ranges while leaving imported scenes disconnected', () => {
    const a = restoreClip(clipMetadata, assetId, 4)!, b = restoreClip(clipMetadata, assetId, 4)!;
    expect(a.node.id).not.toBe(b.node.id); expect(a.item.id).not.toBe(b.item.id);
    expect(a.item).toMatchObject({ phase: 'ready', prompt: clipMetadata.settings.prompt, generationSettings: { ...clipMetadata.settings, maskInjection: 'standard' }, result: { start: 1, duration: 2, totalDuration: 4 } });
    expect(a.item.requestId).toBeUndefined();
    const next = graph([source('before'), source('after'), a.node]);
    resolveClipReferences(next, [a.item], [a.item]);
    expect(next.edges).toEqual([]);
    expect(a.item.result?.reference?.before?.assetId).toBe(clipMetadata.references.before!.assetId);
    expect(a.item.result?.reference?.after?.assetId).toBe(clipMetadata.references.after!.assetId);
    expect(restoreClip(clipMetadata, assetId, 3)).toBeUndefined();
  });
  it('leaves unmatched or ambiguous references unresolved and preserves existing connections', () => {
    const a = restoreClip(clipMetadata, assetId, 4)!, before = source('before'), after = source('after');
    const wrong = { ...before, source: { ...before.source!, outFrame: 95 } };
    resolveClipReferences(graph([wrong, a.node]), [a.item], [a.item]);
    expect(a.item.result?.reference?.before).toBeUndefined();
    const occupied = { ...graph([before, after, a.node]), edges: [{ id: 'existing', from: before.id, to: after.id, event: 'next' as const, label: 'Next', values: [] }] };
    const originalEdges = structuredClone(occupied.edges);
    resolveClipReferences(occupied, [a.item], [a.item]);
    expect(occupied.edges).toEqual(originalEdges);
    const ambiguous = graph([{ ...before, id: 'copy-1' }, { ...before, id: 'copy-2' }, a.node]);
    resolveClipReferences(ambiguous, [a.item], [a.item]);
    expect(a.item.result?.reference?.before).toBeUndefined();
    expect(ambiguous.edges).toEqual([]);
  });
  it('keeps absent references as provenance through archive save/reopen without requiring their media', async () => {
    const restored = restoreClip(clipMetadata, assetId, 4)!;
    const project: Project = { id: 'portable', name: 'Portable', updatedAt: 1, source: { name: 'Portable' }, interstitials: [restored.item],
      storyFlow: graph([restored.node]), subtitle: null, analysis: emptyAnalysis() };
    expect(assetIds(project)).toEqual([assetId]);
    const signal = new AbortController().signal;
    const archive = await packProject(project, [{ id: assetId, name: 'generated.mp4', blob: new Blob(['media']) }], signal, () => undefined);
    const reopened = await unpackProject(archive, signal, () => undefined);
    expect(reopened.project.interstitials[0].result?.metadata).toEqual(clipMetadata);
    expect(reopened.project.interstitials[0].result?.assetId).not.toBe(assetId);
    expect(reopened.project.interstitials[0].result?.reference).toEqual({ mode: 'custom', before: undefined, after: undefined });
  });
  it('finds the original parent after repeated project opens without matching a replaced source', async () => {
    const before = source('before'), after = source('after');
    let project: Project = { id: 'portable', name: 'Portable', updatedAt: 1, source: { name: 'Parent video', assetId: before.source!.assetId },
      interstitials: [], storyFlow: graph([before, after, { ...after, id: 'another-section', source: { ...after.source!, inFrame: 120, outFrame: 180 } }]),
      subtitle: null, analysis: emptyAnalysis() };
    let assets = [before, after].map(node => ({ id: node.source!.assetId, name: node.name, blob: new Blob(['media']) }));
    const signal = new AbortController().signal;
    for (let i = 0; i < 3; i++) {
      ({ project, assets } = await unpackProject(await packProject(project, assets, signal, () => undefined), signal, () => undefined));
      const restored = restoreClip(clipMetadata, assetId, 4)!, next = { ...project.storyFlow!, nodes: [...project.storyFlow!.nodes, restored.node] };
      resolveClipReferences(next, [restored.item], [restored.item], project.assetAliases);
      for (const side of ['before', 'after'] as const) {
        const saved = clipMetadata.references[side]!, actual = restored.item.result!.reference![side]!;
        expect(actual).toEqual({ sceneId: saved.sceneId, assetId: project.assetAliases![saved.assetId], inFrame: saved.inFrame, outFrame: saved.outFrame });
        expect(actual.assetId).not.toBe(saved.assetId);
      }
      expect(restored.item.result!.metadata).toEqual(clipMetadata);
      expect(next.edges).toEqual([]);
      // A reused scene ID / name is insufficient when its media has been replaced.
      next.nodes = next.nodes.map(node => node.id === after.id ? { ...node, source: { ...node.source!, assetId: crypto.randomUUID() } } : node);
      resolveClipReferences(next, [restored.item], [restored.item], project.assetAliases);
      expect(restored.item.result!.reference!.after).toBeUndefined();
    }
  });
});
