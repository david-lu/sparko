import { describe, expect, it } from 'vitest';
import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { withoutAudioLayers } from '../../src/features/project/legacyAudioLayers';
import { assetIds, emptyAnalysis, type Project } from '../../src/features/project/types';

const music = crypto.randomUUID(), effect = crypto.randomUUID();
const layer = (assetId: string, name: string) => ({ id: crypto.randomUUID(), assetId, name, startFrame: 24, inFrame: 0, outFrame: 48, volume: .5, muted: false });
const project = (patch: Partial<Project> = {}): Project => ({ id: 'project', name: 'Soundtrack', updatedAt: 1, source: { name: 'Empty' },
  storyFlow: { version: 1, entryId: '', nodes: [], edges: [], templates: [] }, interstitials: [], subtitle: null, analysis: emptyAnalysis(), ...patch });
const signal = () => new AbortController().signal;
const files = [{ id: music, name: 'Music.wav', blob: new Blob(['music'], { type: 'audio/wav' }) }, { id: effect, name: 'Hit.wav', blob: new Blob(['hit'], { type: 'audio/wav' }) }];

/** Write an archive the way builds with project-wide audio layers did. */
async function legacyArchive(blob: Blob, modify: (manifest: any) => void) {
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false }), writer = new ZipWriter(new BlobWriter(), { level: 0, useWebWorkers: false });
  for (const entry of await reader.getEntries()) {
    if (entry.directory) continue;
    if (entry.filename === 'project.json') { const manifest = JSON.parse(await entry.getData(new TextWriter())); modify(manifest); await writer.add(entry.filename, new TextReader(JSON.stringify(manifest))); }
    else await writer.add(entry.filename, new BlobReader(await entry.getData(new BlobWriter())));
  }
  await reader.close(); return writer.close();
}
async function manifestOf(blob: Blob) {
  const entry = (await new ZipReader(new BlobReader(blob)).getEntries()).find(e => e.filename === 'project.json');
  if (!entry || entry.directory) throw new Error('The archive has no manifest.');
  return JSON.parse(await entry.getData(new TextWriter()));
}

describe('projects saved with project-wide audio layers', () => {
  it('drop the placements and keep every layer file in Library as ordinary audio', () => {
    const library = [{ assetId: music, name: 'Music.wav', kind: 'audio' as const, duration: 2 }];
    const legacy = { ...project({ library }), audioLayers: [layer(music, 'Music.wav'), layer(music, 'Music.wav'), layer(effect, 'Hit.wav')] };
    const migrated = withoutAudioLayers(legacy);
    expect('audioLayers' in migrated).toBe(false);
    expect(migrated.library).toEqual([...library, { assetId: effect, name: 'Hit.wav', kind: 'audio' }]);
    expect(assetIds(migrated).sort()).toEqual([music, effect].sort());
    // A deleted file stays deleted; projects without layers are untouched.
    expect(withoutAudioLayers({ ...project({ deletedAssetIds: [effect] }), audioLayers: [layer(effect, 'Hit.wav')] }).library).toEqual([]);
    const current = project({ library });
    expect(withoutAudioLayers(current)).toBe(current);
  });

  it('open from version 6 archives, including layer files that had no Library entry', async () => {
    const saved = await packProject(project({ library: [{ assetId: music, name: 'Music.wav', kind: 'audio', duration: 2 }] }), files, signal(), () => {});
    const archive = await legacyArchive(saved, manifest => {
      manifest.version = 6;
      manifest.project.audioLayers = [layer(music, 'Music.wav'), layer(effect, 'Hit.wav')];
    });
    const restored = await unpackProject(archive, signal(), () => {});
    expect('audioLayers' in restored.project).toBe(false);
    const ids = new Map(restored.assets.map(asset => [asset.name, asset.id]));
    expect(restored.project.library).toEqual([
      { assetId: ids.get('Music.wav'), name: 'Music.wav', kind: 'audio', duration: 2 },
      { assetId: ids.get('Hit.wav'), name: 'Hit.wav', kind: 'audio' },
    ]);
    expect(assetIds(restored.project).sort()).toEqual(restored.assets.map(asset => asset.id).sort());
  });

  it('are never written back with layers or as version 6', async () => {
    const stale = { ...project({ library: [{ assetId: music, name: 'Music.wav', kind: 'audio', duration: 2 }] }), audioLayers: [layer(music, 'Music.wav')] } as Project;
    const manifest = await manifestOf(await packProject(stale, files.slice(0, 1), signal(), () => {}));
    expect(manifest.project.audioLayers).toBeUndefined();
    expect(manifest.version).not.toBe(6);
  });
});
