import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InterstitialController } from '../../src/features/interstitials/InterstitialController';
import { cancelInterstitialJob, generateInterstitial, getInterstitialJob } from '../../src/features/interstitials/api';
import { generationSource } from '../../src/features/call-response/generation';
import { addAnswer, createTimelineExample, responseInterstitialIds } from '../../src/features/call-response/model';
import { assets } from '../../src/features/project/assets';
import { hasUnsubmittedChanges, playableResult } from '../../shared/interstitials';
import type { MediaEngine } from '../../src/media/MediaEngine';
import type { GenerationJob } from '../../shared/contracts';

vi.mock('../../src/features/interstitials/api', () => ({ generateInterstitial: vi.fn(), getInterstitialJob: vi.fn(), cancelInterstitialJob: vi.fn() }));
vi.mock('../../src/features/interstitials/progress-stream', () => ({ watchComfyJob: vi.fn() }));
vi.mock('../../src/features/call-response/generation', () => ({ generationSource: vi.fn() }));
vi.mock('../../src/media/MediaEngine', () => ({ MediaEngine: class { inspect() { return Promise.resolve({ duration: 30, fps: 24 }); } dispose() {} } }));
vi.mock('../../src/features/project/assets', () => ({ assets: { fetch: vi.fn(), save: vi.fn(), open: vi.fn() } }));

