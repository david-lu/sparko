import { describe, expect, it } from 'vitest';
import { createNode, edge, nodeDuration, runtimeFlow, splitClip, type StoryGraph, type StoryNode } from '../../src/features/story-flow/model';
import { storyDependency } from '../../src/features/story-flow/dependencies';
import { trimClip } from '../../src/features/story-flow/trimming';
import { referenceClips, referenceWindow } from '../../shared/reference-clips';
import { referenceTiming } from '../../src/features/call-response/generation';
import { captureClipOrigin } from '../../src/features/interstitials/clipMetadata';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { assetIds, emptyAnalysis, type Project } from '../../src/features/project/types';
import { assetUsage } from '../../src/features/project/assetUsage';

const source = (id: string, seconds: number, image = false): StoryNode => ({ id, name: id, kind: 'source', x: 0, y: 0, loopCount: 0,
  source: { assetId: crypto.randomUUID(), inFrame: 24, outFrame: 24 + seconds * 24, ...(image ? { kind: 'image' } : { duration: seconds + 1 }) } });
function setup() {
  const a = source('earlier', 3), b = source('previous', 2, true), c = source('following', 1), d = source('later', 4, true);
  const { node, item } = createNode('simple'); Object.assign(item, { start_range: 4, end_range: 4, startReferenceType: 'video', endReferenceType: 'video' });
  const graph: StoryGraph = { version: 1, entryId: a.id, nodes: [a, b, node, c, d], edges: [edge(a.id, b.id), edge(b.id, node.id), edge(node.id, c.id), edge(c.id, d.id)], templates: [] };
  const dependency = () => storyDependency(graph, [item], a.source!.assetId, 4, item.id);
  return { a, b, c, d, node, item, graph, dependency };
}

