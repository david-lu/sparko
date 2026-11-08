import { describe, expect, it, vi } from 'vitest';
import { createAnalysisProviders } from '../../server/features/video-analysis/providers';
import type { AIClients } from '../../server/shared/ai-clients';

describe('Gemini video analysis', () => {
  it.each([undefined, 'reference-timing'] as const)('samples short reference actions more closely and deletes the upload: %s', async purpose => {
    const upload = vi.fn(async () => ({ name: 'files/reference', uri: 'https://provider.test/reference', state: 'ACTIVE' }));
    const remove = vi.fn().mockResolvedValue({}), generateContent = vi.fn(async (_input: any) => ({ text: JSON.stringify({ caption: 'A wave', description: '0–1.625s: she waves, then waits silently.' }) }));
    const gemini = { files: { upload, delete: remove }, models: { generateContent } } as unknown as AIClients['gemini'];
    const signal = new AbortController().signal;
    const result = await createAnalysisProviders({ openai: null, gemini }).gemini({ start: 0, end: 1.625, videoPath: '/tmp/trimmed-reference.mp4', instructions: 'Describe the boundary poses and timed speech.', purpose, signal });
    expect(result).toMatchObject({ start: 0, end: 1.625, description: '0–1.625s: she waves, then waits silently.' });
    const options = generateContent.mock.calls[0][0] as any;
    expect(options.contents[0].parts[0].videoMetadata).toEqual(purpose ? { fps: 24, startOffset: '0s', endOffset: '1.625s' } : undefined);
    expect(options.config.abortSignal).toBe(signal);
    expect(remove).toHaveBeenCalledWith({ name: 'files/reference' });
  });
  it('deletes an uploaded reference if inference fails', async () => {
    const remove = vi.fn().mockResolvedValue({}), generateContent = vi.fn().mockRejectedValue(new Error('Provider unavailable'));
    const gemini = { files: { upload: vi.fn(async () => ({ name: 'files/reference', uri: 'https://provider.test/reference', state: 'ACTIVE' })), delete: remove }, models: { generateContent } } as unknown as AIClients['gemini'];
    await expect(createAnalysisProviders({ openai: null, gemini }).gemini({ start: 0, end: 1.625, videoPath: '/tmp/reference.mp4', instructions: '', signal: new AbortController().signal, purpose: 'reference-timing' })).rejects.toThrow('Provider unavailable');
    expect(remove).toHaveBeenCalledWith({ name: 'files/reference' });
  });
});