const info = { duration: 20, fps: 24, width: 320, height: 180, codec: 'avc', hasAudio: true };
const media = {} as MediaEngine;
const ids = ['call-response-call', 'call-response-wait', 'call-response-correct', 'call-response-incorrect'];
const completed = (requestId: string): GenerationJob => ({ requestId, status: 'COMPLETED', videoUrl: `https://fal.media/${requestId}.mp4`, insertion: { start: 2, duration: 6, totalDuration: 10 } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let controller: InterstitialController;
let example: ReturnType<typeof createTimelineExample>;
const item = (index: number) => controller.getSnapshot().items.find(item => item.id === ids[index])!;

beforeEach(async () => {
  vi.resetAllMocks();
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) });
  vi.mocked(assets.open).mockResolvedValue({ url: 'blob:source' } as any);
  vi.mocked(assets.fetch).mockImplementation(async url => ({ id: crypto.randomUUID(), name: url, blob: new Blob(['video']) }));
  vi.mocked(assets.save).mockImplementation(async (_blob, name) => ({ id: name, blob: new Blob(['video']), name } as any));
  vi.mocked(generationSource).mockImplementation(async item => ({ item, engine: media, info }));
  let jobs = 0;
  vi.mocked(generateInterstitial).mockImplementation(async () => ({ requestId: `render-${++jobs}`, status: 'IN_QUEUE' }));
  vi.mocked(getInterstitialJob).mockImplementation(async id => completed(id));
  vi.mocked(cancelInterstitialJob).mockImplementation(async id => ({ requestId: id, status: 'CANCELLED' }));
  example = createTimelineExample(crypto.randomUUID(), 20);
  controller = new InterstitialController();
  controller.load('sequence-project', example.interstitials, responseInterstitialIds(example.flow), example.flow);
  await vi.waitFor(() => expect(controller.getSnapshot().items.every(item => item.phase === 'ready')).toBe(true));
});
afterEach(() => { controller.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('call-response generation sequence', () => {
  it('waits for each result to be saved and inspected, then uses it for the next reference', async () => {
    const saved = deferred<any>();
    vi.mocked(assets.save).mockReturnValueOnce(saved.promise);
    const run = controller.generateAll(media, info);
    await vi.waitFor(() => expect(item(0).phase).toBe('loading'));
    expect(generateInterstitial).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().sequence).toMatchObject({ activeId: ids[0], completedIds: [], phase: 'running' });
    saved.resolve({ id: 'new-call' });
    await run;
    expect(vi.mocked(generateInterstitial).mock.calls.map(call => call[0].id)).toEqual(ids);
    const references = vi.mocked(generationSource).mock.calls.map(call => call[1]);
    expect(references[0].before.assetId).toBe(example.flow.scenes[0].clip.assetId);
    expect(references[1].before.assetId).toBe('new-call');
    expect(references[2].before.assetId).toBe(item(1).result!.assetId);
    expect(references[3].before.assetId).toBe(item(1).result!.assetId);
    expect(references[2].after?.assetId).toBe(example.flow.scenes.at(-1)!.clip.assetId);
    expect(controller.getSnapshot().sequence).toMatchObject({ phase: 'ready', completedIds: ids });
    for (const id of ids) expect(controller.dependency(id)?.stale).toBe(false);
  });

  it('keeps active inputs fixed and uses the newest edits for pending clips without duplicate submissions', async () => {
    const first = deferred<GenerationJob>();
    vi.mocked(getInterstitialJob).mockReturnValueOnce(first.promise);
    const run = controller.generateAll(media, info);
    await vi.waitFor(() => expect(item(0).phase).toBe('queued'));
    const submitted = item(0).generationSettings!;
    controller.edit(ids[0], { prompt: 'Use this on the next call render', method: 'comfy' });
    controller.edit(ids[1], { prompt: 'A quiet waiting loop', start_range: 3, end_range: 3, duration: 7, method: 'comfy' });
    controller.edit(ids[2], { duration: 8, enable_prompt_expansion: true });
    await controller.generateAll(media, info);
    await controller.generate(ids[2], media, info);
    expect(generateInterstitial).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateInterstitial).mock.calls[0][0]).toMatchObject(JSON.parse(JSON.stringify(submitted)));
    first.resolve(completed('render-1')); await run;
    expect(vi.mocked(generateInterstitial).mock.calls[1][0]).toMatchObject({ prompt: 'A quiet waiting loop', start_range: 3, end_range: 3, duration: 7, method: 'comfy' });
    expect(vi.mocked(generateInterstitial).mock.calls[2][0]).toMatchObject({ duration: 8, enable_prompt_expansion: true });
    expect(vi.mocked(generateInterstitial).mock.calls[3][0].duration).toBe(8);
    expect(item(0).generationSettings).toEqual(submitted);
    expect(hasUnsubmittedChanges(item(0))).toBe(true);
    expect(controller.getSnapshot().sequence?.phase).toBe('ready');
  });

  it('stops on failure and continues remaining clips without regenerating successful ones', async () => {
    vi.mocked(generationSource).mockImplementationOnce(async item => ({ item, engine: media, info }))
      .mockRejectedValueOnce(new Error('Cannot prepare reference'));
    await controller.generateAll(media, info);
    expect(controller.getSnapshot().sequence).toMatchObject({ phase: 'error', completedIds: [ids[0]], message: expect.stringContaining('Cannot prepare reference') });
    expect(generateInterstitial).toHaveBeenCalledTimes(1);
    controller.edit(ids[1], { prompt: 'Revised loop' });
    await controller.generateAll(media, info, undefined, true);
    expect(vi.mocked(generateInterstitial).mock.calls.map(call => call[0].id)).toEqual(ids);
    expect(controller.getSnapshot().sequence?.phase).toBe('ready');
  });

  it('cancels the running job using its submitted provider and never starts the next clip', async () => {
    const first = deferred<GenerationJob>(), cancellation = deferred<GenerationJob>();
    vi.mocked(getInterstitialJob).mockReturnValueOnce(first.promise);
    vi.mocked(cancelInterstitialJob).mockReturnValueOnce(cancellation.promise);
    const previous = playableResult(item(0));
    const run = controller.generateAll(media, info);
    await vi.waitFor(() => expect(item(0).phase).toBe('queued'));
    controller.edit(ids[0], { method: 'comfy', prompt: 'Changed while rendering' });
    const cancel = controller.cancel(ids[0]);
    first.resolve(completed('render-1')); await run;
    expect(controller.getSnapshot().sequence?.phase).toBe('cancelling');
    cancellation.resolve({ requestId: 'render-1', status: 'CANCELLED' });
    expect(await cancel).toBe(true);
    expect(cancelInterstitialJob).toHaveBeenCalledExactlyOnceWith('render-1', 'fal');
    expect(controller.getSnapshot().sequence?.phase).toBe('cancelled');
    expect(generateInterstitial).toHaveBeenCalledTimes(1);
    expect(playableResult(item(0))).toEqual(previous);
    await controller.generate(ids[0], media, info);
    expect(generateInterstitial).toHaveBeenCalledTimes(2);
  });

  it('cancels a submission that arrives after cancellation without advancing the sequence', async () => {
    const first = deferred<GenerationJob>();
    vi.mocked(generateInterstitial).mockReturnValueOnce(first.promise);
    const run = controller.generateAll(media, info);
    await vi.waitFor(() => expect(generateInterstitial).toHaveBeenCalledOnce());
    await controller.cancelSequence();
    first.resolve({ requestId: 'late-render', status: 'IN_QUEUE' }); await run;
    expect(cancelInterstitialJob).toHaveBeenCalledWith('late-render', 'fal');
    expect(getInterstitialJob).not.toHaveBeenCalled();
    expect(generateInterstitial).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().sequence?.phase).toBe('cancelled');
  });

  it('reports a failed cancellation and leaves the job attached for retry', async () => {
    const first = deferred<GenerationJob>();
    vi.mocked(getInterstitialJob).mockReturnValueOnce(first.promise);
    vi.mocked(cancelInterstitialJob).mockRejectedValueOnce(new Error('Connection lost'));
    const run = controller.generateAll(media, info);
    await vi.waitFor(() => expect(item(0).phase).toBe('queued'));
    expect(await controller.cancelSequence()).toBe(false);
    first.resolve(completed('render-1')); await run;
    expect(controller.getSnapshot().sequence).toMatchObject({ phase: 'error', message: expect.stringContaining('could not be cancelled') });
    expect(item(0)).toMatchObject({ phase: 'error', requestId: 'render-1' });
    expect(generateInterstitial).toHaveBeenCalledOnce();
    expect(await controller.cancel(ids[0])).toBe(true);
  });

  it('stops when a pending prompt is cleared and can continue after editing it', async () => {
    const first = deferred<GenerationJob>();
    vi.mocked(getInterstitialJob).mockReturnValueOnce(first.promise);
    const run = controller.generateAll(media, info);
    await vi.waitFor(() => expect(item(0).phase).toBe('queued'));
    controller.edit(ids[1], { prompt: '' });
    first.resolve(completed('render-1')); await run;
    expect(controller.getSnapshot().sequence).toMatchObject({ phase: 'error', completedIds: [ids[0]], message: expect.stringContaining('Add a prompt') });
    expect(generateInterstitial).toHaveBeenCalledOnce();
    controller.edit(ids[1], { prompt: 'Waiting quietly' });
    await controller.generateAll(media, info, undefined, true);
    expect(controller.getSnapshot().sequence?.phase).toBe('ready');
  });

  it('stops if a waiting clip is changed to an unavailable provider', async () => {
    const first = deferred<GenerationJob>();
    vi.mocked(getInterstitialJob).mockReturnValueOnce(first.promise);
    const run = controller.generateAll(media, info, { fal: true, comfy: false, openai: false, gemini: false });
    await vi.waitFor(() => expect(item(0).phase).toBe('queued'));
    controller.edit(ids[1], { method: 'comfy' });
    first.resolve(completed('render-1')); await run;
    expect(controller.getSnapshot().sequence?.message).toContain('Comfy Cloud is not connected');
    expect(generateInterstitial).toHaveBeenCalledOnce();
  });

  it('stops on structural edits while leaving all draft fields editable', async () => {
    const first = deferred<GenerationJob>();
    vi.mocked(getInterstitialJob).mockReturnValueOnce(first.promise);
    const run = controller.generateAll(media, info);
    await vi.waitFor(() => expect(item(0).phase).toBe('queued'));
    controller.setCallResponse(addAnswer(example.flow));
    controller.edit(ids[0], { prompt: 'Still editable' });
    first.resolve(completed('render-1')); await run;
    await vi.waitFor(() => expect(controller.getSnapshot().sequence?.phase).toBe('cancelled'));
    expect(controller.getSnapshot().sequence?.message).toContain('Clip structure changed');
    expect(item(0).prompt).toBe('Still editable');
    expect(generateInterstitial).toHaveBeenCalledOnce();
  });

  it('retires the sequence when a different project opens, ignoring late results', async () => {
    const first = deferred<GenerationJob>();
    vi.mocked(getInterstitialJob).mockReturnValueOnce(first.promise);
    const run = controller.generateAll(media, info);
    await vi.waitFor(() => expect(item(0).phase).toBe('queued'));
    controller.load('another-project', []);
    first.resolve(completed('render-1')); await run;
    expect(controller.getSnapshot()).toMatchObject({ items: [], sequence: null });
    expect(generateInterstitial).toHaveBeenCalledOnce();
  });

  it('does not reuse a completed download made against an earlier predecessor', async () => {
    await controller.generate(ids[0], media, info);
    vi.mocked(assets.fetch).mockRejectedValueOnce(new Error('Download failed'));
    await controller.generate(ids[1], media, info);
    expect(item(1).result?.url).toBeTruthy();
    await controller.generate(ids[0], media, info);
    expect(controller.canRecover(ids[1])).toBe(false);
    await controller.generate(ids[1], media, info);
    expect(generateInterstitial).toHaveBeenCalledTimes(4);
    expect(item(1).result?.reference?.before.assetId).toBe(item(0).result?.assetId);
  });
});
