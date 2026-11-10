import { describe, expect, it } from 'vitest';
import { TIMELINE_FPS } from '../../shared/constants';
import type { Interstitial } from '../../shared/interstitials';
import { clipAnchor, commentSceneFrame, keepComments, splitComments } from '../../src/features/story-flow/comments';
import { joinClips } from '../../src/features/story-flow/joinClips';
import { CLIP_HEIGHT, PIXELS_PER_SECOND, createNode, edge, removeNodes, splitClip, type StoryComment, type StoryGraph, type StoryNode } from '../../src/features/story-flow/model';
import { storyGraphSchema } from '../../src/features/story-flow/schema';
import { trimClip } from '../../src/features/story-flow/trimming';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { ProjectHistory } from '../../src/features/project/ProjectHistory';
import { emptyAnalysis, type Project } from '../../src/features/project/types';

const assetId = crypto.randomUUID();
const source = (id: string, inFrame = 0, outFrame = 240): StoryNode => ({ id, name: id, kind: 'source', x: 100, y: 20, loopCount: 0, source: { assetId, duration: 10, inFrame, outFrame } });
const comment = (id: string, anchor: StoryComment['anchor'], extra: Partial<StoryComment> = {}): StoryComment => ({ id, text: `Note ${id}`, createdAt: 1, anchor, ...extra });
const graphOf = (nodes: StoryNode[], comments: StoryComment[]): StoryGraph =>
  ({ version: 1, entryId: nodes[0].id, nodes, edges: nodes.slice(1).map((node, i) => edge(nodes[i].id, node.id)), templates: [], comments });
const canvasX = (node: StoryNode, frame: number) => node.x + commentSceneFrame(node, frame) / TIMELINE_FPS * PIXELS_PER_SECOND;

