import { beforeEach, describe, expect, it, vi } from 'vitest';
import { timeDialogueBeats } from '../../server/features/interstitials/dialogue-timing';
import type { AIClients } from '../../server/shared/ai-clients';
import { promptTimeline } from '../../shared/prompt-timing';

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
  it('offsets relative beats exactly once and stops before the ending reference', async () => {
    const timeline = promptTimeline(6, { prefixFrames: 39, suffixFrames: 39 }), plan = validPlan();
    plan.beats[4].end = Number(timeline.generatedDuration.toFixed(3)); returns(plan);
    const result = await timeDialogueBeats(openai, { ...input, timeline, duration: timeline.generatedDuration });
    expect(result).toContain('From 1.625 to 2.625 seconds:');
    expect(result).toContain(`From 2.625 to 3.625 seconds: She holds the rock throughout the line. The girl (S1) asks with a questioning rise: ${rock}`);
    expect(result).toContain('From 6.625 to 7.792 seconds:');
    expect(JSON.parse(respond.mock.calls[0][0].input[0].content[0].text)).toMatchObject({ timeline, duration: 148 / 24 });
    expect(respond.mock.calls[0][0].instructions).toContain('adds timeline.generatedStart exactly once');
    plan.beats[0].start = timeline.generatedStart; returns(plan);
    await expect(timeDialogueBeats(openai, { ...input, timeline, duration: timeline.generatedDuration })).rejects.toMatchObject({ status: 502 });
  });
  it.each([true, false])('bounds a single speaking line or silent action when footage consumes time: speech=%s', async speech => {
    const timeline = promptTimeline(6, { prefixFrames: 39, suffixFrames: 0 }), plan = validPlan();
    const prompt = h3(speech ? `She holds the rock and asks ${rock}` : 'She holds the rock silently.');
    plan.beats[3].speech = null;
    if (!speech) plan.beats[1].speech = null;
    plan.beats[4].end = timeline.generatedDuration; returns(plan);
    const result = await timeDialogueBeats(openai, { ...input, prompt, draft: prompt, timeline, duration: timeline.generatedDuration });
    expect(result).toContain('From 1.625 to 2.625 seconds:');
    expect(result).toContain('From 6.625 to 8 seconds:');
    expect(respond).toHaveBeenCalledOnce();
  });
  it('does not use reference footage as extra time to squeeze in speech', async () => {
    const timeline = promptTimeline(6, { prefixFrames: 39, suffixFrames: 39 });
    returns({ ...validPlan(), requiredDuration: 8, beats: [] });
    await expect(timeDialogueBeats(openai, { ...input, timeline, duration: timeline.generatedDuration })).rejects.toMatchObject({ status: 422 });
  });
  it('schedules intentionally edited dialogue without restoring the old words', async () => {
    const sock = '<d>[English] Or this sock?</d>', prompt = h3(`She lifts the rock and asks ${rock}, then puts it down, lifts the sock and asks ${sock}.`);
    const plan = validPlan();
    plan.beats[2].action = 'She sets down the rock and lifts the sock.';
    plan.beats[3].action = 'She holds the sock throughout the line.';
    plan.beats[4].action = 'She sets down the sock and waits silently.';
    returns(plan);
    const result = await timeDialogueBeats(openai, { ...input, prompt, draft: input.prompt, editInstructions: 'Replace the vegetables question with Or this sock? and hold the sock.' });
    expect(result.match(/<d>[\s\S]*?<\/d>/g)).toEqual([rock, sock]);
    expect(result).toContain('From 3 to 5 seconds: She holds the sock throughout the line.');
    expect(JSON.parse(respond.mock.calls[0][0].input[0].content[0].text)).toMatchObject({ repair: true, lines: [rock, sock] });
    plan.beats[3].speech = null; returns(plan);
    await expect(timeDialogueBeats(openai, { ...input, prompt, editInstructions: 'Replace the vegetables question with Or this sock?' })).rejects.toMatchObject({ status: 502 });
  });
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
  it('restores an explicitly quoted missing line in an existing prompt and gives it a speaking beat', async () => {
    const sock = '<d>[English] or this sock</d>';
    const draft = `${input.prompt}\nCorrection: she asks "or this sock" while holding the sock after the vegetables, instead of staying silent.`;
    const prompt = h3(`She asks ${rock}, then ${bowl}, then holds the sock and asks ${sock}`);
    const plan = validPlan();
    plan.beats[4] = { start: 5, end: 6, action: 'She holds the sock throughout the line.', speech: { line: 2, delivery: 'She (S1) asks doubtfully' } };
    returns(plan);
    const result = await timeDialogueBeats(openai, { ...input, draft, prompt, repair: true });
    expect(result.match(/<d>[\s\S]*?<\/d>/g)).toEqual([rock, bowl, sock]);
    expect(result).toContain(`From 5 to 6 seconds: She holds the sock throughout the line. She (S1) asks doubtfully: ${sock}`);
    respond.mockClear();
    await expect(timeDialogueBeats(openai, { ...input, draft, repair: true })).rejects.toMatchObject({ status: 502 });
    expect(respond).not.toHaveBeenCalled();
  });
  it('rejects missing quoted speech even when the draft is simple or has only one line', async () => {
    for(const draft of ['She says "or this sock".', `She says <d>[English] or this sock</d>.`, input.draft]) {
      await expect(timeDialogueBeats(openai, { ...input, draft, prompt: h3('She holds the sock silently.') })).rejects.toMatchObject({ status: 502 });
    }
    expect(respond).not.toHaveBeenCalled();
  });
  it('schedules a repaired line order instead of rejecting or reinstating the incorrect old order', async () => {
    const draft = h3(`She lifts the rock, then the bowl, but the old script lists ${bowl} then ${rock}. Correction: ask about the rock first, while holding it, then ask about the vegetables while holding the bowl.`);
    const result = await timeDialogueBeats(openai, { ...input, draft, repair: true });
    expect(result.match(/<d>[\s\S]*?<\/d>/g)).toEqual([rock, bowl]);
    expect(JSON.parse(respond.mock.calls[0][0].input[0].content[0].text)).toMatchObject({ repair: true, originalDraft: draft, enhancedPrompt: input.prompt, lines: [rock, bowl] });
    expect(respond.mock.calls[0][0].instructions).toContain('without reinstating its stale durations, contradictory staging or erroneous line order');
  });
  it.each([
    h3(`She asks ${rock}`),
    h3(`She asks ${rock.replace('A rock?', 'A stone?')} then ${bowl}`),
    h3(`She asks ${rock} then ${bowl} then ${rock}`),
    h3(`She asks ${rock} then ${rock}`),
  ])('still rejects lost, rewritten, added or duplicated speech during repair', async prompt => {
    await expect(timeDialogueBeats(openai, { ...input, draft: input.prompt, prompt, repair: true })).rejects.toMatchObject({ status: 502 });
    expect(respond).not.toHaveBeenCalled();
  });
  it('repairs dialogue placement and ignores soundscape echoes without removing intentional spoken repetitions', async () => {
    const draft = h3(`She asks ${rock} then ${bowl}`).replace('Quiet room tone.', `The dialogue repeats here by mistake: ${rock} ${bowl}`);
    const result = await timeDialogueBeats(openai, { ...input, draft, repair: true });
    expect(result.match(/<d>[\s\S]*?<\/d>/g)).toEqual([rock, bowl]);
    respond.mockClear();
    await expect(timeDialogueBeats(openai, { ...input, draft: h3(`She asks ${rock} twice: ${rock}, then ${bowl}`), repair: true })).rejects.toMatchObject({ status: 502 });
    expect(respond).not.toHaveBeenCalled();
  });
  it('protects a single scripted line during repair while allowing tag-spacing fixes', async () => {
    const draft = h3(`She asks ${rock.replace('[English] ', ' [english]')}`), prompt = h3(`She asks ${rock}`);
    expect(await timeDialogueBeats(openai, { ...input, draft, prompt, repair: true })).toBe(prompt);
    await expect(timeDialogueBeats(openai, { ...input, draft, prompt: h3('She stays silent.'), repair: true })).rejects.toMatchObject({ status: 502 });
  });
  it('does not mistake a field label spoken inside dialogue for the soundscape section', async () => {
    const draft = h3('She says <d>[English] Read overall_soundscape: aloud.</d>');
    await expect(timeDialogueBeats(openai, { ...input, draft, prompt: h3('She stays silent.'), repair: true })).rejects.toMatchObject({ status: 502 });
    expect(respond).not.toHaveBeenCalled();
  });
  it.each([h3(`She asks ${rock}`), h3(`She asks ${rock} [Shot 2] At 00:03.000, the camera cuts to the bowl: ${bowl}`),
    h3(`She asks ${rock} [Shot 10] At 00:03.000, the camera cuts to the bowl: ${bowl}`)])('preserves single-line or explicitly multi-shot enhancement without another request', async prompt => {
    expect(await timeDialogueBeats(openai, { ...input, draft: prompt, prompt })).toBe(prompt);
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
