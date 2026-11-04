import { describe, expect, it } from 'vitest';
import { createNode, edge, type StoryGraph, type StoryNode } from '../../src/features/story-flow/model';
import { storyDependency } from '../../src/features/story-flow/dependencies';
import { storyGenerationItem } from '../../src/features/story-flow/referenceInputs';
import { referenceTiming } from '../../src/features/call-response/generation';
import { hasUnsubmittedChanges, interstitialSettings } from '../../shared/interstitials';
import { comfyReferenceRange } from '../../shared/comfy';
import { captureTemplate, instantiateTemplate } from '../../src/features/story-flow/templates';
import { storyTemplateSchema } from '../../src/features/story-flow/schema';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { emptyAnalysis, type Project } from '../../src/features/project/types';

const source = (id: string): StoryNode => ({ id, name: id, kind: 'source', x: 0, y: 0, loopCount: 0, source: { assetId: crypto.randomUUID(), inFrame: 24, outFrame: 240 } });
const setup = () => {
  const a = source('input'), b = source('output'), other = source('unrelated'), { node, item } = createNode('simple', other.id);
  const graph: StoryGraph = { version: 1, entryId: a.id, nodes: [a, b, other, node], edges: [edge(a.id, node.id), edge(node.id, b.id)], templates: [] };
  const dependency = () => storyDependency(graph, [item], a.source!.assetId, 10, item.id);
  return { a, b, other, node, item, graph, dependency };
};

