import { expect, it } from 'vitest';
import { newAssetGeneration } from '../../shared/asset-generation';
import { planAssetDeletion } from '../../src/features/project/assetDeletion';
import { emptyAnalysis, type Project } from '../../src/features/project/types';

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
  const p = project(), generation = newAssetGeneration('video');
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
