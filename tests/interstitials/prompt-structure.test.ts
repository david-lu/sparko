import { describe, expect, it } from 'vitest';
import { formatH3Prompt } from '../../server/features/interstitials/prompt-structure';

const action = '[Shot 1] She waves and says <d>[English] Welcome back!</d>';
const canonical = `integrated_multimodal_description: ${action}\noverall_soundscape: Wind in the trees.\nnon_diegetic_music: Soft piano.`;

describe('enhanced H3 prompt structure', () => {
  it.each([
    canonical.replaceAll(': ', ':\n\n'),
    canonical.replaceAll('\n', '\r\n').replace('[Shot 1]', '[shot   1]'),
    canonical.replace(/^(\w+):/gm, '**$1:**'),
    canonical.replace(/^(\w+):/gm, (_, field) => `  ${field.toUpperCase()} :`),
    '```text\n' + canonical + '\n```',
    canonical.replace('[Shot 1] ', ''),
    `non_diegetic_music: Soft piano.\noverall_soundscape: Wind in the trees.\nintegrated_multimodal_description: ${action}`,
  ])('normalizes presentation without changing descriptions or speech: %s', prompt => {
    expect(formatH3Prompt(prompt)).toEqual({ prompt: canonical, soundscapeStart: canonical.indexOf('\noverall_soundscape:') });
  });
  it('preserves field labels and shot markers inside literal dialogue', () => {
    const speech = '<d>[English] Read this exactly:\noverall_soundscape: wind\n[Shot 2] is a label.</d>';
    const prompt = canonical.replace('<d>[English] Welcome back!</d>', speech);
    const result = formatH3Prompt(prompt);
    expect(result.prompt).toBe(prompt);
    expect(result.prompt.slice(result.soundscapeStart)).toBe('\noverall_soundscape: Wind in the trees.\nnon_diegetic_music: Soft piano.');
    expect(formatH3Prompt(prompt.replace('[Shot 1] ', '')).prompt).toBe(prompt);
  });
  it('keeps explicitly requested later shots and their cut times', () => {
    const prompt = canonical.replace(action, `${action} [Shot 2] At 00:03.000, the camera cuts to the doorway.`);
    expect(formatH3Prompt(prompt).prompt).toBe(prompt);
  });
  it.each([
    canonical.replace('overall_soundscape: Wind in the trees.\n', ''),
    canonical.replace('Wind in the trees.', ''),
    canonical + '\noverall_soundscape: More wind.',
    canonical.replace('[Shot 1]', '[Shot 2]'),
    'Here is your prompt:\n' + canonical,
  ])('requests a correction for missing or ambiguous content instead of inventing defaults: %s', prompt => {
    expect(() => formatH3Prompt(prompt)).toThrow();
  });
});