describe('timeline comments', () => {
  it('pin to a moment of the media, so trimming either edge never moves them', () => {
    const clip = source('clip', 24, 240), anchor = clipAnchor(clip, 48);
    expect(anchor).toEqual({ nodeId: 'clip', frame: 72 });
    const start = trimClip(clip, [], 'start', 48), end = trimClip(clip, [], 'end', 120);
    expect(commentSceneFrame(start, 72)).toBe(24);
    expect(canvasX(start, 72)).toBe(canvasX(clip, 72));
    expect(canvasX(end, 72)).toBe(canvasX(clip, 72));
    // Trimmed past the moment: still attached, reported outside the clip.
    expect(commentSceneFrame(trimClip(clip, [], 'start', 96), 72)).toBeLessThan(0);

    const { node, item } = createNode('simple'), trimmed = { ...node, trim: { inFrame: 12, outFrame: 100 } };
    expect(clipAnchor(trimmed, 6)).toEqual({ nodeId: node.id, frame: 18 });
    expect(commentSceneFrame(trimClip(trimmed, [item], 'start', 6), 18)).toBe(12);
  });

  it('follow the second half of a split clip, for imported and generated footage', () => {
    const clip = source('clip'), graph = graphOf([clip], [comment('early', { nodeId: 'clip', frame: 30 }), comment('late', { nodeId: 'clip', frame: 150 })]);
    const split = splitClip(graph, [], 'clip', 100), result = splitComments(split.graph, 'clip', split.rightId!);
    expect(result.comments).toEqual([comment('early', { nodeId: 'clip', frame: 30 }), comment('late', { nodeId: split.rightId!, frame: 150 })]);
    expect(commentSceneFrame(result.nodes.find(n => n.id === split.rightId)!, 150)).toBe(50);
    expect(storyGraphSchema.safeParse(result).success).toBe(true);

    const { node, item } = createNode('simple'), generated = graphOf([node], [comment('render', { nodeId: node.id, frame: 100 })]);
    const cut = splitClip(generated, [item], node.id, 72), moved = splitComments(cut.graph, node.id, cut.rightId!);
    expect(moved.comments![0].anchor).toEqual({ nodeId: cut.rightId, frame: 100 });
    expect(commentSceneFrame(moved.nodes.find(n => n.id === cut.rightId)!, 100)).toBe(28);
  });

  it('stay on the canvas where their pin was when their clip is deleted', () => {
    const clip = source('clip', 24), other = source('other'), canvas = comment('loose', { x: -40, y: 300 });
    const graph = graphOf([clip, other], [comment('pinned', { nodeId: 'clip', frame: 72 }), canvas, comment('kept', { nodeId: 'other', frame: 10 })]);
    const next = keepComments(graph, removeNodes(graph, ['clip']));
    expect(next.comments).toEqual([comment('pinned', { x: canvasX(clip, 72), y: clip.y + CLIP_HEIGHT }), canvas, comment('kept', { nodeId: 'other', frame: 10 })]);
    expect(storyGraphSchema.safeParse(next).success).toBe(true);
    // Unchanged graphs keep their identity, so saves stay cheap.
    expect(keepComments(graph, graph)).toBe(graph);
    // Without the previous clip, the comment is still kept somewhere visible.
    expect(keepComments(undefined, removeNodes(graph, ['clip'])).comments).toHaveLength(3);
  });

  it('move onto the joined clip at the same moment of the shared video', () => {
    const graph = graphOf([source('first', 0, 48), source('last', 48, 120)], [comment('a', { nodeId: 'first', frame: 12 }), comment('b', { nodeId: 'last', frame: 60 })]);
    const result = joinClips(graph, [], ['first', 'last']);
    if (!result.ok) throw new Error(result.reasons.join('\n'));
    expect(result.graph.comments!.map(c => c.anchor)).toEqual([{ nodeId: 'first', frame: 12 }, { nodeId: 'first', frame: 60 }]);
    expect(storyGraphSchema.safeParse(result.graph).success).toBe(true);

    // A render's comments use its body frames; a joined source clip uses the file's.
    const item: Interstitial = { id: 'render', label: 'Render', time: 0, start_range: 1, end_range: 1, duration: 4, prompt: '', enable_prompt_expansion: false, phase: 'ready',
      result: { assetId: 'render-video', url: '', start: 1, duration: 4, totalDuration: 6 } };
    const render: StoryNode = { id: 'render-clip', name: 'Render', kind: 'simple', x: 100, y: 100, loopCount: 0, interstitialId: item.id, trim: { inFrame: 24, outFrame: 96 } };
    const tail: StoryNode = { ...source('tail', 96, 144), source: { assetId: 'render-video', duration: 6, inFrame: 96, outFrame: 144 } };
    const joined = joinClips(graphOf([render, tail], [comment('r', { nodeId: 'render-clip', frame: 30 }), comment('t', { nodeId: 'tail', frame: 120 })]), [item], ['render-clip', 'tail']);
    if (!joined.ok) throw new Error(joined.reasons.join('\n'));
    const merged = joined.graph.nodes[0];
    expect(merged.source).toMatchObject({ inFrame: 48, outFrame: 144 });
    expect(joined.graph.comments!.map(c => c.anchor)).toEqual([{ nodeId: 'render-clip', frame: 54 }, { nodeId: 'render-clip', frame: 120 }]);
    expect(joined.graph.comments!.map(c => commentSceneFrame(merged, (c.anchor as { frame: number }).frame))).toEqual([6, 72]);
  });

  it('are validated, saved in project files and survive reopening', async () => {
    const clip = source('clip'), comments = [comment('pinned', { nodeId: 'clip', frame: 10 }, { resolved: true }), comment('loose', { x: 5.5, y: -12 })];
    const graph = graphOf([clip], comments);
    expect(storyGraphSchema.safeParse(graph).success).toBe(true);
    expect(storyGraphSchema.safeParse({ ...graph, comments: [comment('x', { nodeId: 'missing', frame: 0 })] }).success).toBe(false);
    expect(storyGraphSchema.safeParse({ ...graph, comments: [comments[1], comments[1]] }).success).toBe(false);
    expect(storyGraphSchema.safeParse({ ...graph, comments: [{ ...comments[1], text: '  ' }] }).success).toBe(false);
    expect(storyGraphSchema.safeParse({ ...graph, comments: [comment('x', { nodeId: 'clip', frame: -1 })] }).success).toBe(false);

    const project: Project = { id: 'comments', name: 'Comments', updatedAt: 1, source: { name: 'Video', assetId }, storyFlow: graph, interstitials: [], subtitle: null, analysis: emptyAnalysis() };
    const signal = new AbortController().signal, files = [{ id: assetId, name: 'clip.mp4', blob: new Blob(['fixture'], { type: 'video/mp4' }) }];
    const archive = await packProject(project, files, signal, () => {});
    const { BlobReader, ZipReader, TextWriter } = await import('@zip.js/zip.js');
    const entries = await new ZipReader(new BlobReader(archive)).getEntries();
    const entry = entries.find(e => e.filename === 'project.json');
    if (!entry || entry.directory) throw new Error('The archive has no manifest.');
    const manifest = JSON.parse(await entry.getData(new TextWriter()));
    // Older builds would silently drop comments, so they must refuse the file.
    expect(manifest.version).toBe(8);
    const restored = await unpackProject(archive, signal, () => {});
    expect(restored.project.storyFlow?.comments).toEqual(comments);
  });

  it('record readable undo steps and merge pin nudges', () => {
    const clip = source('clip'), base: Project = { id: 'p', name: 'P', updatedAt: 0, source: { name: 'Video', assetId }, interstitials: [], subtitle: null, analysis: emptyAnalysis(), storyFlow: graphOf([clip], []) };
    const withComments = (comments: StoryComment[]): Project => ({ ...base, storyFlow: { ...base.storyFlow!, comments } });
    const history = new ProjectHistory(), note = comment('n', { nodeId: 'clip', frame: 10 });
    const steps = [withComments([note]), withComments([{ ...note, text: 'Changed' }]), withComments([{ ...note, text: 'Changed', resolved: true }])];
    history.record(base, steps[0], 0); expect(history.undoLabel).toBe('Add comment');
    history.endGroup(); history.record(steps[0], steps[1], 10); expect(history.undoLabel).toBe('Edit comment');
    history.endGroup(); history.record(steps[1], steps[2], 20); expect(history.undoLabel).toBe('Resolve comment');
    history.endGroup();
    const nudged = (frame: number) => withComments([{ ...note, text: 'Changed', resolved: true, anchor: { nodeId: 'clip', frame } }]);
    history.record(steps[2], nudged(11), 30); history.record(nudged(11), nudged(12), 40); history.record(nudged(12), nudged(13), 50);
    expect(history.undoLabel).toBe('Move comment');
    expect(history.target('undo')?.storyFlow?.comments?.[0].anchor).toEqual({ nodeId: 'clip', frame: 10 });
    history.commit('undo'); expect(history.undoLabel).toBe('Resolve comment');
    history.record(steps[2], withComments([]), 60); expect(history.undoLabel).toBe('Delete comment');
  });
});
