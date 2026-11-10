import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InterstitialController } from '../../src/features/interstitials/InterstitialController';
import { cancelInterstitialJob, generateInterstitial, getInterstitialJob, upscaleInterstitial } from '../../src/features/interstitials/api';
import { upscaleLabel, upscaleSource } from '../../src/features/interstitials/upscale';
import { loadInterstitials, saveInterstitials } from '../../src/features/interstitials/storage';
import { assets } from '../../src/features/project/assets';
import { hasUnsubmittedChanges, type Interstitial } from '../../shared/interstitials';
import type { MediaEngine } from '../../src/media/MediaEngine';

vi.mock('../../src/features/interstitials/api', () => ({ generateInterstitial: vi.fn(), getInterstitialJob: vi.fn(), cancelInterstitialJob: vi.fn(), upscaleInterstitial: vi.fn() }));
vi.mock('../../src/features/interstitials/progress-stream', () => ({ watchComfyJob: vi.fn() }));
vi.mock('../../src/features/call-response/generation', () => ({ generationSource: vi.fn() }));
vi.mock('../../src/media/clipMetadata', () => ({ readClipMetadata: vi.fn(), writeClipMetadata: vi.fn(async blob => blob) }));
vi.mock('../../src/media/MediaEngine', () => ({ MediaEngine: class { inspect() { return Promise.resolve({ duration: 9, fps: 24 }); } dispose() {} } }));
vi.mock('../../src/features/project/assets', () => ({ assets: {
  fetch: vi.fn(), save: vi.fn(), open: vi.fn(), download: vi.fn(), error: vi.fn(),
} }));
const info = { duration: 20, fps: 24, width: 1280, height: 720, codec: 'avc', hasAudio: true };
const native = { requestId: 'native-job-1234', status: 'COMPLETED' as const, videoUrl: 'https://example.test/native.mp4', insertion: { start: 2, duration: 5, totalDuration: 9 } };
const upscaled = { requestId: 'upscale-job-1234', status: 'COMPLETED' as const, videoUrl: '/api/comfy/assets/upscale-output-1234/content' };
let controller: InterstitialController, saved = 0;
beforeEach(() => {
  vi.resetAllMocks(); saved = 0;
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
  vi.mocked(assets.fetch).mockResolvedValue({ id: 'fetched', name: 'video.mp4', blob: new Blob(['native']) });
  vi.mocked(assets.save).mockImplementation(async () => ({ id: `native-asset-${++saved}`, name: 'video.mp4', blob: new Blob(['native']) }));
  vi.mocked(assets.open).mockImplementation(async id => ({ url: `blob:${id}`, asset: { id, name: 'video.mp4', blob: new Blob([id]) } }));
  vi.mocked(assets.download).mockResolvedValue({ id: 'upscaled-asset', name: 'Untitled 2K.mp4', blob: new Blob(['2k']) });
  vi.mocked(generateInterstitial).mockResolvedValue({ requestId: native.requestId, status: 'IN_QUEUE' });
  vi.mocked(upscaleInterstitial).mockResolvedValue({ requestId: upscaled.requestId, status: 'IN_QUEUE' });
  vi.mocked(getInterstitialJob).mockImplementation(async id => id === upscaled.requestId ? upscaled : { ...native, requestId: id });
  controller = new InterstitialController(); controller.load('source');
});
afterEach(() => { controller.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const item = () => controller.getSnapshot().items[0];
async function ready() {
  const { id } = controller.add(5, 20); controller.edit(id, { prompt: 'A rainy street' });
  await controller.generate(id, {} as MediaEngine, info);
  expect(item().phase).toBe('ready');
  return id;
}

describe('upscale source', () => {
  const result = { url: 'asset:a', assetId: 'trimmed', start: 1, duration: 4, totalDuration: 4.5, prompt: 'Exact prompt' };
  const base = { id: 'clip', label: 'Clip', time: 0, start_range: 2, end_range: 2, duration: 6, prompt: 'Edited prompt', enable_prompt_expansion: false, phase: 'ready' } as Interstitial;
  it('uses the complete render, its exact prompt and offsets exact-frame keyframes into it', () => {
    const loop = { ...result, fullAssetId: 'full', fullRange: { start: 39 / 24, duration: 6, totalDuration: 226 / 24 } };
    const keyframes = [{ id: 'k1', frame: 10, enabled: true, method: 'frame' as const, image: { assetId: 'img', name: 'Pose' } },
      { id: 'k2', frame: 20, enabled: true, method: 'guide' as const, image: { assetId: 'img', name: 'Guide' } }, { id: 'k3', frame: 30, enabled: false, method: 'frame' as const, image: { assetId: 'img', name: 'Off' } }];
    expect(upscaleSource({ ...base, result: loop, generationSettings: { ...base, keyframes } })).toEqual({ result: loop, assetId: 'full', frames: 226, prompt: 'Exact prompt', preservedFrames: [49] });
  });
  it('explains why a render cannot be upscaled', () => {
    expect(upscaleSource(base)).toEqual({ error: expect.stringContaining('Generate a video first') });
    expect(upscaleSource({ ...base, result: { ...result, totalDuration: 106 / 24 } })).toEqual({ error: expect.stringContaining('4.46 seconds') });
    expect(upscaleSource({ ...base, result: { ...result, totalDuration: 6, prompt: undefined } })).toEqual({ error: expect.stringContaining('no saved prompt') });
  });
  it('labels each job phase', () => {
    expect(upscaleLabel({ phase: 'queued', sourceAssetId: 'a', queuePosition: 1 })).toBe('Queued for 2K · position 2');
    expect(upscaleLabel({ phase: 'rendering', sourceAssetId: 'a', progressDetails: { stage: 'Regenerating with H3 2K', step: 1, steps: 4 } })).toBe('25% · Regenerating with H3 2K');
    expect(upscaleLabel({ phase: 'loading', sourceAssetId: 'a', progress: 0.5 })).toBe('Downloading 2K video · 50%');
  });
});

describe('on-demand 2K upscale', () => {
  it('generates natively even when older settings ask for 2K, without marking the clip edited', async () => {
    const { id } = controller.add(5, 20); controller.edit(id, { prompt: 'A rainy street', resolution: '2k' });
    await controller.generate(id, {} as MediaEngine, info);
    expect(vi.mocked(generateInterstitial).mock.calls[0][0].resolution).toBe('native');
    expect(item().generationSettings?.resolution).toBe('native'); expect(hasUnsubmittedChanges(item())).toBe(false);
  });
  it('uploads the saved complete render with its exact prompt and attaches the 2K video to that render', async () => {
    const id = await ready(), render = item().result!;
    await controller.upscale(id);
    const [blob, request] = vi.mocked(upscaleInterstitial).mock.calls[0];
    expect(await blob.text()).toBe(render.assetId); expect(request).toEqual({ prompt: 'A rainy street', preservedFrames: [] });
    expect(assets.download).toHaveBeenCalledWith(upscaled.videoUrl, 'Untitled 2K.mp4', expect.any(AbortSignal), expect.any(Function));
    expect(item().upscale).toBeUndefined();
    expect(item().result).toEqual({ ...render, upscaled: { assetId: 'upscaled-asset', totalDuration: 9 } });
    expect(generateInterstitial).toHaveBeenCalledTimes(1);
  });
  it('keeps the 2K video with the render it came from, so a replacement render has none', async () => {
    const id = await ready(); await controller.upscale(id);
    const first = item().result!;
    vi.mocked(getInterstitialJob).mockImplementation(async () => new Promise(() => {}));
    void controller.generate(id, {} as MediaEngine, info);
    await vi.waitFor(() => expect(item().phase).toBe('queued'));
    expect(item().previousResult?.upscaled).toEqual(first.upscaled);
    await controller.cancel(id);
    vi.mocked(getInterstitialJob).mockImplementation(async requestId => ({ ...native, requestId }));
    await controller.generate(id, {} as MediaEngine, info);
    expect(item().result?.assetId).not.toBe(first.assetId); expect(item().result?.upscaled).toBeUndefined();
  });
  it('resumes a submitted 2K job after reopening instead of paying again', async () => {
    const id = await ready(), saved = { ...item(), upscale: { phase: 'rendering' as const, sourceAssetId: item().result!.assetId!, requestId: upscaled.requestId, progress: 0.4 } };
    controller.load('source', [saved]);
    await vi.waitFor(() => expect(item().result?.upscaled).toEqual({ assetId: 'upscaled-asset', totalDuration: 9 }));
    expect(upscaleInterstitial).not.toHaveBeenCalled(); expect(item().upscale).toBeUndefined(); expect(item().id).toBe(id);
  });
  it('marks a request interrupted before submission as failed', async () => {
    await ready();
    controller.load('source', [{ ...item(), upscale: { phase: 'uploading', sourceAssetId: item().result!.assetId! } }]);
    expect(item().upscale).toMatchObject({ phase: 'error', error: expect.stringContaining('interrupted') });
  });
  it('cancels the remote job and reports failures without losing the native render', async () => {
    const id = await ready();
    vi.mocked(getInterstitialJob).mockImplementation(async requestId => requestId === upscaled.requestId ? { requestId, status: 'IN_PROGRESS' } : { ...native, requestId });
    const running = controller.upscale(id);
    await vi.waitFor(() => expect(item().upscale?.requestId).toBe(upscaled.requestId));
    expect(await controller.cancelUpscale(id)).toBe(true); await running;
    expect(cancelInterstitialJob).toHaveBeenCalledWith(upscaled.requestId);
    expect(item().upscale).toMatchObject({ phase: 'cancelled' }); expect(item().phase).toBe('ready');
    vi.mocked(upscaleInterstitial).mockRejectedValue(new Error('Comfy is missing required 2K nodes: MinimaxHailuo03RegenerateNode.'));
    await controller.upscale(id);
    expect(item().upscale).toMatchObject({ phase: 'error', error: expect.stringContaining('MinimaxHailuo03RegenerateNode') }); expect(item().result?.upscaled).toBeUndefined();
  });
  it('persists the 2K video and resumable job without transient progress', async () => {
    await ready();
    const stored = { ...item(), result: { ...item().result!, upscaled: { assetId: 'upscaled-asset', totalDuration: 9 } },
      upscale: { phase: 'rendering' as const, sourceAssetId: 'native-asset-1', requestId: upscaled.requestId, progress: 0.5, progressDetails: { stage: 'Regenerating' } } };
    saveInterstitials('persisted', [stored]);
    const [restored] = loadInterstitials('persisted');
    expect(restored.result?.upscaled).toEqual({ assetId: 'upscaled-asset', totalDuration: 9 });
    expect(restored.upscale).toEqual({ phase: 'rendering', sourceAssetId: 'native-asset-1', requestId: upscaled.requestId });
  });
});
