import { describe, expect, it } from 'vitest';
import { restoreClip, reconnectClipReferences } from '../../src/features/interstitials/clipMetadata';
import type { StoryGraph, StoryNode } from '../../src/features/story-flow/model';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { assetIds, emptyAnalysis, type Project } from '../../src/features/project/types';
import { clipMetadata } from '../fixtures/clip-metadata';
const assetId = '44444444-4444-4444-8444-444444444444';
const source = (side: 'before' | 'after'): StoryNode => { const ref = clipMetadata.references[side]!; return { id: ref.sceneId, name: ref.name, kind: 'source', source: { assetId: ref.assetId, inFrame: ref.inFrame, outFrame: ref.outFrame }, x: 0, y: 0, loopCount: 0 }; };
const graph = (nodes: StoryNode[]): StoryGraph => ({ version: 1, entryId: nodes[0].id, nodes, edges: [], templates: [] });
describe('restoring generated clips', () => {
  it('keeps image provenance from a standalone MP4 without requiring absent image assets', () => {
    const metadata = { ...clipMetadata, settings: { ...clipMetadata.settings, imageReferences: [{ assetId: crypto.randomUUID(), name: 'Character.jpg' }] } };
    const restored = restoreClip(metadata, assetId, 4)!;
    expect(restored.item.imageReferences).toBeUndefined(); expect(restored.item.generationSettings?.imageReferences).toBeUndefined();
    expect(restored.item.result?.metadata?.settings.imageReferences).toEqual(metadata.settings.imageReferences);
  });
  it('restores editable settings and body boundaries, allocates fresh IDs, and reconnects matching source ranges', () => {
    const a = restoreClip(clipMetadata, assetId, 4)!, b = restoreClip(clipMetadata, assetId, 4)!;
    expect(a.node.id).not.toBe(b.node.id); expect(a.item.id).not.toBe(b.item.id);
    expect(a.item).toMatchObject({ phase: 'ready', prompt: clipMetadata.settings.prompt, generationSettings: clipMetadata.settings, result: { start: 1, duration: 2, totalDuration: 4 } });
    expect(a.item.requestId).toBeUndefined();
    const next = reconnectClipReferences(graph([source('before'), source('after'), a.node]), [a.item], [a.item]);
    expect(next.edges.map(e => [e.from, e.to])).toEqual([['opening', a.node.id], [a.node.id, 'ending']]);
    expect(a.item.result?.reference?.before?.assetId).toBe(clipMetadata.references.before!.assetId);
    expect(restoreClip(clipMetadata, assetId, 3)).toBeUndefined();
  });
  it('does not guess by filenames, connect ambiguous ranges or overwrite an occupied output', () => {
    const a = restoreClip(clipMetadata, assetId, 4)!, before = source('before'), after = source('after');
    const wrong = { ...before, source: { ...before.source!, outFrame: 95 } };
    expect(reconnectClipReferences(graph([wrong, a.node]), [a.item], [a.item]).edges).toEqual([]);
    const occupied = { ...graph([before, after, a.node]), edges: [{ id: 'existing', from: before.id, to: after.id, event: 'next' as const, label: 'Next', values: [] }] };
    const next = reconnectClipReferences(occupied, [a.item], [a.item]);
    expect(next.edges.filter(e => e.from === before.id)).toEqual(occupied.edges);
    const ambiguous = graph([{ ...before, id: 'copy-1' }, { ...before, id: 'copy-2' }, a.node]);
    expect(reconnectClipReferences(ambiguous, [a.item], [a.item]).edges).toEqual([]);
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
});
