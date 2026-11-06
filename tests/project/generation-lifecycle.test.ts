import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClipGenerationController } from '../../src/features/project/ClipGenerationController';
import type { ProjectController } from '../../src/features/project/ProjectController';
import { emptyAnalysis, type Project } from '../../src/features/project/types';
import { newAssetGeneration } from '../../shared/asset-generation';
import { request, requestResponse } from '../../src/shared/api';
import { assets } from '../../src/features/project/assets';

vi.mock('../../src/shared/api', () => ({ request: vi.fn(), requestResponse: vi.fn() }));
vi.mock('../../src/features/project/assets', () => ({ assets: { open: vi.fn(), save: vi.fn() } }));
vi.mock('../../src/features/project/libraryFiles', () => ({ inspectAsset: vi.fn(async () => ({ width: 10, height: 10 })) }));
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture() {
  const generation = newAssetGeneration('image'); generation.settings.prompt = 'A landscape';
  let project: Project = { id: 'draft:reused', name: 'Test', source: { name: 'Empty' }, updatedAt: 0, subtitle: null,
    analysis: emptyAnalysis(), interstitials: [], library: [], clipGenerations: [generation],
    storyFlow: { version: 1, entryId: 'node', nodes: [{ id: 'node', name: 'Image', kind: 'source', x: 0, y: 0, loopCount: 0, generationId: generation.id }], edges: [], templates: [] } };
  let activationRevision = 1, activating = false;
  const listeners = new Set<() => void>();
  const projects = { getSnapshot: () => ({ project, generationRevision: activationRevision, activating }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    editAssets: (change: (p: Project) => Project) => { project = change(project); listeners.forEach(listener => listener()); } };
  return { controller: new ClipGenerationController(projects as unknown as ProjectController), id: generation.id,
    project: () => project, generation: () => project.clipGenerations![0],
    activate: () => { activationRevision++; project = { ...project, clipGenerations: [structuredClone(generation)] }; listeners.forEach(listener => listener()); },
    beginActivation: () => { activationRevision++; activating = true; listeners.forEach(listener => listener()); },
    patch: (patch: Partial<typeof generation>) => { project = { ...project, clipGenerations: [{ ...project.clipGenerations![0], ...patch }] }; },
  };
}
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

it('cancels a late submission instead of attaching it to a reused working document ID', async () => {
  const f = fixture(), submit = deferred<{ requestId: string }>();
  vi.mocked(request).mockReturnValueOnce(submit.promise).mockResolvedValue({});
  const stop = f.controller.watch(), pending = f.controller.generate(f.id);
  f.activate(); submit.resolve({ requestId: 'late-request' }); await pending;
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenLastCalledWith(expect.stringContaining('/late-request'), { method: 'DELETE' });
  expect(f.generation()).toMatchObject({ phase: 'draft' });
  expect(f.generation().requestId).toBeUndefined(); stop();
});

it('holds off a replacement submission until cancellation of the accepted job finishes', async () => {
  const f = fixture(), submit = deferred<{ requestId: string }>(), cancel = deferred<unknown>();
  vi.mocked(request).mockReturnValueOnce(submit.promise).mockReturnValueOnce(cancel.promise);
  const pending = f.controller.generate(f.id);
  await f.controller.cancel(f.id);
  await f.controller.generate(f.id); expect(request).toHaveBeenCalledTimes(1);
  submit.resolve({ requestId: 'accepted-request' });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  await f.controller.generate(f.id); expect(request).toHaveBeenCalledTimes(2);
  cancel.resolve({}); await pending;
  expect(f.generation()).toMatchObject({ phase: 'cancelled', requestId: 'accepted-request' });
});

it('does not publish a stale status response after activation changes', async () => {
  const f = fixture(), status = deferred<unknown>();
  f.patch({ requestId: 'old-request', submitted: structuredClone(f.generation().settings), phase: 'queued' });
  vi.mocked(request).mockReturnValueOnce(status.promise);
  const pending = f.controller.resume(f.id);
  f.activate(); status.resolve({ phase: 'ready', count: 1 }); await pending;
  expect(requestResponse).not.toHaveBeenCalled(); expect(assets.save).not.toHaveBeenCalled();
  expect(f.generation().phase).toBe('draft');
});

it('suspends polling while another project is being prepared', async () => {
  const f = fixture(), status = deferred<unknown>();
  f.patch({ requestId: 'old-request', submitted: structuredClone(f.generation().settings), phase: 'queued' });
  vi.mocked(request).mockReturnValueOnce(status.promise);
  const stop = f.controller.watch(), signal = vi.mocked(request).mock.calls[0][1]!.signal!;
  f.beginActivation(); expect(signal.aborted).toBe(true);
  await f.controller.resume(f.id); expect(request).toHaveBeenCalledOnce();
  status.resolve({ phase: 'ready', count: 1 });
  await Promise.resolve(); expect(requestResponse).not.toHaveBeenCalled(); stop();
});

it('does not overwrite a new activation when cancellation fails late', async () => {
  const f = fixture(), cancel = deferred<unknown>();
  f.patch({ requestId: 'old-request', submitted: structuredClone(f.generation().settings), phase: 'error' });
  vi.mocked(request).mockReturnValueOnce(cancel.promise);
  const pending = f.controller.cancel(f.id);
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  f.activate(); cancel.reject(new Error('Old cancellation failed')); await pending;
  expect(f.generation().phase).toBe('draft'); expect(f.generation().error).toBeUndefined();
});

it('retains the original job and submitted model when retiring a failed job fails', async () => {
  const f = fixture(), submitted = { ...f.generation().settings, model: 'flux-2-pro' };
  f.patch({ requestId: 'old-request', submitted, phase: 'error' });
  vi.mocked(request).mockRejectedValueOnce(new Error('Cancellation unavailable'));
  await f.controller.generate(f.id);
  expect(request).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledWith('/api/library-generations/flux-2-pro/old-request', { method: 'DELETE' });
  expect(f.generation()).toMatchObject({ requestId: 'old-request', submitted, phase: 'error' });
});

it('coalesces cancellation and prevents the watcher from restarting a cancelled poll', async () => {
  const f = fixture(), status = deferred<unknown>(), cancel = deferred<unknown>();
  f.patch({ requestId: 'old-request', submitted: structuredClone(f.generation().settings), phase: 'queued' });
  vi.mocked(request).mockReturnValueOnce(status.promise).mockReturnValueOnce(cancel.promise);
  const stop = f.controller.watch();
  const first = f.controller.cancel(f.id), second = f.controller.cancel(f.id);
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  status.reject(new DOMException('Cancelled', 'AbortError'));
  cancel.resolve({}); await Promise.all([first, second]);
  expect(f.generation().phase).toBe('cancelled'); expect(request).toHaveBeenCalledTimes(2); stop();
});

it('publishes a completed result once, retaining the submitted settings', async () => {
  const f = fixture();
  vi.mocked(request).mockResolvedValueOnce({ requestId: 'ready-request' }).mockResolvedValueOnce({ phase: 'ready', count: 1 });
  vi.mocked(requestResponse).mockResolvedValue(new Response('image', { headers: { 'content-type': 'image/png' } }));
  vi.mocked(assets.save).mockResolvedValue({ id: 'output', name: 'Output', blob: new Blob(['image']) });
  vi.mocked(assets.open).mockResolvedValue({ asset: { id: 'output', name: 'Output', blob: new Blob(['image']) }, url: 'blob:output' });
  const stop = f.controller.watch(); await f.controller.generate(f.id);
  expect(f.generation()).toMatchObject({ phase: 'ready', selectedAssetId: 'output', versions: [{ assetId: 'output', settings: { prompt: 'A landscape' } }] });
  expect(f.project().storyFlow!.nodes[0].source?.assetId).toBe('output');
  expect(assets.save).toHaveBeenCalledOnce(); stop();
});
