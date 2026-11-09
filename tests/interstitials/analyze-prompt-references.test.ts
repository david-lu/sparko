import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzePromptReferences } from '../../src/features/interstitials/analyze-prompt-references';
import { generationSource } from '../../src/features/call-response/generation';
import { analyzeGeminiVideo } from '../../src/features/video-analysis/api';
import type { MediaEngine } from '../../src/media/MediaEngine';
import type { GenerationReference, Interstitial } from '../../shared/interstitials';

vi.mock('../../src/features/call-response/generation', () => ({ generationSource: vi.fn() }));
vi.mock('../../src/features/video-analysis/api', () => ({ analyzeGeminiVideo: vi.fn() }));
const item: Interstitial = { id: 'clip', label: 'Clip', phase: 'draft', time: 10, start_range: 2, end_range: 3, duration: 6, prompt: 'Wave.', enable_prompt_expansion: false };
const info = { duration: 20, width: 960, height: 544, fps: 24, hasAudio: true, codec: 'avc' };
const exportMp4 = vi.fn(), engine = { exportMp4 } as unknown as MediaEngine;
const reference: GenerationReference = { before: { sceneId: 'before', assetId: 'before', inFrame: 0, outFrame: 96 }, mode: 'loop' };
beforeEach(() => {
  vi.resetAllMocks();
  exportMp4.mockResolvedValue(new Blob(['video with audio'], { type: 'video/mp4' }));
  vi.mocked(analyzeGeminiVideo).mockImplementation(async (source, slice, _instructions, signal) => {
    await source.exportMp4(slice, { signal });
    return { caption: 'Reference', description: '0–0.8s: she lowers the rock. 0.8–1.6s: hands empty, silent.', provider: 'gemini', model: 'test', ...slice, basis: 'Video and audio' };
  });
});

describe('video reference analysis', () => {
  it('exports only quantized start/end windows and gives each description a zero-based clock', async () => {
    const signal = new AbortController().signal;
    const result = await analyzePromptReferences(item, undefined, engine, info, signal);
    expect(exportMp4.mock.calls).toEqual([
      [{ start: 10 - 39 / 24, end: 10 }, { signal }],
      [{ start: 10, end: 10 + 56 / 24 }, { signal }],
    ]);
    expect(result.map(({ side, frames }) => ({ side, frames }))).toEqual([{ side: 'start', frames: 39 }, { side: 'end', frames: 56 }]);
    for (const [index, call] of vi.mocked(analyzeGeminiVideo).mock.calls.entries()) {
      expect(call[1]).toEqual({ start: 0, end: result[index].frames / 24 });
      expect(call[2]).toContain('exact audible words');
      expect(call[5]).toBe('reference-timing');
    }
  });
  it('analyzes the assembled sequence including the held, silent ending of a loop', async () => {
    const loop = { ...item, method: 'comfy-loop' as const, start_range: 4, end_range: 4 };
    vi.mocked(generationSource).mockResolvedValue({ item: { ...loop, time: 4 }, engine, info: { ...info, duration: 8 } });
    const signal = new AbortController().signal;
    const descriptions = await analyzePromptReferences(loop, reference, null, null, signal);
    expect(generationSource).toHaveBeenCalledWith(loop, reference, signal, null);
    expect(exportMp4.mock.calls.map(call => call[0])).toEqual([{ start: .25, end: 4 }, { start: 4, end: 7.75 }]);
    expect(descriptions.map(value => value.frames)).toEqual([90, 90]);
  });
  it.each([true, false])('skips disabled video references, input enabled: %s', async useInputReference => {
    await analyzePromptReferences({ ...item, useInputReference, useOutputReference: !useInputReference }, undefined, engine, info, new AbortController().signal);
    expect(analyzeGeminiVideo).toHaveBeenCalledOnce();
    expect(vi.mocked(analyzeGeminiVideo).mock.calls[0][2]).toContain(`${useInputReference ? 'start' : 'end'} reference`);
  });
  it('stops before the second upload on cancellation or failure', async () => {
    const operation = new AbortController();
    vi.mocked(analyzeGeminiVideo).mockImplementationOnce(async () => { operation.abort(); throw new Error('Cancelled'); });
    await expect(analyzePromptReferences(item, undefined, engine, info, operation.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(analyzeGeminiVideo).toHaveBeenCalledOnce();
    vi.mocked(analyzeGeminiVideo).mockClear().mockRejectedValueOnce(new Error('Provider unavailable.'));
    await expect(analyzePromptReferences(item, undefined, engine, info, new AbortController().signal)).rejects.toThrow('Could not analyze the start reference: Provider unavailable. Your draft has been kept.');
    expect(analyzeGeminiVideo).toHaveBeenCalledOnce();
  });
});
