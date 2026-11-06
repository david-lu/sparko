import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectController } from '../../src/features/project/ProjectController';
import { InterstitialController } from '../../src/features/interstitials/InterstitialController';
import { writeProject, readProject } from '../../src/features/project/database';
import { packProject } from '../../src/features/project/archive';
import { projectContent } from '../../src/features/project/projectContent';
import { emptyAnalysis, type Project } from '../../src/features/project/types';
import { createNode } from '../../src/features/story-flow/model';
import { interstitialSettings } from '../../shared/interstitials';
import { saveInterstitials } from '../../src/features/interstitials/storage';
import { newAssetGeneration } from '../../shared/asset-generation';

vi.mock('../../src/features/project/database', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/features/project/database')>(),
  writeProject: vi.fn(), readProject: vi.fn(), readActiveProject: vi.fn(),
  listSavedProjects: vi.fn(async () => []), listRecentFiles: vi.fn(async () => []),
  rememberRecentFile: vi.fn(), clearActiveProject: vi.fn(),
}));
vi.mock('../../src/features/project/assets', () => ({ assets: { releaseExcept: vi.fn(), setDeleted: vi.fn(), error: vi.fn(), open: vi.fn(async () => ({})) } }));
vi.mock('../../src/features/project/libraryFiles', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/features/project/libraryFiles')>(),
  inspectAsset: vi.fn(async () => ({ width: 10, height: 10 })),
}));
vi.mock('../../src/features/project/archive', () => ({ packProject: vi.fn(async () => new Blob(['archive'])), unpackProject: vi.fn() }));

const project = (): Project => ({ id: 'project', name: 'Test', source: { name: 'Empty' }, updatedAt: 0,
  library: [], subtitle: null, analysis: emptyAnalysis(), interstitials: [createNode('simple').item],
  storyFlow: { version: 1, entryId: '', nodes: [], edges: [], templates: [] } });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const file = (name = 'Test.sparko') => {
  const writer = { write: vi.fn(async (_blob: Blob) => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
  const handle = { name, createWritable: vi.fn(async () => writer) } as unknown as FileSystemFileHandle;
  return { handle, writer };
};
let jobs: InterstitialController, controller: ProjectController;
beforeEach(async () => {
  vi.clearAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { storage.set(key, value); }) });
  jobs = new InterstitialController(); controller = new ProjectController(jobs);
  await controller.init({ id: 'default', name: 'Default', url: '' });
  await controller.newProject(); await settle();
});
afterEach(() => { controller.dispose(); jobs.dispose(); vi.unstubAllGlobals(); });

it('compares contents independent of property order, timestamps, progress, and render URLs', () => {
  const start = project();
  start.source.assetId = 'source'; start.source.url = 'blob:old-source';
  start.interstitials[0] = { ...start.interstitials[0], phase: 'ready',
    result: { assetId: 'render', url: 'blob:old', start: 0, duration: 5, totalDuration: 5 } };
  const next = structuredClone(start);
  next.updatedAt = 123; next.source.url = 'blob:new-source';
  next.interstitials[0] = { ...next.interstitials[0], ...interstitialSettings(next.interstitials[0]),
    phase: 'loading', progress: .5, progressDetails: { stage: 'Checking generated video' }, queuePosition: 3 };
  next.interstitials[0].result!.url = 'asset:render';
  const reordered = JSON.parse(JSON.stringify(next), (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).reverse()) : value);
  expect(projectContent(reordered)).toBe(projectContent(start));
});

it.each(['seed', 'turbo', 'requestSeed', 'requestId', 'phase', 'result', 'analysis', 'library', 'storyFlow'] as const)(
  'detects meaningful changes to %s', field => {
    const start = project(), next = structuredClone(start), item = next.interstitials[0];
    switch (field) {
      case 'seed': item.seed = 42; break;
      case 'turbo': item.turbo = true; break;
      case 'requestSeed': item.requestSeed = 43; break;
      case 'requestId': item.requestId = 'new-request'; break;
      case 'phase': item.phase = 'queued'; break;
      case 'result': item.result = { assetId: 'new-render', url: 'asset:new-render', start: 0, duration: 5, totalDuration: 5 }; break;
      case 'analysis': next.analysis.instructions = 'Look at this'; break;
      case 'library': next.library = [{ assetId: 'image', name: 'Picture', kind: 'image' }]; break;
      case 'storyFlow': next.storyFlow!.nodes.push(createNode('simple').node); break;
    }
    expect(projectContent(next)).not.toBe(projectContent(start));
  });

