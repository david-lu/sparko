import { describe, expect, it } from 'vitest';
import { generationPrompt, promptEnhancementPatch, promptSelectionError, promptSettingsPatch } from '../shared/prompt-versions';

describe('separate prompt versions', () => {
  const original = { prompt: 'A room.' }, pair = { ...original, enhancedPrompt: 'A quiet room in soft light.', useEnhancedPrompt: true };
  it('keeps old projects on their original prompt and never silently falls back from an enhanced selection', () => {
    expect(generationPrompt(original)).toBe(original.prompt);
    expect(generationPrompt(pair)).toBe(pair.enhancedPrompt);
    expect(generationPrompt({ ...original, useEnhancedPrompt: true })).toBe('');
    expect(promptSelectionError({ ...original, useEnhancedPrompt: true })).toBeTruthy();
    expect(promptSelectionError({ ...pair, enhancedPromptStale: true })).toBeTruthy();
    expect(promptSelectionError({ ...pair, enhancedPromptStale: true, useEnhancedPrompt: false })).toBeUndefined();
  });
  it('preserves the source during enhancement and updates a pair atomically during editing', () => {
    expect({ ...original, ...promptEnhancementPatch(original, { prompt: pair.enhancedPrompt }, false) }).toEqual({ ...pair, enhancedPromptStale: false });
    expect(promptEnhancementPatch(pair, { prompt: 'A garden.', enhancedPrompt: 'A sunny garden.' }, true)).toEqual({ prompt: 'A garden.', enhancedPrompt: 'A sunny garden.', enhancedPromptStale: false });
  });
  it.each([undefined, '', ' ', 'x'.repeat(8001)])('keeps both old versions when the downstream edit is invalid: %s', enhancedPrompt => {
    expect(() => promptEnhancementPatch(pair, { prompt: 'A garden.', enhancedPrompt }, true)).toThrow('both complete prompts');
  });
  it('invalidates a downstream prompt after manual edits, but accepts an explicit paired edit', () => {
    const patch = { prompt: 'A garden.' };
    expect(promptSettingsPatch(pair, patch)).toMatchObject({ ...patch, enhancedPromptStale: true });
    expect(promptSettingsPatch(pair, { enhancedPrompt: 'A sunny garden.' })).toEqual({ enhancedPrompt: 'A sunny garden.', enhancedPromptStale: false });
    const edited = { prompt: 'A garden.', enhancedPrompt: 'A sunny garden.' };
    expect(promptSettingsPatch(pair, promptEnhancementPatch(pair, edited, true))).toEqual({ ...edited, enhancedPromptStale: false });
    expect(promptSettingsPatch(pair, { useEnhancedPrompt: false })).toEqual({ useEnhancedPrompt: false });
  });
});
