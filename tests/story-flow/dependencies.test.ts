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
