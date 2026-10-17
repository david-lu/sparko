import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InterstitialController } from '../../src/features/interstitials/InterstitialController';
import { loadInterstitials, interstitialKey } from '../../src/features/interstitials/storage';
import { cancelInterstitialJob, generateInterstitial, getInterstitialJob } from '../../src/features/interstitials/api';
import type { MediaEngine } from '../../src/media/MediaEngine';
import { assets } from '../../src/features/project/assets';
import { hasUnsubmittedChanges, interstitialSettings, playableResult } from '../../shared/interstitials';
import { changeClipKind, createTimelineExample } from '../../src/features/call-response/model';
import { generationSource } from '../../src/features/call-response/generation';
import { watchComfyJob } from '../../src/features/interstitials/progress-stream';

vi.mock('../../src/features/interstitials/api', () => ({ generateInterstitial: vi.fn(), getInterstitialJob: vi.fn(), cancelInterstitialJob: vi.fn() }));
vi.mock('../../src/features/interstitials/progress-stream', () => ({ watchComfyJob: vi.fn() }));
vi.mock('../../src/features/call-response/generation', () => ({ generationSource: vi.fn() }));
vi.mock('../../src/media/MediaEngine', () => ({ MediaEngine: class { inspect() { return Promise.resolve({ duration: 9, fps: 25 }); } dispose() {} } }));
vi.mock('../../src/features/project/assets', () => ({ assets: { download: async () => ({ id: 'stored-asset' }), open: async () => ({ url: 'blob:local-asset' }) } }));
const info = { duration: 20, fps: 25, width: 320, height: 180, codec: 'avc', hasAudio: true };
const media = {} as MediaEngine;
let controller: InterstitialController;
beforeEach(() => {
  vi.resetAllMocks();
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
  controller = new InterstitialController(); controller.load('source');
});
afterEach(() => { controller.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const add = () => { const item = controller.add(5, 20); controller.edit(item.id, { prompt: 'A scene' }); return item.id; };
const completed = { requestId: 'saved-job-1234', status: 'COMPLETED' as const, videoUrl: 'https://fal.media/result.mp4', insertion: { start: 2, duration: 5, totalDuration: 9 } };
const replacement = { ...completed, requestId: 'replacement-job-1234', videoUrl: 'https://fal.media/replacement.mp4', insertion: { start: 2, duration: 6, totalDuration: 9 } };
async function readyScene() {
  const id = add();
  vi.mocked(generateInterstitial).mockResolvedValue({ requestId: completed.requestId, status: 'IN_QUEUE' });
  vi.mocked(getInterstitialJob).mockResolvedValue(completed);
  await controller.generate(id, media, info);
  return controller.getSnapshot().items[0];
}

describe('interstitial lifecycle', () => {
  it('shows live Comfy steps without stale polls overwriting them and detaches on completion', async () => {
    const id = add(); controller.edit(id, { method: 'comfy' });
    vi.mocked(generateInterstitial).mockResolvedValue({ requestId: completed.requestId, status: 'IN_QUEUE', insertion: completed.insertion });
    let read!: (job: Awaited<ReturnType<typeof getInterstitialJob>>) => void;
    vi.mocked(getInterstitialJob).mockImplementation(() => new Promise(resolve => { read = resolve; }));
    const generation = controller.generate(id, media, info);
    await vi.waitFor(() => expect(watchComfyJob).toHaveBeenCalledOnce());
    const [, signal, update] = vi.mocked(watchComfyJob).mock.calls[0];
    update({ type: 'progress', progress: .4, progressDetails: { stage: 'Generating video and audio', step: 8, steps: 20 } });
    vi.useFakeTimers();
    try {
      read({ requestId: completed.requestId, status: 'IN_QUEUE', progress: 0 });
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.getSnapshot().items[0]).toMatchObject({ phase: 'rendering', progress: .4, progressDetails: { step: 8 } });
      controller.edit(id, { method: 'fal' });
      await vi.advanceTimersByTimeAsync(2500);
      read(completed); await generation;
      expect(controller.getSnapshot().items[0]).toMatchObject({ phase: 'ready', method: 'fal', requestMethod: 'comfy', progressDetails: undefined });
      expect(signal.aborted).toBe(true);
      update({ type: 'progress', progress: .8, progressDetails: { stage: 'Old update', step: 16, steps: 20 } });
      expect(controller.getSnapshot().items[0].phase).toBe('ready');
      expect(cancelInterstitialJob).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('gives a newly converted child its own settings and retained video', () => {
    const example = createTimelineExample(crypto.randomUUID(), 8);
    controller.load('flow', example.interstitials, [], example.flow);
    const flow = changeClipKind(example.flow, 'continue', 'call');
    flow.scenes.find(scene => scene.id === 'continue')!.interstitialId = 'call-response-continue';
    controller.setCallResponse(flow);
    const child = controller.getSnapshot().items.find(item => item.id === 'call-response-continue');
    expect(child).toMatchObject({ phase: 'ready', prompt: 'Let’s keep exploring. Our next adventure awaits!', result: { assetId: flow.scenes[0].clip.assetId } });
    controller.edit(child!.id, { prompt: 'An independent prompt' });
    expect(controller.getSnapshot().items[0].prompt).toBe('What is 2 + 2?');
  });
  it('submits a child against its latest predecessor and stores that reference on its result', async () => {
    const example = createTimelineExample(crypto.randomUUID(), 8);
    controller.load('flow', example.interstitials, [], example.flow);
    await vi.waitFor(() => expect(controller.getSnapshot().items.every(item => item.phase === 'ready')).toBe(true));
    const input = controller.dependency('call-response-wait')!.reference!;
    const item = controller.getSnapshot().items.find(item => item.id === 'call-response-wait')!;
    vi.mocked(generationSource).mockResolvedValue({ item: { ...item, time: 2 }, info, engine: media });
    vi.mocked(generateInterstitial).mockResolvedValue({ requestId: completed.requestId, status: 'IN_QUEUE' });
    vi.mocked(getInterstitialJob).mockResolvedValue(completed);
    await controller.generate(item.id, media, info);
    expect(generationSource).toHaveBeenCalledWith(item, input, expect.any(AbortSignal));
    expect(generateInterstitial).toHaveBeenCalledWith(expect.objectContaining({ time: 2 }), media, info, expect.any(AbortSignal), expect.any(Function));
    expect(controller.getSnapshot().items.find(current => current.id === item.id)).toMatchObject({ time: 3, result: { reference: input } });
    expect(controller.dependency('call-response-correct')?.stale).toBe(true);
    expect(loadInterstitials('flow').find(current => current.id === item.id)?.result?.reference).toEqual(input);
  });
  it('blocks a child while its predecessor generates and retains media if reference preparation fails', async () => {
    const example = createTimelineExample(crypto.randomUUID(), 8);
    controller.load('flow', example.interstitials, [], example.flow);
    await vi.waitFor(() => expect(controller.getSnapshot().items.every(item => item.phase === 'ready')).toBe(true));
    let fail!: (error: Error) => void;
    vi.mocked(generationSource).mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const previous = playableResult(controller.getSnapshot().items[0]);
    const generation = controller.generate('call-response-call', media, info);
    await controller.generate('call-response-wait', media, info);
    expect(controller.getSnapshot().error).toContain('Wait for Call');
    expect(generateInterstitial).not.toHaveBeenCalled();
    fail(new Error('Reference unavailable')); await generation;
    expect(playableResult(controller.getSnapshot().items[0])).toEqual(previous);
    expect(controller.dependency('call-response-wait')).toMatchObject({ stale: false, blocked: undefined });
  });
  it('shares response duration edits and submissions, while preserving separate prompts and real result lengths', async () => {
    const correct = add(), incorrect = controller.add(8, 20).id, other = controller.add(12, 20).id;
    controller.edit(incorrect, { prompt: 'Try again' });
    controller.load('responses', controller.getSnapshot().items, [correct, incorrect]);
    controller.edit(correct, { duration: 7.5, prompt: 'Well done' });
    expect(controller.getSnapshot().items.map(item => [item.duration, item.prompt])).toEqual([[7.5, 'Well done'], [7.5, 'Try again'], [6, '']]);
    vi.mocked(generateInterstitial).mockResolvedValue({ requestId: completed.requestId, status: 'IN_QUEUE' });
    vi.mocked(getInterstitialJob).mockResolvedValue(completed);
    await controller.generate(correct, media, info);
    await controller.generate(incorrect, media, info);
    expect(vi.mocked(generateInterstitial).mock.calls.map(call => call[0].duration)).toEqual([7.5, 7.5]);
    expect(loadInterstitials('responses').slice(0, 2).map(item => item.result?.duration)).toEqual([5, 5]);
    expect(controller.hasLinkedDuration(other)).toBe(false);
    controller.load('responses', undefined, [correct, incorrect]);
    controller.edit(incorrect, { duration: 8 });
    expect(controller.getSnapshot().items.slice(0, 2).map(item => item.duration)).toEqual([8, 8]);
  });
  it('normalizes older response targets without rewriting submitted settings, and clears links on project switch', () => {
    const correct = add(), incorrect = controller.add(8, 20).id;
    controller.edit(incorrect, { duration: 8 });
    const items = controller.getSnapshot().items.map(item => ({ ...item, generationSettings: interstitialSettings(item) }));
    controller.load('responses', items, [correct, incorrect]);
    expect(controller.getSnapshot().items.map(item => item.duration)).toEqual([8, 8]);
    expect(controller.getSnapshot().items.map(item => item.generationSettings?.duration)).toEqual([6, 8]);
    controller.load('regular', items);
    controller.edit(correct, { duration: 7 });
    expect(controller.getSnapshot().items.map(item => item.duration)).toEqual([7, 8]);
  });
  it('pins a Comfy job to its submitted provider and bounds while the editor switches back to Fal', async () => {
    const id = add(); controller.edit(id, { method: 'comfy' });
    let finish!: (job: typeof completed) => void;
    vi.mocked(generateInterstitial).mockResolvedValue({ requestId: 'comfy-job-123', status: 'IN_QUEUE', insertion: completed.insertion });
    vi.mocked(getInterstitialJob).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const generation = controller.generate(id, media, info);
    await vi.waitFor(() => expect(controller.getSnapshot().items[0].phase).toBe('queued'));
    controller.edit(id, { method: 'fal', duration: 7 });
    expect(getInterstitialJob).toHaveBeenCalledWith('comfy-job-123', expect.any(AbortSignal), 'comfy');
    finish({ ...completed, requestId: 'comfy-job-123', videoUrl: '/api/comfy/assets/comfy-asset/content', insertion: undefined as any });
    await generation;
    expect(controller.getSnapshot().items[0]).toMatchObject({ method: 'fal', requestMethod: 'comfy', generationSettings: { method: 'comfy' }, phase: 'ready', result: completed.insertion });
    expect(hasUnsubmittedChanges(controller.getSnapshot().items[0])).toBe(true);
    expect(loadInterstitials('source')[0]).toMatchObject({ requestMethod: 'comfy', requestInsertion: completed.insertion, result: { url: '/api/comfy/assets/comfy-asset/content' } });
  });
  it('resumes saved Comfy jobs and cancels through Comfy after the draft method changes', async () => {
    const id = add();
    const item = controller.getSnapshot().items[0];
    vi.mocked(getInterstitialJob).mockImplementation(() => new Promise(() => undefined));
    controller.load('source', [{ ...item, method: 'fal', requestMethod: 'comfy', requestId: 'comfy-job-123', requestInsertion: completed.insertion, phase: 'queued' }]);
    await vi.waitFor(() => expect(getInterstitialJob).toHaveBeenCalled());
    await controller.cancel(id);
    expect(cancelInterstitialJob).toHaveBeenCalledWith('comfy-job-123', 'comfy');
    expect(controller.getSnapshot().items[0].phase).toBe('cancelled');
  });
  it('cancels an old Fal job through Fal when retrying with Comfy', async () => {
    const id = add();
    vi.mocked(generateInterstitial).mockResolvedValue({ requestId: completed.requestId, status: 'IN_QUEUE' });
    vi.mocked(getInterstitialJob).mockRejectedValueOnce(new Error('Poll interrupted'));
    await controller.generate(id, media, info);
    controller.edit(id, { method: 'comfy' });
    vi.mocked(getInterstitialJob).mockResolvedValue(completed);
    await controller.generate(id, media, info);
    expect(cancelInterstitialJob).toHaveBeenCalledWith(completed.requestId, 'fal');
    expect(getInterstitialJob).toHaveBeenLastCalledWith(completed.requestId, expect.any(AbortSignal), 'comfy');
  });
  it('migrates existing pins without losing labels or source times', () => {
    localStorage.setItem('sparko:pins:v1:legacy', JSON.stringify([{ id: 'a', label: 'Pin 1', time: 3 }, { id: 'b', label: 'Opening', time: 6 }]));
    expect(loadInterstitials('legacy')).toMatchObject([{ label: 'Interstitial 1', time: 3, start_range: 2, end_range: 2, duration: 6, enable_prompt_expansion: false, phase: 'draft' }, { label: 'Opening', time: 6, duration: 6, enable_prompt_expansion: false }]);
    localStorage.setItem(interstitialKey('legacy'), '[]'); expect(loadInterstitials('legacy')).toEqual([]);
  });
  it('tracks preparation through ready and persists only the generated-section bounds', async () => {
    const id = add(); const phases: string[] = [];
    controller.edit(id, { duration: 7.5 });
    controller.subscribe(() => phases.push(controller.getSnapshot().items[0]?.phase));
    vi.mocked(generateInterstitial).mockImplementation(async (_item, _engine, _info, _signal, progress) => { progress('preparing', 0.5); progress('uploading'); return { requestId: 'saved-job-1234', status: 'IN_QUEUE' }; });
    vi.mocked(getInterstitialJob).mockResolvedValue(completed);
    await controller.generate(id, media, info);
    expect(phases).toEqual(expect.arrayContaining(['preparing', 'uploading', 'queued', 'loading', 'ready']));
    expect(loadInterstitials('source')[0].result).toEqual({ url: completed.videoUrl, ...completed.insertion, assetId: 'stored-asset' });
    expect(loadInterstitials('source')[0].duration).toBe(7.5);
    expect(vi.mocked(generateInterstitial).mock.calls[0][0].duration).toBe(7.5);
  });
  it('does not duplicate a paid submission while generation is active', async () => {
    const id = add(); let finish!: (job: { requestId: string; status: 'IN_QUEUE' }) => void;
    vi.mocked(generateInterstitial).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const generation = controller.generate(id, media, info); await controller.generate(id, media, info);
    expect(generateInterstitial).toHaveBeenCalledTimes(1);
    vi.mocked(getInterstitialJob).mockResolvedValue(completed); finish({ requestId: completed.requestId, status: 'IN_QUEUE' }); await generation;
  });
  it('keeps edits during preparation, upload, queueing and loading separate from the submitted inputs', async () => {
    const id = add();
    const submitted = interstitialSettings(controller.getSnapshot().items[0]);
    const edited = new Set<string>();
    controller.subscribe(() => {
      const item = controller.getSnapshot().items[0];
      if (!item || edited.has(item.phase) || item.phase === 'draft') return;
      edited.add(item.phase);
      controller.edit(id, { prompt: `Edited during ${item.phase}`, duration: 7.5 });
    });
    vi.mocked(generateInterstitial).mockImplementation(async (item, _engine, _info, _signal, progress) => {
      expect(interstitialSettings(item)).toEqual(submitted);
      progress('uploading');
      return { requestId: completed.requestId, status: 'IN_QUEUE' };
    });
    vi.mocked(getInterstitialJob).mockResolvedValue(completed);
    await controller.generate(id, media, info);
    expect([...edited]).toEqual(['preparing', 'uploading', 'queued', 'loading', 'ready']);
    expect(controller.getSnapshot().items[0]).toMatchObject({ phase: 'ready', prompt: 'Edited during ready', duration: 7.5, generationSettings: submitted });
    expect(hasUnsubmittedChanges(controller.getSnapshot().items[0])).toBe(true);
    controller.load('source');
    // Opening a saved completed video must not block editing either.
    controller.edit(id, { prompt: 'Edited while reopening' });
    await vi.waitFor(() => expect(controller.getSnapshot().items[0].phase).toBe('ready'));
    expect(loadInterstitials('source')[0]).toMatchObject({ prompt: 'Edited while reopening', generationSettings: submitted });
  });
  it('submits current edits after a download fails if they changed while the job was running', async () => {
    const id = add();
    const original = interstitialSettings(controller.getSnapshot().items[0]);
    vi.mocked(generateInterstitial).mockResolvedValue({ requestId: completed.requestId, status: 'IN_QUEUE' });
    vi.mocked(getInterstitialJob).mockResolvedValue(completed);
    vi.spyOn(assets, 'download').mockImplementationOnce(async () => {
      controller.edit(id, { prompt: 'Edited while downloading' });
      throw new Error('Download interrupted');
    });
    await controller.generate(id, media, info);
    expect(loadInterstitials('source')[0]).toMatchObject({ phase: 'error', prompt: 'Edited while downloading', generationSettings: original, result: { url: completed.videoUrl } });
    controller.load('source');
    vi.mocked(cancelInterstitialJob).mockResolvedValue({ requestId: completed.requestId, status: 'CANCELLED' });
    await controller.generate(id, media, info);
    expect(generateInterstitial).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generateInterstitial).mock.calls[1][0].prompt).toBe('Edited while downloading');
    expect(hasUnsubmittedChanges(controller.getSnapshot().items[0])).toBe(false);
    expect(controller.getSnapshot().items[0].phase).toBe('ready');
  });
  it('retries a completed scene with edited settings and swaps only after the new video loads', async () => {
    const original = await readyScene();
    const changes = { prompt: 'A replacement scene', start_range: 3, end_range: 1.5, duration: 6, enable_prompt_expansion: true };
    controller.edit(original.id, changes);
    expect(playableResult(controller.getSnapshot().items[0])).toEqual(original.result);
    let finish!: (asset: { id: string }) => void;
    vi.spyOn(assets, 'download').mockReturnValueOnce(new Promise(resolve => { finish = resolve as typeof finish; }));
    vi.mocked(generateInterstitial).mockResolvedValue({ requestId: replacement.requestId, status: 'IN_QUEUE' });
    vi.mocked(getInterstitialJob).mockResolvedValue(replacement);
    const retry = controller.generate(original.id, media, info);
    await controller.generate(original.id, media, info);
    await vi.waitFor(() => expect(controller.getSnapshot().items[0].phase).toBe('loading'));
    expect(playableResult(controller.getSnapshot().items[0])).toEqual(original.result);
    expect(loadInterstitials('source')[0].previousResult).toEqual(original.result);
    expect(generateInterstitial).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generateInterstitial).mock.calls[1][0]).toMatchObject(changes);
    expect(cancelInterstitialJob).not.toHaveBeenCalled();
    finish({ id: 'replacement-asset' }); await retry;
    expect(controller.getSnapshot().items[0]).toMatchObject({ ...changes, id: original.id, time: original.time,
      phase: 'ready', requestId: replacement.requestId, previousResult: undefined,
      result: { url: replacement.videoUrl, assetId: 'replacement-asset', ...replacement.insertion } });
  });
  it('preserves the original video after a failed retry and reload, then allows another retry', async () => {
    const original = await readyScene();
    vi.mocked(generateInterstitial).mockResolvedValue({ requestId: replacement.requestId, status: 'IN_QUEUE' });
    vi.mocked(getInterstitialJob).mockRejectedValueOnce(new Error('Replacement rejected'));
    await controller.generate(original.id, media, info);
    expect(playableResult(controller.getSnapshot().items[0])).toEqual(original.result);
    controller.load('source');
    controller.edit(original.id, { prompt: 'Try this scene instead' });
    expect(controller.getSnapshot().items[0]).toMatchObject({ phase: 'error', error: 'Replacement rejected', previousResult: original.result });
    vi.mocked(cancelInterstitialJob).mockResolvedValue({ requestId: replacement.requestId, status: 'CANCELLED' });
    vi.mocked(getInterstitialJob).mockResolvedValue(replacement);
    await controller.generate(original.id, media, info);
    expect(generateInterstitial).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot().items[0]).toMatchObject({ phase: 'ready', result: { url: replacement.videoUrl }, previousResult: undefined, error: undefined });
  });
  it('keeps the original on a failed replacement download and retries downloading without paying again', async () => {
    const original = await readyScene();
    vi.mocked(generateInterstitial).mockResolvedValue({ requestId: replacement.requestId, status: 'IN_QUEUE' });
    vi.mocked(getInterstitialJob).mockResolvedValue(replacement);
    vi.spyOn(assets, 'download').mockRejectedValueOnce(new Error('Download interrupted'));
    await controller.generate(original.id, media, info);
    expect(controller.getSnapshot().items[0]).toMatchObject({ phase: 'error', previousResult: original.result, result: { url: replacement.videoUrl } });
    expect(playableResult(controller.getSnapshot().items[0])).toEqual(original.result);
    await controller.generate(original.id, media, info);
    expect(controller.getSnapshot().items[0]).toMatchObject({ phase: 'ready', previousResult: undefined, result: { url: replacement.videoUrl } });
    expect(generateInterstitial).toHaveBeenCalledTimes(2);
    expect(cancelInterstitialJob).not.toHaveBeenCalled();
  });
  it('retains the original when a replacement has invalid video boundaries', async () => {
    const original = await readyScene();
    vi.mocked(getInterstitialJob).mockResolvedValue({ ...replacement, insertion: { start: 2, duration: 10, totalDuration: 12 } });
    await controller.generate(original.id, media, info);
    expect(controller.getSnapshot().items[0]).toMatchObject({ phase: 'error', error: 'The returned video does not contain the full interstitial.', previousResult: original.result });
    expect(playableResult(controller.getSnapshot().items[0])).toEqual(original.result);
  });
  it('cancels only the replacement and retains the original video, ignoring late results', async () => {
    const original = await readyScene();
    vi.mocked(generateInterstitial).mockResolvedValue({ requestId: replacement.requestId, status: 'IN_QUEUE' });
    let finish!: (value: typeof replacement) => void;
    vi.mocked(getInterstitialJob).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    vi.mocked(cancelInterstitialJob).mockResolvedValue({ requestId: replacement.requestId, status: 'CANCELLED' });
    const retry = controller.generate(original.id, media, info);
    await vi.waitFor(() => expect(controller.getSnapshot().items[0].phase).toBe('queued'));
    await controller.cancel(original.id);
    finish(replacement); await retry;
    expect(cancelInterstitialJob).toHaveBeenCalledExactlyOnceWith(replacement.requestId, 'fal');
    expect(controller.getSnapshot().items[0]).toMatchObject({ phase: 'cancelled', previousResult: original.result, result: undefined });
    expect(playableResult(controller.getSnapshot().items[0])).toEqual(original.result);
    controller.load('source');
    expect(playableResult(controller.getSnapshot().items[0])).toEqual(original.result);
    await controller.remove(original.id);
    expect(controller.getSnapshot().items).toEqual([]);
  });
  it('ignores late results from a previous source and cancels orphaned submissions', async () => {
    const id = add(); let finish!: (job: { requestId: string; status: 'IN_QUEUE' }) => void;
    vi.mocked(generateInterstitial).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    vi.mocked(cancelInterstitialJob).mockResolvedValue({ requestId: completed.requestId, status: 'CANCELLED' });
    const generation = controller.generate(id, media, info); controller.load('different-source');
    finish({ requestId: completed.requestId, status: 'IN_QUEUE' }); await generation;
    expect(controller.getSnapshot().items).toEqual([]); expect(cancelInterstitialJob).toHaveBeenCalledWith(completed.requestId, 'fal');
  });
  it('retries failed polling without submitting another generation', async () => {
    const id = add(); vi.mocked(generateInterstitial).mockResolvedValue({ requestId: completed.requestId, status: 'IN_QUEUE' });
    vi.mocked(getInterstitialJob).mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValue(completed);
    await controller.generate(id, media, info);
    expect(controller.getSnapshot().items[0]).toMatchObject({ phase: 'error', requestId: completed.requestId });
    await controller.resume(id);
    expect(controller.getSnapshot().items[0].phase).toBe('ready'); expect(generateInterstitial).toHaveBeenCalledTimes(1);
  });
  it('keeps failures editable after reload and retries once with the corrected settings', async () => {
    const id = add();
    vi.mocked(generateInterstitial).mockResolvedValueOnce({ requestId: completed.requestId, status: 'IN_QUEUE' })
      .mockResolvedValueOnce({ requestId: 'retry-job-1234', status: 'IN_QUEUE' });
    vi.mocked(getInterstitialJob).mockRejectedValueOnce(new Error('Provider rejected the reference')).mockResolvedValue({ ...completed, requestId: 'retry-job-1234' });
    vi.mocked(cancelInterstitialJob).mockResolvedValue({ requestId: completed.requestId, status: 'CANCELLED' });
    await controller.generate(id, media, info);
    controller.load('source');
    const changes = { prompt: 'A corrected scene', start_range: 3, end_range: 1.5, duration: 7.5, enable_prompt_expansion: true };
    controller.edit(id, changes);
    expect(loadInterstitials('source')[0]).toMatchObject({ ...changes, id, time: 5, phase: 'error', error: 'Provider rejected the reference' });
    await Promise.all([controller.generate(id, media, info), controller.generate(id, media, info)]);
    expect(generateInterstitial).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generateInterstitial).mock.calls[1][0]).toMatchObject(changes);
    expect(cancelInterstitialJob).toHaveBeenCalledExactlyOnceWith(completed.requestId, 'fal');
    expect(controller.getSnapshot().items).toHaveLength(1);
    expect(controller.getSnapshot().items[0]).toMatchObject({ ...changes, id, time: 5, phase: 'ready', requestId: 'retry-job-1234', error: undefined });
  });
  it.each([false, true])('retries a failed download, regenerating only when the draft changed: %s', async edited => {
    const id = add();
    vi.mocked(generateInterstitial).mockResolvedValue({ requestId: completed.requestId, status: 'IN_QUEUE' });
    vi.mocked(getInterstitialJob).mockResolvedValue(completed);
    vi.mocked(cancelInterstitialJob).mockResolvedValue({ requestId: completed.requestId, status: 'CANCELLED' });
    const download = vi.spyOn(assets, 'download').mockRejectedValueOnce(new Error('Download interrupted'));
    await controller.generate(id, media, info);
    expect(controller.getSnapshot().items[0]).toMatchObject({ phase: 'error', error: 'Download interrupted', result: { url: completed.videoUrl } });
    if (edited) controller.edit(id, { prompt: 'A different scene' });
    await controller.generate(id, media, info);
    expect(controller.getSnapshot().items[0].phase).toBe('ready');
    expect(download).toHaveBeenCalledTimes(2);
    expect(generateInterstitial).toHaveBeenCalledTimes(edited ? 2 : 1);
    expect(cancelInterstitialJob).toHaveBeenCalledTimes(edited ? 1 : 0);
  });
  it('keeps a failed job attached if remote cancellation fails', async () => {
    const id = add(); vi.mocked(generateInterstitial).mockResolvedValue({ requestId: completed.requestId, status: 'IN_QUEUE' });
    vi.mocked(getInterstitialJob).mockRejectedValue(new Error('Network unavailable'));
    await controller.generate(id, media, info);
    vi.mocked(cancelInterstitialJob).mockRejectedValue(new Error('Network unavailable'));
    controller.edit(id, { prompt: 'A corrected scene' });
    await controller.generate(id, media, info); await controller.remove(id);
    expect(controller.getSnapshot().items[0]).toMatchObject({ phase: 'error', requestId: completed.requestId, prompt: 'A corrected scene' });
    controller.edit(id, { duration: 8 }); expect(controller.getSnapshot().items[0].duration).toBe(8);
    expect(generateInterstitial).toHaveBeenCalledTimes(1);
  });
  it('moves failed and completed scenes without changing their job, prompt or generated asset', async () => {
    const id = add();
    vi.mocked(generateInterstitial).mockResolvedValue({ requestId: completed.requestId, status: 'IN_QUEUE' });
    vi.mocked(getInterstitialJob).mockRejectedValueOnce(new Error('Provider rejected the reference')).mockResolvedValue(completed);
    await controller.generate(id, media, info);
    const failed = controller.getSnapshot().items[0];
    controller.move(id, 8);
    expect(controller.getSnapshot().items[0]).toEqual({ ...failed, time: 8 });
    await controller.resume(id);
    const ready = controller.getSnapshot().items[0];
    expect(ready.phase).toBe('ready');
    controller.move(id, 12);
    expect(controller.getSnapshot().items[0]).toEqual({ ...ready, time: 12 });
    expect(loadInterstitials('source')[0]).toEqual({ ...ready, time: 12 });
    expect(generateInterstitial).toHaveBeenCalledOnce();
    expect(cancelInterstitialJob).not.toHaveBeenCalled();
  });
});
