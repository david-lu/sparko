import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InterstitialController } from '../../src/features/interstitials/InterstitialController';
import { loadInterstitials, interstitialKey } from '../../src/features/interstitials/storage';
import { cancelInterstitialJob, generateInterstitial, getInterstitialJob } from '../../src/features/interstitials/api';
import type { MediaEngine } from '../../src/media/MediaEngine';

vi.mock('../../src/features/interstitials/api', () => ({ generateInterstitial: vi.fn(), getInterstitialJob: vi.fn(), cancelInterstitialJob: vi.fn() }));
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
afterEach(() => { controller.dispose(); vi.unstubAllGlobals(); });
const add = () => { const item = controller.add(5, 20); controller.edit(item.id, { prompt: 'A scene' }); return item.id; };
const completed = { requestId: 'saved-job-1234', status: 'COMPLETED' as const, videoUrl: 'https://fal.media/result.mp4', insertion: { start: 2, duration: 5, totalDuration: 9 } };

describe('interstitial lifecycle', () => {
  it('migrates existing pins without losing labels or source times', () => {
    localStorage.setItem('sparko:pins:v1:legacy', JSON.stringify([{ id: 'a', label: 'Pin 1', time: 3 }, { id: 'b', label: 'Opening', time: 6 }]));
    expect(loadInterstitials('legacy')).toMatchObject([{ label: 'Interstitial 1', time: 3, start_range: 2, end_range: 2, phase: 'draft' }, { label: 'Opening', time: 6 }]);
    localStorage.setItem(interstitialKey('legacy'), '[]'); expect(loadInterstitials('legacy')).toEqual([]);
  });
  it('tracks preparation through ready and persists only the generated-section bounds', async () => {
    const id = add(); const phases: string[] = [];
    controller.subscribe(() => phases.push(controller.getSnapshot().items[0]?.phase));
    vi.mocked(generateInterstitial).mockImplementation(async (_item, _engine, _info, _signal, progress) => { progress('preparing', 0.5); progress('uploading'); return { requestId: 'saved-job-1234', status: 'IN_QUEUE' }; });
    vi.mocked(getInterstitialJob).mockResolvedValue(completed);
    await controller.generate(id, media, info);
    expect(phases).toEqual(expect.arrayContaining(['preparing', 'uploading', 'queued', 'loading', 'ready']));
    expect(loadInterstitials('source')[0].result).toEqual({ url: completed.videoUrl, ...completed.insertion, assetId: 'stored-asset' });
  });
  it('does not duplicate a paid submission while generation is active', async () => {
    const id = add(); let finish!: (job: { requestId: string; status: 'IN_QUEUE' }) => void;
    vi.mocked(generateInterstitial).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const generation = controller.generate(id, media, info); await controller.generate(id, media, info);
    expect(generateInterstitial).toHaveBeenCalledTimes(1);
    vi.mocked(getInterstitialJob).mockResolvedValue(completed); finish({ requestId: completed.requestId, status: 'IN_QUEUE' }); await generation;
  });
  it('ignores late results from a previous source and cancels orphaned submissions', async () => {
    const id = add(); let finish!: (job: { requestId: string; status: 'IN_QUEUE' }) => void;
    vi.mocked(generateInterstitial).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    vi.mocked(cancelInterstitialJob).mockResolvedValue({ requestId: completed.requestId, status: 'CANCELLED' });
    const generation = controller.generate(id, media, info); controller.load('different-source');
    finish({ requestId: completed.requestId, status: 'IN_QUEUE' }); await generation;
    expect(controller.getSnapshot().items).toEqual([]); expect(cancelInterstitialJob).toHaveBeenCalledWith(completed.requestId);
  });
  it('retries failed polling without submitting another generation', async () => {
    const id = add(); vi.mocked(generateInterstitial).mockResolvedValue({ requestId: completed.requestId, status: 'IN_QUEUE' });
    vi.mocked(getInterstitialJob).mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValue(completed);
    await controller.generate(id, media, info);
    expect(controller.getSnapshot().items[0]).toMatchObject({ phase: 'error', requestId: completed.requestId });
    await controller.resume(id);
    expect(controller.getSnapshot().items[0].phase).toBe('ready'); expect(generateInterstitial).toHaveBeenCalledTimes(1);
  });
  it('keeps a failed job attached if remote cancellation fails', async () => {
    const id = add(); vi.mocked(generateInterstitial).mockResolvedValue({ requestId: completed.requestId, status: 'IN_QUEUE' });
    vi.mocked(getInterstitialJob).mockRejectedValue(new Error('Network unavailable'));
    await controller.generate(id, media, info);
    vi.mocked(cancelInterstitialJob).mockRejectedValue(new Error('Network unavailable'));
    await controller.reset(id); await controller.remove(id);
    expect(controller.getSnapshot().items[0]).toMatchObject({ phase: 'error', requestId: completed.requestId });
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
