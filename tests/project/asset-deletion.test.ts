import { expect, it } from 'vitest';
import { newAssetGeneration } from '../../shared/asset-generation';
import { applyAssetDeletion, planAssetDeletion } from '../../src/features/project/assetDeletion';
import { assetIds, emptyAnalysis, type Project } from '../../src/features/project/types';
import { collectLibrary } from '../../src/features/project/library';

const project = (): Project => ({ id: 'project', name: 'Project', updatedAt: 0, source: { name: 'Empty' }, subtitle: null,
  analysis: emptyAnalysis(), interstitials: [], library: [{ assetId: 'input', name: 'Input.png', kind: 'image' }] });

it('deletes a generation and its inputs together, but protects uses outside the selection', () => {
  const p = project(), generation = newAssetGeneration('image');
  generation.settings.references = [{ assetId: 'input', name: 'Input.png', kind: 'image' }];
  generation.versions = [{ assetId: 'output', name: 'Output.png', createdAt: 0, settings: structuredClone(generation.settings) }];
  p.clipGenerations = [generation];
  p.library!.push({ assetId: 'output', name: 'Output.png', kind: 'image', generationId: generation.id });
  const selection = [{ type: 'asset' as const, id: 'input' }, { type: 'generation' as const, id: generation.id }];
  expect(planAssetDeletion(p, [selection[0]]).usages).toEqual([{ owner: generation.name, role: 'image generation input' }, { owner: generation.name, role: 'Saved version input' }]);
  const batch = planAssetDeletion(p, selection);
  expect(batch.usages).toEqual([]); expect([...batch.assetIds].sort()).toEqual(['input', 'output']);
  const other = newAssetGeneration('image'); other.name = 'Other generation'; other.settings.references = [...generation.settings.references];
  p.clipGenerations.push(other);
  expect(planAssetDeletion(p, selection).usages).toEqual([{ owner: other.name, role: 'image generation input' }]);
});

it('protects generation versions used by timeline clips or templates', () => {
  const p = project(), generation = { ...newAssetGeneration('image'), kind: 'video' as const }; generation.settings.model = 'kling-video';
  generation.versions = [{ assetId: 'output', name: 'Output.mp4', createdAt: 0, settings: generation.settings }]; p.clipGenerations = [generation];
  const node = { id: 'clip', kind: 'source' as const, name: 'Opening', x: 0, y: 0, loopCount: 0, source: { assetId: 'output', inFrame: 0, outFrame: 24 } };
  p.storyFlow = { version: 1, entryId: node.id, nodes: [node], edges: [], templates: [{ id: 'template', name: 'Saved template', entryId: node.id, nodes: [node], edges: [], settings: {} }] };
  expect(planAssetDeletion(p, [{ type: 'generation', id: generation.id }]).usages).toEqual([
    { owner: 'Opening', role: 'Timeline footage' }, { owner: 'Saved template', role: 'Template footage' },
  ]);
});

it('deduplicates selections, ignores missing items and includes newly completed versions when rechecked', () => {
  const p = project(), generation = newAssetGeneration('image'); p.clipGenerations = [generation];
  const selected = [{ type: 'asset' as const, id: 'input' }, { type: 'generation' as const, id: generation.id }];
  const before = planAssetDeletion(p, [...selected, selected[0], { type: 'asset', id: 'missing' }]);
  expect(before.targets).toHaveLength(2); expect([...before.assetIds]).toEqual(['input']);
  generation.versions.push({ assetId: 'finished', name: 'Finished.png', createdAt: 0, settings: generation.settings });
  p.library!.push({ assetId: 'other-version', name: 'Other.png', kind: 'image', generationId: generation.id });
  expect([...planAssetDeletion(p, before.targets).assetIds].sort()).toEqual(['finished', 'input', 'other-version']);
});

it('excludes dependencies within an entire deleted asset chain, including orphan generation history', () => {
  const p = project(); p.storyFlow = { version: 1, entryId: '', nodes: [], edges: [], templates: [] };
  const a = newAssetGeneration('image'), b = newAssetGeneration('image');
  a.name = 'A'; b.name = 'B';
  a.settings.references = [{ assetId: 'input', name: 'Input.png', kind: 'image' }];
  b.settings.references = [{ assetId: 'a', name: 'A.png', kind: 'image' }];
  for (const [g, id] of [[a, 'a'], [b, 'b']] as const) {
    g.submitted = structuredClone(g.settings);
    g.versions = [{ assetId: id, name: `${id}.png`, createdAt: 0, settings: structuredClone(g.settings) }];
    p.library!.push({ assetId: id, name: `${id}.png`, kind: 'image', generationId: g.id, generation: { provider: 'fal', settings: structuredClone(g.settings), createdAt: 0 } });
  }
  p.clipGenerations = [a, b];
  const plan = planAssetDeletion(p, ['input', 'a', 'b'].map(id => ({ type: 'asset', id })));
  expect(plan.usages).toEqual([]);
  const deleted = applyAssetDeletion(p, plan);
  expect(deleted.clipGenerations).toEqual([]); expect(collectLibrary(deleted)).toEqual([]);
  expect(assetIds(deleted)).toEqual([]);
  p.library!.push({ assetId: 'survivor', name: 'Surviving image', kind: 'image', generation: { provider: 'fal', settings: structuredClone(b.settings), createdAt: 0 } });
  expect(planAssetDeletion(p, plan.targets).usages).toEqual([{ owner: 'Surviving image', role: 'Saved version input' }]);
});

it('keeps surviving clip references identifiable without re-adding deleted media to the Library', () => {
  const p = project(), generation = newAssetGeneration('image');
  generation.settings.references = [{ assetId: 'input', name: 'Input.png', kind: 'image' }];
  p.clipGenerations = [generation];
  p.storyFlow = { version: 1, entryId: 'clip', nodes: [{ id: 'clip', kind: 'source', name: 'Image clip', x: 0, y: 0, loopCount: 0, generationId: generation.id, source: { assetId: 'input', kind: 'image', inFrame: 0, outFrame: 24 } }], edges: [], templates: [] };
  const plan = planAssetDeletion(p, [{ type: 'asset', id: 'input' }]), deleted = applyAssetDeletion(p, plan);
  expect(plan.usages).toContainEqual({ owner: 'Image clip', role: 'Timeline footage' });
  expect(deleted.clipGenerations![0].settings.references).toEqual(generation.settings.references);
  expect(deleted.storyFlow!.nodes[0].source!.assetId).toBe('input');
  expect(collectLibrary(deleted)).toEqual([]); expect(assetIds(deleted)).toEqual([]);
});