describe('reference sequences and still clips', () => {
  it('fills both windows across connected clips and crops only the outside boundaries', () => {
    const { dependency, item } = setup(), { reference, blocked } = dependency();
    expect(blocked).toBeUndefined();
    expect(reference!.before?.sceneId).toBe('previous'); expect(reference!.after?.sceneId).toBe('following');
    expect(referenceWindow(referenceClips(reference, 'before'), 96, 'before')).toMatchObject([
      { sceneId: 'earlier', inFrame: 48, outFrame: 96 }, { sceneId: 'previous', inFrame: 24, outFrame: 72, kind: 'image' },
    ]);
    expect(referenceWindow(referenceClips(reference, 'after'), 96, 'after')).toMatchObject([
      { sceneId: 'following', inFrame: 24, outFrame: 48 }, { sceneId: 'later', inFrame: 24, outFrame: 96, kind: 'image' },
    ]);
    expect(referenceTiming(item, reference!)).toEqual({ before: 96, after: 96, time: 4, duration: 8 });
  });
  it('checks every contributing asset and ignores clips outside the requested window', () => {
    const { graph, a, item } = setup();
    const check = () => storyDependency(graph, [item], '', 0, item.id, id => id === a.source!.assetId ? 'Missing earlier video' : undefined);
    expect(check().blocked).toContain('Missing earlier video');
    item.start_range = 2; expect(check().blocked).toBeUndefined(); expect(check().reference?.beforeClips).toBeUndefined();
  });
  it('stops at the available boundary and never repeats a cycle to fill footage', () => {
    const { a, b, graph, item, dependency } = setup();
    a.source!.outFrame = 48; graph.edges.push(edge(b.id, a.id));
    expect(dependency().blocked).toBeUndefined();
    expect(referenceTiming(item, dependency().reference!).before).toBe(72);
  });
  it('reports an ambiguous continuation only when the requested window reaches it', () => {
    const { a, b, graph, item, dependency } = setup(), extra = source('alternate', 2);
    graph.nodes.push(extra); graph.edges.push(edge(extra.id, b.id));
    expect(dependency().blocked).toContain('possible previous clips');
    item.start_range = 2; expect(dependency().blocked).toBeUndefined();
    graph.edges = graph.edges.filter(e => e.from !== extra.id && e.from !== a.id);
    item.start_range = 4; expect(referenceTiming(item, dependency().reference!).before).toBe(48);
  });
  it('marks a render stale when an earlier contributing clip changes', () => {
    const { a, item, dependency } = setup();
    item.phase = 'ready'; item.result = { assetId: crypto.randomUUID(), url: '', start: 4, duration: 6, totalDuration: 14, reference: dependency().reference };
    expect(dependency().stale).toBe(false);
    a.source!.outFrame -= 1; expect(dependency().stale).toBe(true);
    expect(item.result.reference?.beforeClips?.[0].outFrame).toBe(96);
  });
  it('retains explicit sequence order and reports edited order as stale', () => {
    const { item, dependency, a, b } = setup();
    item.useStartVideoAsset = true;
    item.startVideoAssets = [a, b].map(n => ({ ...n.source!, name: n.name }));
    expect(referenceClips(dependency().reference, 'before').map(r => r.assetId)).toEqual([a.source!.assetId, b.source!.assetId]);
    item.phase = 'ready'; item.result = { url: '', start: 4, duration: 6, totalDuration: 14, reference: dependency().reference };
    item.startVideoAssets.reverse(); expect(dependency().stale).toBe(true);
    item.startVideoAssets = []; expect(dependency().blocked).toContain('Choose videos or images');
  });
  it('extends, splits and plays an image for its chosen frame count without a media duration limit', () => {
    const image = source('still', 2, true), extended = trimClip(image, [], 'end', 24 * 60);
    expect(nodeDuration(extended, [])).toBe(59);
    const graph: StoryGraph = { version: 1, entryId: image.id, nodes: [extended], edges: [], templates: [] };
    const split = splitClip(graph, [], image.id, 240);
    expect(split.graph.nodes.map(n => n.source?.kind)).toEqual(['image', 'image']);
    expect(split.graph.nodes.reduce((sum, n) => sum + nodeDuration(n, []), 0)).toBe(59);
    expect(runtimeFlow(graph, [], '', 0).scenes[0].clip.outFrame).toBe(1440);
    expect(trimClip(image, [], 'end', 0).source!.outFrame).toBe(image.source!.inFrame + 1);
  });
  it('round-trips images, sequences, submitted provenance with remapped asset identities', async () => {
    const { graph, item, a, b, dependency } = setup();
    item.useStartVideoAsset = true; item.startVideoAssets = [a, b].map(n => ({ ...n.source!, name: n.name }));
    const reference = dependency().reference;
    item.requestReference = reference;
    item.requestOrigin = captureClipOrigin(item, reference, graph, [item]);
    expect(item.requestOrigin.references.beforeClips?.map(r => r.name)).toEqual(['earlier', 'previous']);
    const project: Project = { id: 'test', name: 'Stills', updatedAt: 0, source: { name: b.name, assetId: b.source!.assetId },
      storyFlow: graph, interstitials: [item], analysis: emptyAnalysis(), subtitle: null };
    expect(assetUsage(project, [a.source!.assetId]).map(u => u.role)).toContain('Submitted start reference');
    const media = assetIds(project).map(id => ({ id, name: id, blob: new Blob(['fixture'], { type: 'image/png' }) })), signal = new AbortController().signal;
    const reopened = await unpackProject(await packProject(project, media, signal, () => {}), signal, () => {});
    expect(reopened.project.storyFlow!.nodes.find(n => n.id === b.id)?.source?.kind).toBe('image');
    expect(reopened.project.interstitials[0].startVideoAssets?.map(r => r.kind)).toEqual([undefined, 'image']);
    expect(reopened.project.interstitials[0].requestReference?.beforeClips).toHaveLength(2);
    expect(assetIds(reopened.project).some(id => assetIds(project).includes(id))).toBe(false);
    expect(reopened.project.interstitials[0].requestReference?.beforeClips?.[0].assetId).toBe(reopened.project.interstitials[0].startVideoAssets?.[0].assetId);
  });
});