describe('connected reference switches', () => {
  it('reports both missing endpoints and removes errors when references are disabled', () => {
    const { graph, item, dependency } = setup();
    item.startReferenceType = item.endReferenceType = 'video'; graph.edges = [];
    expect(dependency().issues).toMatchObject([{ side: 'start', message: expect.stringContaining('incoming') }, { side: 'end', message: expect.stringContaining('following') }]);
    expect(dependency().blocked).toBe(dependency().issues![0].message);
    item.startReferenceType = item.endReferenceType = 'none';
    expect(dependency()).toMatchObject({ issues: [], blocked: undefined });
  });
  it('reports one actionable loop error instead of duplicating the end reference', () => {
    const { graph, node, item, dependency } = setup(); node.loop = true; graph.edges = [];
    expect(dependency().issues).toHaveLength(1);
    expect(dependency().issues![0]).toMatchObject({ side: 'start', title: 'Loop reference' });
    item.startReferenceType = 'image';
    expect(dependency().issues).toHaveLength(1);
    expect(dependency().issues![0].message).toContain('Add an image');
  });
  it('identifies ambiguous inputs and dangling connections without choosing footage', () => {
    const { graph, node, item, other, dependency } = setup();
    graph.edges.push(edge(other.id, node.id));
    expect(dependency().issues![0].message).toContain('2 are connected');
    graph.edges = [edge('deleted-clip', node.id)]; item.endReferenceType = 'none';
    expect(dependency().issues![0].message).toContain('no longer exists');
    expect(dependency().reference?.before).toBeUndefined();
  });
  it('distinguishes unfinished, generating and stale reference videos', () => {
    const { graph, a, node, item } = setup(), upstream = createNode('simple');
    graph.nodes.push(upstream.node); graph.edges = [edge(upstream.node.id, node.id)]; item.endReferenceType = 'none';
    const dependency = () => storyDependency(graph, [item, upstream.item], a.source!.assetId, 10, item.id);
    expect(dependency().blocked).toContain('no video output yet');
    upstream.item.phase = 'rendering'; expect(dependency().blocked).toContain('Wait for');
    upstream.item.phase = 'ready'; upstream.item.result = { assetId: 'render', url: 'blob:render', start: 0, duration: 4, totalDuration: 4,
      reference: { before: { sceneId: a.id, assetId: 'old-source', inFrame: 24, outFrame: 240 } } };
    expect(dependency().blocked).toContain('Regenerate');
  });
  it('reports missing files for connected footage and every image sent to generation', () => {
    const { graph, a, item } = setup();
    item.endReferenceType = 'image'; item.endImageIndex = 0;
    item.imageReferences = [{ assetId: 'endpoint', name: 'End pose' }, { assetId: 'style', name: 'Style image' }];
    const unavailable = (id: string) => [a.source!.assetId, 'endpoint', 'style'].includes(id) ? 'File is missing. Restore or replace it.' : undefined;
    const dependency = storyDependency(graph, [item], a.source!.assetId, 10, item.id, unavailable);
    expect(dependency.issues).toHaveLength(3);
    expect(dependency.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ side: 'start', message: expect.stringContaining('input') }),
      expect.objectContaining({ side: 'end', message: expect.stringContaining('End pose') }),
      expect.objectContaining({ title: 'Picture 2', message: expect.stringContaining('Style image') }),
    ]));
    expect(storyDependency(graph, [item], a.source!.assetId, 10, item.id).issues).toEqual([]);
  });
  it('checks arbitrary video inputs independently, including invalid ranges', () => {
    const { graph, a, item, dependency } = setup();
    item.startReferenceType = item.endReferenceType = 'video'; item.useStartVideoAsset = item.useEndVideoAsset = true;
    expect(dependency().issues?.map(issue => issue.side)).toEqual(['start', 'end']);
    item.startVideoAsset = { assetId: 'missing', name: 'Reference.mp4', inFrame: 30, outFrame: 20 };
    item.endReferenceType = 'none';
    const checked = storyDependency(graph, [item], a.source!.assetId, 10, item.id, () => 'File is missing.');
    expect(checked.issues).toMatchObject([{ side: 'start', message: expect.stringContaining('File is missing') }, { side: 'start', message: expect.stringContaining('range') }]);
    item.startReferenceType = 'none';
    expect(storyDependency(graph, [item], a.source!.assetId, 10, item.id, () => 'File is missing.').issues).toEqual([]);
  });
  it.each(['simple', 'looped', 'conditional'] as const)('supports %s clips from scratch with explicit reference types', kind => {
    const { node, item } = createNode(kind);
    Object.assign(item, { startReferenceType: 'none', endReferenceType: 'none' });
    const graph: StoryGraph = { version: 1, entryId: node.id, nodes: [node], edges: [], templates: [] };
    expect(storyDependency(graph, [item], '', 0, item.id).blocked).toBeUndefined();
    expect(storyGenerationItem(item, node)).toMatchObject({ useInputReference: false, useOutputReference: false });
    item.startReferenceType = 'image';
    expect(storyDependency(graph, [item], '', 0, item.id).blocked).toContain('Add an image');
    item.imageReferences = [{ assetId: crypto.randomUUID(), name: 'pose.jpg' }];
    expect(storyDependency(graph, [item], '', 0, item.id).blocked).toBeUndefined();
    const prepared = storyGenerationItem(item, node);
    expect(prepared.startImageIndex).toBe(0);
    expect(prepared.endImageIndex).toBe(kind === 'looped' ? 0 : undefined);
    item.startReferenceType = 'none';
    expect(storyGenerationItem(item, node).startImageIndex).toBeUndefined();
  });
  it('reuses the incoming reference for a loop regardless of outgoing destinations or an old end range', () => {
    const { graph, node, item, other, dependency } = setup();
    node.loop = true; item.start_range = 2; item.end_range = 4; item.useOutputReference = false;
    graph.edges.push(edge(node.id, other.id, 'answer'));
    const { reference, blocked } = dependency(), prepared = storyGenerationItem(item, node);
    expect(blocked).toBeUndefined(); expect(reference!.mode).toBe('loop');
    expect(reference!.after).toEqual(reference!.before);
    expect(reference!.before!.sceneId).toBe('input');
    expect(prepared).toMatchObject({ method: 'comfy-loop', useInputReference: true, useOutputReference: true, start_range: 2, end_range: 2 });
    const timing = referenceTiming(prepared, reference!);
    const plan = comfyReferenceRange({ ...prepared, time: timing.time }, timing.duration).plan;
    expect(plan.prefixFrames).toBe(plan.suffixFrames);
    node.loop = false;
    expect(storyGenerationItem(item, node)).toMatchObject({ useOutputReference: false, end_range: 4, method: 'comfy-extend' });
  });
  it('allows a prompt-only loop and keeps image-only loop provenance', () => {
    const { node, item, dependency } = setup(); node.loop = true; item.useInputReference = false;
    expect(dependency().blocked).toBeUndefined();
    item.imageReferences = [{ assetId: crypto.randomUUID(), name: 'pose.jpg' }];
    expect(dependency()).toMatchObject({ blocked: undefined, reference: { mode: 'loop' } });
    const prepared = storyGenerationItem(item, node), reference = dependency().reference!;
    expect(referenceTiming(prepared, reference)).toEqual({ before: 0, after: 0, time: 0, duration: 0 });
    item.phase = 'ready'; item.result = { url: 'asset:render', assetId: 'render', start: 0, duration: 6, totalDuration: 6, reference };
    expect(dependency().stale).toBe(false);
    node.loop = false; expect(dependency().stale).toBe(true);
  });
  it.each([[true, true], [true, false], [false, true], [false, false]])('uses only enabled footage (input %s, output %s)', (input, output) => {
    const { a, b, item, dependency } = setup();
    item.useInputReference = input; item.useOutputReference = output;
    const result = dependency(), ref = result.reference!;
    expect(result.blocked).toBeUndefined();
    expect(ref.before?.sceneId).toBe(input ? a.id : undefined); expect(ref.after?.sceneId).toBe(output ? b.id : undefined);
    const timing = referenceTiming(item, ref), prepared = storyGenerationItem(item);
    const plan = comfyReferenceRange({ ...prepared, time: timing.time }, timing.duration || 10).plan;
    expect(plan.prefixFrames > 0).toBe(input); expect(plan.suffixFrames > 0).toBe(output);
  });
  it('follows a rewired input and ignores the old reference ID', () => {
    const { graph, other, item, dependency } = setup();
    expect(dependency().reference?.before?.sceneId).toBe('input');
    graph.edges[0].from = other.id;
    expect(dependency().reference?.before?.sceneId).toBe('unrelated');
    graph.edges.shift(); expect(dependency().blocked).toContain('Connect an incoming');
    item.useInputReference = false; expect(dependency().blocked).toBeUndefined();
  });
  it('does not silently pick one of several destinations or reference a self-loop', () => {
    const { graph, node, item, other, dependency } = setup();
    item.useOutputReference = true;
    graph.edges.push(edge(node.id, node.id, 'fallback')); expect(dependency().blocked).toBeUndefined();
    graph.edges.push(edge(node.id, other.id, 'answer')); expect(dependency().blocked).toContain('one connected clip');
    item.useOutputReference = false; expect(dependency().blocked).toBeUndefined();
  });
  it('retains submitted references when switches change, and reports edits', () => {
    const { item, dependency } = setup();
    item.generationSettings = interstitialSettings(storyGenerationItem(item));
    item.phase = 'ready'; item.result = { url: 'asset:render', assetId: 'render', start: 2, duration: 6, totalDuration: 8, reference: dependency().reference };
    expect(dependency().stale).toBe(false);
    item.useInputReference = false;
    expect(dependency().stale).toBe(true); expect(item.result.reference?.before?.sceneId).toBe('input');
    expect(hasUnsubmittedChanges(storyGenerationItem(item))).toBe(true);
  });
  it('keeps switches in captured and inserted templates', () => {
    const { graph, node, item } = setup(); item.useInputReference = false; item.useOutputReference = true;
    const template = storyTemplateSchema.parse(captureTemplate(graph, [node.id], [item], 'Output only'));
    expect(instantiateTemplate(graph, template, [item]).items[0]).toMatchObject({ useInputReference: false, useOutputReference: true });
  });
  it.each([true, false])('archives optional input provenance and restores switches (output %s)', async output => {
    const { graph, item, dependency, a, b } = setup();
    item.useInputReference = false; item.useOutputReference = output;
    item.generationSettings = interstitialSettings(storyGenerationItem(item));
    const renderId = crypto.randomUUID();
    item.phase = 'ready'; item.result = { url: `asset:${renderId}`, assetId: renderId, start: 0, duration: 6, totalDuration: output ? 8 : 6, reference: dependency().reference };
    const project: Project = { id: 'archive', name: 'References', updatedAt: 1, source: { name: 'Input', assetId: a.source!.assetId }, storyFlow: graph, interstitials: [item], subtitle: null, analysis: emptyAnalysis() };
    const assets = [...graph.nodes.flatMap(n => n.source ? [n.source.assetId] : []), renderId].map(id => ({ id, name: 'clip.mp4', blob: new Blob(['video'], { type: 'video/mp4' }) }));
    const signal = new AbortController().signal, restored = await unpackProject(await packProject(project, assets, signal, () => {}), signal, () => {});
    const saved = restored.project.interstitials[0];
    expect(saved).toMatchObject({ useInputReference: false, useOutputReference: output });
    expect(saved.result!.reference!.before).toBeUndefined();
    expect(!!saved.result!.reference!.after).toBe(output);
    if (output) expect(saved.result!.reference!.after!.assetId).toBe(restored.project.storyFlow!.nodes.find(n => n.id === b.id)!.source!.assetId);
  });
});
