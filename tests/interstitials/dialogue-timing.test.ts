import { beforeEach, describe, expect, it, vi } from 'vitest';
import { timeDialogueBeats } from '../../server/features/interstitials/dialogue-timing';
import type { AIClients } from '../../server/shared/ai-clients';

const respond = vi.fn();
const openai = { responses: { create: respond } } as unknown as NonNullable<AIClients['openai']>;
const rock = '<d>[English] A rock?</d>', bowl = '<d>[English] Old vegetables?</d>';
const h3 = (action: string) => `integrated_multimodal_description: [Shot 1] ${action}\noverall_soundscape: Quiet room tone.\nnon_diegetic_music: N/A`;
const input = { prompt: h3(`She lifts the rock and asks: ${rock} Then she lifts the bowl and asks: ${bowl}`),
  draft: `She picks up a rock and asks "A rock?", then picks up a bowl and asks "Old vegetables?"`, duration: 6, maxPromptLength: 7000, signal: new AbortController().signal };
const validPlan = () => ({ requiredDuration: 5, opening: 'Static camera; one uninterrupted shot. Begin in the pose of <Picture 1>. Keep its lighting and colors.', beats: [
  { start: 0, end: 1, action: 'She picks up the rock. The bowl stays on the table.', speech: null as null | { line: number; delivery: string } },
  { start: 1, end: 2, action: 'She holds the rock throughout the line.', speech: { line: 0, delivery: 'The girl (S1) asks with a questioning rise' } },
  { start: 2, end: 3, action: 'She sets the rock down and picks up the bowl.', speech: null },
  { start: 3, end: 5, action: 'She holds the bowl throughout the line.', speech: { line: 1, delivery: 'The girl (S1) asks doubtfully' } },
  { start: 5, end: 6, action: 'She sets down the bowl and waits with her mouth closed.', speech: null },
] });
const returns = (value: unknown) => respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify(value) });
beforeEach(() => { vi.resetAllMocks(); returns(validPlan()); });

describe('action and dialogue timing', () => {
  it('compiles exact dialogue in order into separate speaking and silent handoff intervals', async () => {
    const result = await timeDialogueBeats(openai, input);
    expect(result).toContain(`From 1 to 2 seconds: She holds the rock throughout the line. The girl (S1) asks with a questioning rise: ${rock}`);
    expect(result).toContain('From 2 to 3 seconds: She sets the rock down and picks up the bowl. No spoken dialogue during this interval.');
    expect(result).toContain(`From 3 to 5 seconds: She holds the bowl throughout the line. The girl (S1) asks doubtfully: ${bowl}`);
    expect(result.match(/<d>[\s\S]*?<\/d>/g)).toEqual([rock, bowl]);
    expect(result.split('[Shot 1]')).toHaveLength(2);
    expect(result).toContain('Begin in the pose of <Picture 1>');
    expect(result.endsWith('\noverall_soundscape: Quiet room tone.\nnon_diegetic_music: N/A')).toBe(true);
    expect(respond.mock.calls[0][0].instructions).toContain('keep the hands empty and the later props on the table');
  });
  it.each(['reordered', 'missing', 'duplicate', 'overlap', 'gap', 'backwards', 'past end', 'unfinished', 'injected speech', 'extra shot'] as const)(
    'rejects a plan with %s instead of returning a misleading replacement', async issue => {
      const plan = validPlan();
      if (issue === 'reordered') { plan.beats[1].speech!.line = 1; plan.beats[3].speech!.line = 0; }
      if (issue === 'missing') plan.beats[3].speech = null;
      if (issue === 'duplicate') plan.beats[3].speech!.line = 0;
      if (issue === 'overlap') plan.beats[2].start = 1.5;
      if (issue === 'gap') plan.beats[2].start = 2.2;
      if (issue === 'backwards') plan.beats[2].end = 1.8;
      if (issue === 'past end') plan.beats[4].end = 7;
      if (issue === 'unfinished') plan.beats.pop();
      if (issue === 'injected speech') plan.beats[0].action += ' <d>[English] Hello!</d>';
      if (issue === 'extra shot') plan.opening += ' [Shot 2] Cut to the bowl.';
      returns(plan);
      await expect(timeDialogueBeats(openai, input)).rejects.toMatchObject({ status: 502 });
      expect(respond).toHaveBeenCalledOnce();
    });
  it('keeps the draft when the whole sequence will not fit instead of silently rushing or dropping lines', async () => {
    returns({ ...validPlan(), requiredDuration: 8.3, beats: [] });
    await expect(timeDialogueBeats(openai, input)).rejects.toMatchObject({ status: 422, message: expect.stringContaining('about 9 seconds') });
  });
  it('rejects omitted or reordered dialogue from the first enhancement before planning', async () => {
    for (const prompt of [h3(`She asks ${rock}`), h3(`She asks ${bowl} then ${rock}`)]) {
      await expect(timeDialogueBeats(openai, { ...input, draft: input.prompt, prompt })).rejects.toMatchObject({ status: 502 });
    }
    expect(respond).not.toHaveBeenCalled();
  });
  it('allows a separately supplied extra line without changing the original tagged dialogue order', async () => {
    const plan = validPlan();
    plan.beats[4].speech = { line: 2, delivery: 'The girl (S1) says calmly' };
    returns(plan);
    const extra = '<d>[English] All done.</d>';
    const result = await timeDialogueBeats(openai, { ...input, draft: input.prompt,
      prompt: input.prompt.replace('\noverall_soundscape:', ` She says ${extra}\noverall_soundscape:`), dialogue: 'All done.' });
    expect(result.match(/<d>[\s\S]*?<\/d>/g)).toEqual([rock, bowl, extra]);
  });
  it.each([h3(`She asks ${rock}`), h3(`She asks ${rock} [Shot 2] At 00:03.000, the camera cuts to the bowl: ${bowl}`),
    h3(`She asks ${rock} [Shot 10] At 00:03.000, the camera cuts to the bowl: ${bowl}`)])('preserves single-line or explicitly multi-shot enhancement without another request', async prompt => {
    expect(await timeDialogueBeats(openai, { ...input, prompt })).toBe(prompt);
    expect(respond).not.toHaveBeenCalled();
  });
  it.each([{ status: 'incomplete', output_text: '{}' }, { status: 'completed', output_text: '{' },
    { status: 'completed', output_text: '{}' }])('rejects incomplete or malformed timing output', async response => {
    respond.mockResolvedValue(response);
    await expect(timeDialogueBeats(openai, input)).rejects.toMatchObject({ status: 502 });
  });
  it('checks the assembled length without truncating the last beat or sound fields', async () => {
    await expect(timeDialogueBeats(openai, { ...input, maxPromptLength: 300 })).rejects.toMatchObject({ status: 502, message: expect.stringContaining('too long') });
  });
  it('honors cancellation before the planning call', async () => {
    const operation = new AbortController(); operation.abort();
    await expect(timeDialogueBeats(openai, { ...input, signal: operation.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(respond).not.toHaveBeenCalled();
  });
  it('discards a plan returned after cancellation', async () => {
    const operation = new AbortController();
    respond.mockImplementation(async () => { operation.abort(); return { status: 'completed', output_text: JSON.stringify(validPlan()) }; });
    await expect(timeDialogueBeats(openai, { ...input, signal: operation.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
