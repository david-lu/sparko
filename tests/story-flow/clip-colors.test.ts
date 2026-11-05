import { expect, it } from 'vitest';
import { splitClip, type StoryGraph, type StoryNode } from '../../src/features/story-flow/model';
import { storyGraphSchema } from '../../src/features/story-flow/schema';
import { captureTemplate, instantiateTemplate } from '../../src/features/story-flow/templates';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { emptyAnalysis, type Project } from '../../src/features/project/types';

it('preserves clip colors through splitting, templates and project archives, with optional colors for older projects', async () => {
  const node: StoryNode = { id: 'source', kind: 'source', name: 'Footage', color: 'rose', x: 0, y: 0, loopCount: 0,
    source: { assetId: crypto.randomUUID(), inFrame: 0, outFrame: 240 } };
  const graph: StoryGraph = { version: 1, entryId: node.id, nodes: [node], edges: [], templates: [] };
  expect(storyGraphSchema.parse(graph).nodes[0].color).toBe('rose');
  expect(storyGraphSchema.safeParse({ ...graph, nodes: [{ ...node, color: undefined }] }).success).toBe(true);
  expect(storyGraphSchema.safeParse({ ...graph, nodes: [{ ...node, color: 'invalid' }] }).success).toBe(false);
  const split = splitClip(graph, [], node.id, 120);
  expect(split?.graph.nodes.map(n => n.color)).toEqual(['rose', 'rose']);
  const template = captureTemplate(graph, [node.id], [], 'Colored footage')!;
  expect(instantiateTemplate(graph, template, []).graph.nodes.map(n => n.color)).toEqual(['rose', 'rose']);
  const project: Project = { id: 'colors', name: 'Colors', updatedAt: 1, source: { name: node.name, assetId: node.source!.assetId }, storyFlow: graph, interstitials: [], subtitle: null, analysis: emptyAnalysis() };
  const signal = new AbortController().signal;
  const packed = await packProject(project, [{ id: node.source!.assetId, name: 'clip.mp4', blob: new Blob(['fixture'], { type: 'video/mp4' }) }], signal, () => {});
  expect((await unpackProject(packed, signal, () => {})).project.storyFlow!.nodes[0].color).toBe('rose');
});
