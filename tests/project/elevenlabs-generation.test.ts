import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newAssetGeneration, type AssetGeneration } from '../../shared/asset-generation';
import type { ProjectCharacter } from '../../shared/characters';
import { ClipGenerationController } from '../../src/features/project/ClipGenerationController';
import type { ProjectController } from '../../src/features/project/ProjectController';
import { emptyAnalysis, type Project } from '../../src/features/project/types';

vi.mock('../../src/features/project/assets', () => ({ assets: { save: vi.fn(async () => ({ id: crypto.randomUUID() })), open: vi.fn(async () => ({})), error: () => undefined } }));
vi.mock('../../src/features/project/libraryFiles', () => ({ inspectAsset: vi.fn(async () => ({ duration: 2.5 })) }));

const mara: ProjectCharacter = { id: crypto.randomUUID(), name: 'Mara', voice: { id: 'VoiceMara0001', name: 'Mara' } };
const theo: ProjectCharacter = { id: crypto.randomUUID(), name: 'Theo', voice: { id: 'VoiceTheo0001', name: 'Theo' } };
function setup(generation: AssetGeneration, characters: ProjectCharacter[] = [mara, theo]) {
  let project = { id: 'project', name: 'Audio', updatedAt: 0, source: { name: 'Empty' }, subtitle: null, analysis: emptyAnalysis(), interstitials: [], characters, clipGenerations: [generation],
    storyFlow: { version: 1, entryId: 'node', edges: [], templates: [], nodes: [{ id: 'node', name: 'Line', kind: 'source', mediaKind: 'audio', generationId: generation.id, duration: 5, volume: 1, loopCount: 0, x: 0, y: 0 }] } } as unknown as Project;
  const listeners = new Set<() => void>();
  const projects = { getSnapshot: () => ({ project }), subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    editAssets: vi.fn((change: (p: Project) => Project) => { project = change(project); listeners.forEach(listener => listener()); }) };
  return { controller: new ClipGenerationController(projects as unknown as ProjectController), project: () => project, projects };
}
const dialogue = (prompt: string) => { const g = newAssetGeneration('audio'); g.settings.prompt = prompt; return g; };
beforeEach(() => { vi.stubGlobal('sessionStorage', { getItem: () => null }); vi.stubGlobal('window', { dispatchEvent: vi.fn(), setTimeout, clearTimeout }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('direct ElevenLabs generation', () => {
  it('submits each speaker’s voice, saves the streamed audio as a version and leaves the draft unchanged', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('mp3', { headers: { 'content-type': 'audio/mpeg' } }));
    vi.stubGlobal('fetch', fetcher);
    const generation = dialogue('Mara: Did you hear that?\nTheo: Just the wind.'), { controller, project } = setup(generation);
    await controller.generate(generation.id);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('/api/elevenlabs/audio');
    expect(init?.headers).toMatchObject({ 'x-sparko-request': '1', 'Content-Type': 'application/json' });
    const voices = [{ speaker: 'Mara', voiceId: 'VoiceMara0001', voiceName: 'Mara' }, { speaker: 'Theo', voiceId: 'VoiceTheo0001', voiceName: 'Theo' }];
    expect(JSON.parse(String(init?.body)).settings).toMatchObject({ model: 'elevenlabs-dialogue', dialogueVoices: voices });
    const saved = project().clipGenerations![0];
    expect(saved).toMatchObject({ phase: 'ready', submitted: { dialogueVoices: voices } });
    expect(saved.settings).not.toHaveProperty('dialogueVoices');
    expect(saved.versions[0].settings.dialogueVoices).toEqual(voices);
    expect(project().library?.[0]).toMatchObject({ kind: 'audio', duration: 2.5, generation: { provider: 'fal', settings: { model: 'elevenlabs-dialogue' } } });
    expect(project().storyFlow!.nodes[0].source).toMatchObject({ assetId: saved.selectedAssetId, kind: 'audio' });
  });
  it('explains a speaker without a voice before calling the server', async () => {
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
    const generation = dialogue('Theo: Hello?'), { controller, project } = setup(generation, [{ ...theo, voice: undefined }]);
    await controller.generate(generation.id);
    expect(fetcher).not.toHaveBeenCalled();
    expect(project().clipGenerations![0]).toMatchObject({ phase: 'draft', error: expect.stringContaining('Theo has no voice yet') });
  });
  it('shows server errors and cancels an in-flight request without an error', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'Your ElevenLabs account does not have enough credits for this request.' }, { status: 402 })));
    const generation = dialogue('Mara: Hi.'), first = setup(generation);
    await first.controller.generate(generation.id);
    expect(first.project().clipGenerations![0]).toMatchObject({ phase: 'error', error: 'Your ElevenLabs account does not have enough credits for this request.' });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))));
    const second = setup(dialogue('Mara: Hi.')), id = second.project().clipGenerations![0].id, running = second.controller.generate(id);
    expect(second.project().clipGenerations![0].phase).toBe('rendering');
    await second.controller.cancel(id); await running;
    expect(second.project().clipGenerations![0]).toMatchObject({ phase: 'cancelled' });
    expect(second.project().clipGenerations![0].error).toBeUndefined();
  });
  it('moves drafts from retired fal audio models to ElevenLabs while keeping submitted jobs and versions', () => {
    const stable = newAssetGeneration('audio'), sfx = newAssetGeneration('audio');
    Object.assign(stable.settings, { model: 'stable-audio-2.5', duration: 190, autoDuration: undefined, prompt: 'Ambient pads' });
    Object.assign(sfx.settings, { model: 'sound-effects', duration: 22, autoDuration: undefined, prompt: 'Door slam' });
    sfx.submitted = { ...sfx.settings }; sfx.requestId = 'request_123'; sfx.phase = 'error';
    const { controller, project, projects } = setup(stable);
    projects.editAssets(p => ({ ...p, clipGenerations: [...p.clipGenerations!, sfx] }));
    const stop = controller.watch();
    const [music, effects] = project().clipGenerations!;
    expect(music.settings).toMatchObject({ model: 'elevenlabs-music', duration: 190, prompt: 'Ambient pads' });
    expect(effects.settings).toMatchObject({ model: 'elevenlabs-sound-effects', duration: 22 });
    expect(effects.submitted?.model).toBe('sound-effects');
    stop();
  });
});
