import { describe, expect, it } from 'vitest';
import { cleanPromptDraft, cleanH3PromptDraft, isH3Prompt } from '../../server/shared/prompt-editing';

describe('prompt repair input', () => {
  it('unwraps copied prompts and restores escaped field separators without changing literal dialogue', () => {
    const draft = 'integrated_multimodal_description: [Shot 1] Say <d>[English] Type \\noverall_soundscape: exactly.</d>\\r\\noverall_soundscape: Quiet.\\nnon_diegetic_music: N/A';
    expect(cleanPromptDraft('```text\r\n' + draft + '\r\n```')).toBe(draft);
    expect(cleanH3PromptDraft('```text\r\n' + draft + '\r\n```')).toBe('integrated_multimodal_description: [Shot 1] Say <d>[English] Type \\noverall_soundscape: exactly.</d>\noverall_soundscape: Quiet.\nnon_diegetic_music: N/A');
  });
  it('recognizes existing H3 structure while leaving simple briefs as enhancement input', () => {
    expect(isH3Prompt('She smiles and says "Hello."')).toBe(false);
    expect(isH3Prompt('[Shot 1] She smiles.')).toBe(true);
    expect(isH3Prompt('overall_soundscape: She says <d>[English] Hello.</d>')).toBe(true);
    expect(isH3Prompt('She says <d>[English] Hello.</d>')).toBe(true);
  });
});