it('skips unchanged browser writes and keeps the timestamp and clean state', async () => {
  expect(writeProject).toHaveBeenCalledTimes(1);
  const timestamp = controller.getSnapshot().project!.updatedAt;
  controller.editAssets(p => p);
  controller.editAssets(p => ({ ...structuredClone(p), updatedAt: timestamp + 100 }));
  controller.updateAnalysis(structuredClone(controller.getSnapshot().project!.analysis));
  await settle();
  expect(writeProject).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot()).toMatchObject({ dirty: false, undoLabel: null, project: { updatedAt: timestamp } });
});

it('skips duplicate queued writes but retries after a browser write fails', async () => {
  vi.mocked(writeProject).mockRejectedValueOnce(new Error('Storage failed'));
  controller.editAssets(p => ({ ...p, name: 'Changed' }));
  controller.editAssets(p => structuredClone(p));
  await settle();
  expect(writeProject).toHaveBeenCalledTimes(2);
  expect(controller.getSnapshot().error).toContain('Storage failed');
  controller.editAssets(p => p); await settle();
  expect(writeProject).toHaveBeenCalledTimes(3);
  expect(controller.getSnapshot().dirty).toBe(true);
});

it.each(['new', 'close'] as const)('allows %s after a failed autosave without requiring another edit', async action => {
  vi.mocked(writeProject).mockRejectedValueOnce(new Error('Temporary storage failure'));
  controller.editAssets(p => ({ ...p, name: 'Changed' })); await settle();
  expect(controller.getSnapshot().error).toContain('Temporary storage failure');
  const revision = controller.getSnapshot().activationRevision;
  if (action === 'new') {
    await controller.newProject(); expect(controller.getSnapshot().project?.name).toBe('Untitled project');
  } else {
    expect(await controller.closeProject(true)).toBe(true); expect(controller.getSnapshot().project).toBeNull();
  }
  expect(controller.getSnapshot().error).toBeNull(); expect(controller.getSnapshot().activationRevision).toBeGreaterThan(revision);
});

it('rebases an import onto edits and completed media added while its storage transaction is pending', async () => {
  let finish!: () => void;
  vi.mocked(writeProject).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const importing = controller.importAssets([{ file: new File(['image'], 'import.png', { type: 'image/png' }), path: 'import.png' }]);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  const renderId = crypto.randomUUID();
  controller.editAssets(p => ({ ...p, name: 'Edited during import', analysis: { ...p.analysis, instructions: 'Keep this edit' },
    library: [...p.library ?? [], { assetId: renderId, name: 'Completed render', kind: 'image' }] }), false);
  finish(); const imported = await importing; await settle();
  expect(imported).toHaveLength(1);
  expect(controller.getSnapshot().project).toMatchObject({ name: 'Edited during import', analysis: { instructions: 'Keep this edit' } });
  expect(controller.getSnapshot().project!.library!.map(item => item.name)).toEqual(['Completed render', 'import.png']);
  const saved = vi.mocked(writeProject).mock.calls.at(-1)![0];
  expect(saved.name).toBe('Edited during import'); expect(saved.library).toHaveLength(2);
});

it('keeps the import unpublished when cancellation arrives during its storage transaction', async () => {
  let finish!: () => void;
  vi.mocked(writeProject).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const importing = controller.importAssets([{ file: new File(['image'], 'cancelled.png', { type: 'image/png' }), path: 'cancelled.png' }]);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  controller.cancel(); finish(); expect(await importing).toEqual([]);
  expect(controller.getSnapshot().project!.library).toEqual([]); expect(controller.getSnapshot().busy).toBe(false);
  await settle(); expect(vi.mocked(writeProject).mock.calls.at(-1)![0].library).toEqual([]);
});

