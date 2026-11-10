import { describe, expect, it } from 'vitest';
import { activeAudioLayers, audioLayersSchema, type AudioLayer } from '../../src/features/project/audioLayers';
import { ProjectHistory } from '../../src/features/project/ProjectHistory';
import { assetIds, emptyAnalysis, type Project } from '../../src/features/project/types';
import { assetUsage } from '../../src/features/project/assetUsage';
import { packProject, unpackProject } from '../../src/features/project/archive';

const assetId = crypto.randomUUID();
const layer = (patch: Partial<AudioLayer> = {}): AudioLayer => ({ id: crypto.randomUUID(), assetId, name: 'Music.wav', startFrame: 24, inFrame: 48, outFrame: 120, volume: .5, muted: false, ...patch });
const project = (audioLayers: AudioLayer[] = []): Project => ({ id: 'project', name: 'Soundtrack', updatedAt: 1, source: { name: 'Empty' }, storyFlow: { version: 1, entryId: '', nodes: [], edges: [], templates: [] }, interstitials: [], subtitle: null, analysis: emptyAnalysis(), audioLayers });

describe('project audio layers', () => {
  it('mixes overlapping placements independently, with source trims and exclusive end points', () => {
    const a = layer(), b = layer({ startFrame: 48, inFrame: 0, outFrame: 48 });
    expect(activeAudioLayers([a, b], .999)).toEqual([]);
    expect(activeAudioLayers([a, b], 1)).toEqual([{ layer: a, time: 2, end: 5 }]);
    expect(activeAudioLayers([a, b], 2.125)).toEqual([{ layer: a, time: 3.125, end: 5 }, { layer: b, time: .125, end: 2 }]);
    expect(activeAudioLayers([a, b], 4)).toEqual([]);
    expect(activeAudioLayers([a, { ...b, muted: true }, layer({ volume: 0 })], 2)).toHaveLength(1);
  });
  it('rejects invalid timing, invalid gains and duplicate identities while permitting repeated sources', () => {
    const a = layer();
    expect(audioLayersSchema.safeParse([a, layer()]).success).toBe(true);
    for (const patch of [{ inFrame: 120 }, { startFrame: -1 }, { startFrame: .5 }, { volume: Infinity }, { volume: 2 }]) expect(audioLayersSchema.safeParse([{ ...a, ...patch }]).success).toBe(false);
    expect(audioLayersSchema.safeParse([a, a]).success).toBe(false);
  });
  it('retains layers and source files in portable archives, remapping repeated references together', async () => {
    const before = project([layer(), layer({ startFrame: 12, volume: .2, muted: true })]);
    const signal = new AbortController().signal;
    const archive = await packProject(before, [{ id: assetId, name: 'Music.wav', blob: new Blob(['audio'], { type: 'audio/wav' }) }], signal, () => {});
    const restored = await unpackProject(archive, signal, () => {});
    const remapped = restored.assets[0].id;
    expect(remapped).not.toBe(assetId);
    expect(restored.project.audioLayers).toEqual(before.audioLayers!.map(layer => ({ ...layer, assetId: remapped })));
    expect(assetIds(restored.project)).toEqual([remapped]);
    expect(assetUsage(restored.project, [remapped])).toContainEqual({ owner: 'Music.wav', role: 'Project audio layer' });
  });
  it('undoes additions, edits and removals without losing other layers', () => {
    const history = new ProjectHistory(), a = layer(), b = layer();
    const before = project([a]), added = project([a, b]), edited = project([a, { ...b, volume: .2, startFrame: 96 }]);
    history.record(before, added); history.record(added, edited);
    expect(history.target('undo')?.audioLayers).toEqual([a, b]); history.commit('undo');
    expect(history.target('redo')?.audioLayers).toEqual(edited.audioLayers);
    history.commit('redo'); history.record(edited, project([a]));
    expect(history.target('undo')?.audioLayers).toEqual(edited.audioLayers);
  });
});
