import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureGenerationPromptFrame } from '../../src/features/interstitials/generation-prompt-frame';
import { createGenerationWorkspace } from '../../src/features/interstitials/GenerationWorkspace';
import { createGenerationPreview, generationPreviewReducer } from '../../src/features/interstitials/generation-preview';
import { sampleFrame } from '../../src/media/media';
import { imagePreview } from '../../src/media/imagePreview';
import { assets } from '../../src/features/project/assets';

vi.mock('../../src/media/media', () => ({ sampleFrame: vi.fn() }));
vi.mock('../../src/media/imagePreview', () => ({ imagePreview: vi.fn() }));
vi.mock('../../src/features/project/assets', () => ({ assets: { open: vi.fn() } }));
const blob = new Blob(['image'], { type: 'image/png' });
const preview = () => createGenerationPreview(200, 90, 'blob:generated', 120);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assets.open).mockResolvedValue({ asset: { id: 'reference', name: 'Reference', blob }, url: 'blob:reference' });
  vi.mocked(sampleFrame).mockResolvedValue({ url: 'data:image/jpeg;base64,YQ==', time: 0 });
  vi.mocked(imagePreview).mockResolvedValue('data:image/jpeg;base64,Yg==');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(blob)));
});
afterEach(() => vi.unstubAllGlobals());

describe('generation prompt snapshots', () => {
  it('captures the trimmed reference source frame, independently of the generation clock', async () => {
    const signal = new AbortController().signal;
    expect(await captureGenerationPromptFrame(preview(), { assetId: 'reference', sourceFrame: 72, label: 'Trim' }, signal)).toBe('data:image/jpeg;base64,Yg==');
    expect(sampleFrame).toHaveBeenCalledWith({ id: 'reference', name: 'Trim', url: 'blob:reference' }, 3, 512, signal);
    expect(imagePreview).toHaveBeenCalledOnce();
  });
  it('captures the generated video at its own playhead even when a reference is present', async () => {
    const state = generationPreviewReducer(preview(), { type: 'mode', mode: 'generated' }), signal = new AbortController().signal;
    await captureGenerationPromptFrame(state, { assetId: 'reference', sourceFrame: 72, label: 'Trim' }, signal);
    expect(assets.open).not.toHaveBeenCalled();
    expect(sampleFrame).toHaveBeenCalledWith({ id: 'generated-preview', name: 'Generated preview', url: 'blob:generated' }, 3.75, 512, signal);
  });
  it('captures image keyframes directly with the same size limit as other prompt pictures', async () => {
    const signal = new AbortController().signal;
    await captureGenerationPromptFrame(preview(), { assetId: 'image', kind: 'image', sourceFrame: 0, label: 'Pose' }, signal);
    expect(assets.open).toHaveBeenCalledWith('image'); expect(imagePreview).toHaveBeenCalledWith(blob, signal);
    expect(sampleFrame).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([undefined, { assetId: 'audio', kind: 'audio' as const, sourceFrame: 0, label: 'Audio' }])('does not invent a picture for an empty visual input: %s', async input => {
    expect(await captureGenerationPromptFrame(preview(), input, new AbortController().signal)).toBeUndefined();
    expect(assets.open).not.toHaveBeenCalled(); expect(sampleFrame).not.toHaveBeenCalled();
  });
  it('reports a missing referenced asset rather than sending a different frame', async () => {
    vi.mocked(assets.open).mockRejectedValueOnce(new Error('This asset was deleted from the Library.'));
    await expect(captureGenerationPromptFrame(preview(), { assetId: 'missing', sourceFrame: 0, label: 'Missing' }, new AbortController().signal)).rejects.toThrow('deleted');
    expect(sampleFrame).not.toHaveBeenCalled();
  });
  it('stops if cancelled while opening the input asset', async () => {
    const operation = new AbortController();
    vi.mocked(assets.open).mockImplementationOnce(async () => { operation.abort(); return { asset: { id: 'reference', name: 'Reference', blob }, url: 'blob:reference' }; });
    await expect(captureGenerationPromptFrame(preview(), { assetId: 'reference', sourceFrame: 0, label: 'Reference' }, operation.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(sampleFrame).not.toHaveBeenCalled(); expect(imagePreview).not.toHaveBeenCalled();
  });
});

describe('generation snapshot ownership', () => {
  it('keeps the registered snapshot when opening the already-visible timeline', () => {
    const workspace = createGenerationWorkspace(vi.fn(), vi.fn()), capture = vi.fn();
    workspace.open('current'); workspace.registerFrameCapture(capture); workspace.open('current');
    expect(workspace.getFrameCapture()).toBe(capture);
  });
  it('restores the story capture fallback when the generation preview unmounts', () => {
    const workspace = createGenerationWorkspace(vi.fn(), vi.fn()), capture = vi.fn();
    expect(workspace.getFrameCapture()).toBeUndefined();
    const unregister = workspace.registerFrameCapture(capture);
    expect(workspace.getFrameCapture()).toBe(capture);
    unregister(); expect(workspace.getFrameCapture()).toBeUndefined();
  });
  it('does not let an obsolete preview cleanup remove the new capture source', () => {
    const workspace = createGenerationWorkspace(vi.fn(), vi.fn()), latest = vi.fn();
    const unregister = workspace.registerFrameCapture(vi.fn());
    workspace.registerFrameCapture(latest); unregister();
    expect(workspace.getFrameCapture()).toBe(latest);
  });
  it('clears the old source when switching or closing the generation workspace', () => {
    const open = vi.fn(), close = vi.fn(), workspace = createGenerationWorkspace(open, close);
    workspace.registerFrameCapture(vi.fn()); workspace.open('next');
    expect(open).toHaveBeenCalledWith('next'); expect(workspace.getFrameCapture()).toBeUndefined();
    workspace.registerFrameCapture(vi.fn()); workspace.close();
    expect(close).toHaveBeenCalledOnce(); expect(workspace.getFrameCapture()).toBeUndefined();
  });
});