it('restores generation controls when switching projects fails during preparation', async () => {
  const generation = { ...newAssetGeneration('image'), phase: 'preparing' as const };
  controller.editAssets(p => ({ ...p, clipGenerations: [generation] })); await settle();
  vi.mocked(writeProject).mockRejectedValueOnce(new Error('Could not prepare project'));
  await controller.newProject();
  expect(controller.getSnapshot()).toMatchObject({ activating: false, busy: false, project: { clipGenerations: [{ phase: 'draft' }] } });
});

it('notifies canvas activation after preparation and isolates outgoing generation updates', async () => {
  const item = jobs.add(0, 10); await settle();
  let finish!: () => void;
  const revision = controller.getSnapshot().activationRevision, generationRevision = controller.getSnapshot().generationRevision;
  vi.mocked(writeProject).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = controller.newProject();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(controller.getSnapshot()).toMatchObject({ activating: true, activationRevision: revision, generationRevision: generationRevision + 1 });
  const writes = vi.mocked(writeProject).mock.calls.length;
  jobs.edit(item.id, { prompt: 'Late update in the outgoing document' }); await settle();
  expect(writeProject).toHaveBeenCalledTimes(writes);
  finish(); await pending; await settle();
  expect(controller.getSnapshot()).toMatchObject({ activating: false, activationRevision: revision + 1, project: { interstitials: [] } });
  expect(vi.mocked(writeProject).mock.calls.at(-1)![0].interstitials).toEqual([]);
});

it('updates live progress without writing storage or marking a saved project dirty', async () => {
  const item = jobs.add(0, 10);
  controller.editAssets(p => ({ ...p, interstitials: p.interstitials.map(i => ({ ...i, phase: 'rendering' })) }));
  const { handle } = file(); await controller.saveToFile(handle); await settle();
  const count = vi.mocked(writeProject).mock.calls.length;
  controller.editAssets(p => ({ ...p, interstitials: p.interstitials.map(i => ({ ...i, progress: .4, progressDetails: { stage: 'Sampling' } })) }));
  await settle();
  expect(controller.getSnapshot().project!.interstitials.find(i => i.id === item.id)?.progress).toBe(.4);
  expect(controller.getSnapshot().dirty).toBe(false);
  expect(writeProject).toHaveBeenCalledTimes(count);
});

it('does not rewrite an unchanged file, and undo/redo track the saved content', async () => {
  const { handle } = file();
  const original = controller.getSnapshot().project!.crossfadeFrames!;
  expect(await controller.saveToFile(handle)).toBe(true);
  const states: boolean[] = []; controller.subscribe(() => states.push(controller.getSnapshot().busy));
  expect(await controller.saveToFile(handle)).toBe(true);
  expect(handle.createWritable).toHaveBeenCalledTimes(1);
  expect(packProject).toHaveBeenCalledTimes(1);
  expect(states).toEqual([]);
  controller.setCrossfadeFrames(original + 2);
  expect(controller.getSnapshot().dirty).toBe(true);
  await controller.undo();
  expect(controller.getSnapshot().dirty).toBe(false);
  await controller.saveToFile(handle);
  expect(handle.createWritable).toHaveBeenCalledTimes(1);
  await controller.redo();
  expect(controller.getSnapshot().dirty).toBe(true);
  await controller.saveToFile(handle);
  expect(handle.createWritable).toHaveBeenCalledTimes(2);
  expect(controller.getSnapshot().dirty).toBe(false);
});

it('always writes Save As and exports even when the project is unchanged', async () => {
  const { handle } = file(); await controller.saveToFile(handle);
  await controller.saveToFile(handle, true);
  expect(handle.createWritable).toHaveBeenCalledTimes(2);
  const other = file('Copy.sparko'); await controller.saveToFile(other.handle);
  expect(other.handle.createWritable).toHaveBeenCalledTimes(1);
  await controller.exportProject(); await controller.exportProject();
  expect(packProject).toHaveBeenCalledTimes(5);
});

it('recognizes saved draft settings after undo normalizes optional fields', async () => {
  const item = jobs.add(0, 10), { handle } = file();
  await controller.saveToFile(handle); controller.endHistoryGroup();
  jobs.edit(item.id, { prompt: 'A different prompt' });
  expect(controller.getSnapshot().dirty).toBe(true);
  await controller.undo();
  expect(controller.getSnapshot().dirty).toBe(false);
  await controller.saveToFile(handle);
  expect(handle.createWritable).toHaveBeenCalledTimes(1);
});

it('persists completed validation while treating media revalidation as unchanged file content', () => {
  const loading = project();
  loading.interstitials[0] = { ...loading.interstitials[0], phase: 'loading',
    result: { assetId: 'render', url: 'asset:render', start: 0, duration: 5, totalDuration: 5 } };
  const ready = structuredClone(loading); ready.interstitials[0].phase = 'ready';
  expect(projectContent(loading)).toBe(projectContent(ready));
  expect(projectContent(loading, 'browser')).not.toBe(projectContent(ready, 'browser'));
});

it('ignores the temporary playback fallback while revalidating the same saved render', () => {
  const ready = project();
  ready.interstitials[0] = { ...ready.interstitials[0], phase: 'ready',
    result: { assetId: 'render', url: 'asset:render', start: 0, duration: 5, totalDuration: 5 } };
  const loading = structuredClone(ready);
  loading.interstitials[0].phase = 'loading';
  loading.interstitials[0].previousResult = { ...loading.interstitials[0].result!, url: 'blob:render' };
  expect(projectContent(loading)).toBe(projectContent(ready));
  expect(projectContent(loading, 'browser')).not.toBe(projectContent(ready, 'browser'));
  loading.interstitials[0].previousResult.duration = 4;
  expect(projectContent(loading)).not.toBe(projectContent(ready));
  loading.interstitials[0].previousResult.duration = 5;
  loading.interstitials[0].previousResult.assetId = 'older-render';
  expect(projectContent(loading)).not.toBe(projectContent(ready));
});

it.each(['write', 'close'] as const)('only marks contents saved after a successful %s', async step => {
  const { handle, writer } = file(); await controller.saveToFile(handle);
  controller.editAssets(p => ({ ...p, name: 'Changed' }));
  writer[step].mockRejectedValueOnce(new Error('Disk full'));
  expect(await controller.saveToFile(handle)).toBeUndefined();
  expect(controller.getSnapshot()).toMatchObject({ dirty: true, error: 'Disk full' });
  expect(writer.abort).toHaveBeenCalledTimes(1);
  expect(await controller.saveToFile(handle)).toBe(true);
  expect(handle.createWritable).toHaveBeenCalledTimes(3);
  expect(controller.getSnapshot().dirty).toBe(false);
});

it('keeps edits made while the snapshot is being written dirty', async () => {
  const { handle, writer } = file();
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  writer.write.mockImplementationOnce(() => pending);
  const saving = controller.saveToFile(handle);
  await vi.waitFor(() => expect(writer.write).toHaveBeenCalledTimes(1));
  controller.editAssets(p => ({ ...p, name: 'Edited during save' }));
  finish(); await saving;
  expect(controller.getSnapshot().dirty).toBe(true);
  await controller.saveToFile(handle);
  expect(handle.createWritable).toHaveBeenCalledTimes(2);
  expect(controller.getSnapshot().dirty).toBe(false);
});

it('resets comparisons when switching projects', async () => {
  const { handle } = file(); await controller.saveToFile(handle);
  vi.mocked(readProject).mockResolvedValueOnce(project());
  await controller.openSavedProject('project');
  expect(controller.getSnapshot().dirty).toBe(false);
  await controller.saveToFile(handle);
  expect(handle.createWritable).toHaveBeenCalledTimes(2);
});

it('keeps job recovery data in local storage without rewriting progress updates', () => {
  const items = project().interstitials.map(item => ({ ...item, phase: 'rendering' as const, requestId: 'job-123456' }));
  expect(saveInterstitials('test', items)).toBe(true);
  const count = vi.mocked(localStorage.setItem).mock.calls.length;
  expect(saveInterstitials('test', items.map(item => ({ ...item, progress: .5, progressDetails: { stage: 'Sampling' }, queuePosition: 1 })))).toBe(true);
  expect(localStorage.setItem).toHaveBeenCalledTimes(count);
  expect(saveInterstitials('test', items.map(item => ({ ...item, phase: 'cancelled' })))).toBe(true);
  expect(localStorage.setItem).toHaveBeenCalledTimes(count + 1);
  expect(localStorage.getItem('sparko:interstitials:v1:test')).toContain('job-123456');
});
