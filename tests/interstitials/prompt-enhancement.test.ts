import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_MODELS } from '../../shared/constants';
import { createProviders } from '../../server/providers';
import { addPromptEnhancementRoutes, continuity, type EnhancePromptInput } from '../../server/features/interstitials/prompt-enhancement';
import { lightingColorContinuity } from '../../server/shared/prompt-lighting';
import { errorHandler, protectRequests } from '../../server/shared/http';

const respond = vi.hoisted(() => vi.fn());
vi.mock('openai', async importOriginal => ({
  ...await importOriginal<typeof import('openai')>(),
  default: class { responses = { create: respond }; },
}));
const input: EnhancePromptInput = { prompt: 'She asks, "What is 2 + 2?"', kind: 'call', duration: 6,
  referenceFrames: ['data:image/jpeg;base64,YQ=='], signal: new AbortController().signal };
const motionContinuity = 'Use smooth motion with no cuts or position jumps. Keep lighting continuous, with no jumps or sudden changes.';
const h3 = (description: string) => `integrated_multimodal_description: [Shot 1] ${description}\noverall_soundscape: Quiet room tone.\nnon_diegetic_music: N/A`;
const asked = 'She (S1) asks once: <d>[English] What is 2 + 2?</d> She closes her mouth and waits silently.';
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe('interstitial prompt enhancement', () => {
  it('labels the current frame separately from boundary frames and numbered image references', async () => {
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: h3(asked) }) });
    const currentFrame = 'data:image/jpeg;base64,Yw==', image = 'data:image/jpeg;base64,Yg==';
    await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, currentFrame, imageReferences: [image] });
    const options = respond.mock.calls[0][0];
    expect(options.input[0].content.slice(1)).toEqual([
      { type: 'input_text', text: 'Current player frame (scene context only):' },
      { type: 'input_image', image_url: currentFrame, detail: 'low' },
      { type: 'input_image', image_url: input.referenceFrames[0], detail: 'low' },
      { type: 'input_text', text: 'H3 image reference <Picture 1>' },
      { type: 'input_image', image_url: image, detail: 'low' },
    ]);
    expect(options.instructions).toContain('not a numbered generation reference or a first/last-frame constraint');
  });
  it.each(['interstitial', 'call', 'idle', 'response'] as const)('supplies LoRA guidance alongside the draft for %s', async kind => {
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: h3('Sema waves.') }) });
    const loraInstructions = 'Name Sema and use her canonical description.';
    await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, kind, loraInstructions });
    const options = respond.mock.calls[0][0];
    expect(JSON.parse(options.input[0].content[0].text)).toMatchObject({ draft: input.prompt, loraInstructions });
    expect(options.instructions).toContain('Preserve exact trigger words');
    expect(options.instructions).not.toContain(loraInstructions);
  });
  it('respects selected endpoint pictures and leaves optional images unanchored for prompt-only loops', async () => {
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: h3('A gentle movement.') }) });
    const enhance = createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt;
    const images = ['data:image/jpeg;base64,YQ==', 'data:image/jpeg;base64,Yg=='];
    await enhance({ ...input, imageReferences: images, imageGuides: { start: 1, end: 0 } });
    expect(respond.mock.calls[0][0].instructions).toContain('<Picture 2> anchors the first frame');
    expect(respond.mock.calls[0][0].instructions).toContain('<Picture 1> anchors the last frame');
    await enhance({ ...input, kind: 'idle', referenceFrames: [], imageReferences: images, imageGuides: {} });
    expect(respond.mock.calls[1][0].instructions).not.toContain('shared first-frame');
    await enhance({ ...input, kind: 'idle', referenceFrames: [], imageReferences: images, imageGuides: { start: 1, end: 1 } });
    expect(respond.mock.calls[2][0].instructions).toContain('<Picture 2> is the shared first-frame');
  });
  it('uses the first picture as both boundaries when enhancing an image-only loop', async () => {
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: h3('The subject in <Picture 1> moves gently and returns to the same pose.') }) });
    await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, prompt: 'A subtle loop', kind: 'idle', referenceFrames: [], imageReferences: ['data:image/jpeg;base64,YQ=='] });
    expect(respond.mock.calls[0][0].instructions).toContain('<Picture 1>');
    expect(respond.mock.calls[0][0].instructions).toContain('never use another picture as a different ending');
  });
  it('shows every attached image with its H3 picture number independently of video boundary frames', async () => {
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: h3('The character from <Picture 1> walks through the setting in <Picture 2>.') }) });
    const images = ['data:image/jpeg;base64,Yg==', 'data:image/jpeg;base64,Yw=='];
    const result = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, imageReferences: images });
    const options = respond.mock.calls[0][0], content = options.input[0].content;
    expect(content.slice(1)).toEqual([
      { type: 'input_image', image_url: input.referenceFrames[0], detail: 'low' },
      { type: 'input_text', text: 'H3 image reference <Picture 1>' }, { type: 'input_image', image_url: images[0], detail: 'low' },
      { type: 'input_text', text: 'H3 image reference <Picture 2>' }, { type: 'input_image', image_url: images[1], detail: 'low' },
    ]);
    expect(options.instructions).toContain('Preserve these exact tags');
    expect(options.instructions).toContain('Unlabeled video boundary frames are context only');
    expect(result.prompt).toContain('<Picture 1>'); expect(result.prompt).toContain('<Picture 2>');
  });
  it('uses the current model, reference frames and original dialogue with mandatory shot and position continuity', async () => {
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: h3(asked) }) });
    const result = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt(input);
    expect(result).toMatchObject({ model: AI_MODELS.promptEnhancement });
    expect(result.prompt).toContain('<d>[English] What is 2 + 2?</d>');
    expect(result.prompt).toContain(` ${continuity}\noverall_soundscape: `);
    expect(result.prompt).toContain('The background must remain fixed and continuous, with no jumps, shifts, or sudden changes.');
    expect(result.prompt).toContain('Particle effects, if present, must remain continuous with no jumps');
    expect(result.prompt).toContain(motionContinuity);
    expect(result.prompt).toContain(lightingColorContinuity);
    expect(result.prompt.length).toBeLessThanOrEqual(7000);
    expect(result.prompt.split('\n')).toHaveLength(3);
    const [options, requestOptions] = respond.mock.calls[0];
    expect(options).toMatchObject({ model: AI_MODELS.promptEnhancement, store: false, reasoning: { effort: 'low' } });
    expect(JSON.parse(options.input[0].content[0].text)).toEqual({ draft: input.prompt, kind: 'call', duration: input.duration });
    expect(options.input[0].content[1]).toEqual({ type: 'input_image', image_url: input.referenceFrames[0], detail: 'low' });
    expect(options.instructions).toContain('Nothing may snap to a new position');
    expect(options.instructions).toContain('The background must not jump, shift or suddenly change between frames');
    expect(options.instructions).toContain(lightingColorContinuity);
    expect(options.instructions).not.toContain('Any changes in color or lighting should happen gradually');
    expect(options.instructions).toContain('particle effects are present, their movement must remain continuous');
    expect(options.instructions).toContain('Write visual instructions in English');
    expect(options.instructions).toContain('Preserve requested English words and punctuation exactly');
    expect(options.instructions).toContain('Detect dialogue from the user\'s natural wording');
    expect(options.instructions).toContain('<d>[English] Do you know what the G in GPU stand for?</d>');
    expect(options.instructions).toContain('overall_soundscape:');
    expect(options.instructions).toContain('non_diegetic_music:');
    expect(result.prompt).toContain('English speech only');
    expect(options.instructions).toContain('For a Call clip');
    expect(options.instructions).toContain('single [Shot 1]');
    expect(options.instructions).toContain('Use the supplied duration to pace the one continuous shot');
    expect(options.instructions).toContain('do not fill unused time with speech');
    expect(requestOptions.signal).toBe(input.signal);
    expect(respond).toHaveBeenCalledOnce();
  });
  it.each(['interstitial', 'call', 'response'] as const)('preserves a complete multi-object sequence beyond 1,200 characters for %s', async kind => {
    const draft = 'The girl asks, "And we need something that makes trees grow fast!" Then she asks, "So, what goes into our super-duper plant food?" '
      + 'She lifts the rock and asks, "A rock?" She puts it down, lifts the bowl and asks, "Old vegetables?" After putting down the bowl, she raises the striped sock and looks at it silently.';
    const rewritten = h3([
      'Static camera; one uninterrupted shot. Keep the reference framing, angle and subject scale. The girl (S1) stands behind the vat, with the goat on her left and the boy on her right.',
      'Her voice is clear and full, with connected syllables and natural resonance, audible above the quiet lab ambience. She says with eager emphasis on fast: <d>[English] And we need something that makes trees grow fast!</d>',
      'After finishing that line, she looks over the ingredients and asks with a questioning rise: <d>[English] So, what goes into our super-duper plant food?</d>',
      'She lifts the rock. While holding the rock, she asks: <d>[English] A rock?</d> She keeps the rock raised until the last word finishes. Only then does she set the rock on the table and reach for the bowl of old vegetables.',
      'She lifts the bowl. While holding the bowl, she asks: <d>[English] Old vegetables?</d> She keeps the bowl raised until the line finishes. Only then does she put the bowl back on the table.',
      'After releasing the bowl, she picks up the striped sock and raises it into view. She looks at the sock with a doubtful expression, keeping her mouth closed. The goat and boy stay in their reference positions. The shot ends with the sock still in her hand.',
    ].join(' '));
    expect(rewritten.length).toBeGreaterThan(1200);
    const plan = { requiredDuration: 11.5, opening: 'Static camera; one uninterrupted shot. Keep the reference framing and lighting. Her voice sounds clear and full.', beats: [
      { start: 0, end: 3, action: 'The girl keeps her hands empty; all ingredients stay on the table.', speech: { line: 0, delivery: 'The girl (S1) says eagerly' } },
      { start: 3, end: 6, action: 'Her hands remain empty as she looks at the ingredients.', speech: { line: 1, delivery: 'The girl (S1) asks brightly' } },
      { start: 6, end: 6.5, action: 'She picks up the rock.', speech: null },
      { start: 6.5, end: 7.5, action: 'She holds the rock throughout the line. The bowl and sock stay on the table.', speech: { line: 2, delivery: 'The girl (S1) asks with a rising pitch' } },
      { start: 7.5, end: 8.5, action: 'She sets down the rock, then picks up the bowl.', speech: null },
      { start: 8.5, end: 9.5, action: 'She holds the bowl throughout the line.', speech: { line: 3, delivery: 'The girl (S1) asks doubtfully' } },
      { start: 9.5, end: 10.5, action: 'She puts down the bowl and picks up the sock.', speech: null },
      { start: 10.5, end: 12.25, action: 'She holds the sock and looks at it with her mouth closed.', speech: null },
    ] };
    respond.mockResolvedValueOnce({ status: 'completed', output_text: JSON.stringify({ prompt: rewritten }) })
      .mockResolvedValueOnce({ status: 'completed', output_text: JSON.stringify(plan) });
    const result = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, kind, duration: 12.25, prompt: draft });
    const options = respond.mock.calls[0][0];
    expect(JSON.parse(options.input[0].content[0].text).draft).toBe(draft);
    expect(options.text.format.schema.properties.prompt.maxLength).toBeGreaterThan(rewritten.length);
    expect(options.max_output_tokens).toBe(4000);
    expect(options.instructions).toContain('identify the ordered beats');
    expect(options.instructions).toContain('hold that object throughout its associated line');
    expect(options.instructions).toContain('Preserve explicitly requested before/during/after relationships and simultaneous actions');
    expect(options.instructions).toContain('never describe all the actions first and collect the dialogue afterward');
    expect(options.instructions).toContain('Use short, literal sentences and concrete verbs');
    expect(respond).toHaveBeenCalledTimes(2);
    const [timingOptions, timingRequest] = respond.mock.calls[1];
    expect(timingOptions.text.format.name).toBe('timed_dialogue_beats');
    expect(JSON.parse(timingOptions.input[0].content[0].text)).toMatchObject({ originalDraft: draft, enhancedPrompt: rewritten, duration: 12.25 });
    expect(timingRequest.signal).toBe(input.signal);
    expect(result.prompt).toContain('From 6.5 to 7.5 seconds: She holds the rock throughout the line.');
    expect(result.prompt).toContain('From 10.5 to 12.25 seconds: She holds the sock');
    expect(result.prompt.match(/<d>[\s\S]*?<\/d>/g)).toEqual(rewritten.match(/<d>[\s\S]*?<\/d>/g));
    expect(result.prompt).toContain('After the final scripted line');
    expect(result.prompt.length).toBeLessThanOrEqual(7000);
  });
  it.each(['interstitial', 'idle', 'continuity'] as const)('budgets the complete %s output including shared and mandatory directions', async mode => {
    const shared = 'Keep the same room and character. '.repeat(120).trim();
    let rewritten = '';
    respond.mockImplementation(async options => {
      const maxLength = options.text.format.schema.properties.prompt.maxLength;
      rewritten = mode === 'continuity' ? 'A'.repeat(maxLength) : h3('A'.repeat(maxLength - h3('').length));
      return { status: 'completed', output_text: JSON.stringify({ prompt: rewritten }) };
    });
    const result = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input,
      kind: mode === 'idle' ? 'idle' : 'interstitial', target: mode === 'continuity' ? 'continuity' : undefined, continuity: shared });
    expect(result.prompt.length).toBeLessThanOrEqual(mode === 'continuity' ? 4000 : 7000);
    if (mode !== 'continuity') expect(result.prompt).toHaveLength(7000);
    if (mode === 'continuity') expect(result.prompt).toContain(rewritten);
    else {
      expect(result.prompt).toContain(shared);
      expect(result.prompt).toContain(rewritten.split('\n')[0]);
      expect(result.prompt).toContain('\nnon_diegetic_music: N/A');
    }
  });
  it.each(['missing', 'soundscape'] as const)('rejects %s separate dialogue instead of appending speech after the actions', async placement => {
    const line = 'A rock?';
    const rewritten = h3('She lifts the rock, puts it down and lifts the bowl.')
      .replace('Quiet room tone.', placement === 'soundscape' ? `<d>[English] ${line}</d>` : 'Quiet room tone.');
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: rewritten }) });
    await expect(createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, dialogue: line }))
      .rejects.toMatchObject({ status: 502, message: 'The enhanced prompt omitted the supplied dialogue from the action. Try again.' });
    expect(respond).toHaveBeenCalledOnce();
  });
  it('instructs the enhancer to tag the exact Call line, including unusual grammar', async () => {
    const prompt = 'The girl asks, "Do you know what the G in GPU stand for?" She pauses for an answer.';
    const line = 'Do you know what the G in GPU stand for?';
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: h3(`The girl (S1) asks once: <d>[English] ${line}</d> She closes her mouth and waits silently.`) }) });
    const enhancer = createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt;
    const result = await enhancer({ ...input, prompt });
    expect(result.prompt).toContain(`<d>[English] ${line}</d>`);
    expect(result.prompt).not.toContain('stands for');
    const instructions = respond.mock.calls[0][0].instructions;
    expect(instructions).toContain('Quotation marks in the finished H3 prompt are for visible on-screen text');
    expect(instructions).toContain('introduce no additional dialogue');

    const repeated = await enhancer({ ...input, prompt: result.prompt });
    expect(repeated.prompt).toBe(result.prompt);
    expect(JSON.parse(respond.mock.calls[1][0].input[0].content[0].text).draft).toBe(h3(`The girl (S1) asks once: <d>[English] ${line}</d> She closes her mouth and waits silently.`));

  });
  it('treats a quoted Response line as spoken dialogue and strips an older enhancement suffix', async () => {
    const line = "That's right GPU stands for Graphical Processing Unit! Well done!";
    const draft = `The girl on the right says, "${line}"`;
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({
      prompt: h3(`The girl on the right (S1) says once: <d>[English] ${line}</d> She closes her mouth and returns to the continuation.`),
    }) });
    const result = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({
      ...input, kind: 'response', prompt: `${draft} Keep the same shot, background, framing and character placement. Use smooth motion with no cuts or position jumps. English speech only.`,
    });
    const options = respond.mock.calls[0][0];
    expect(JSON.parse(options.input[0].content[0].text)).toEqual({ draft, kind: 'response', duration: input.duration });
    expect(options.instructions).toContain('Response dialogue is mandatory');
    expect(options.instructions).toContain('Do not leave spoken words in quotation marks or as untagged prose');
    expect(options.instructions).toContain('<d>[English] We made it!</d>');
    expect(options.instructions).toContain('check every requested spoken line');
    expect(options.instructions).toContain('Do not postpone the match until the reference section or cut');
    expect(result.prompt).toContain(`<d>[English] ${line}</d>`);
  });
  it('accepts unstructured output when no separately supplied dialogue needs validation', async () => {
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: 'A concise visual direction with no H3 sections.' }) });
    const result = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt(input);
    expect(result.prompt).toContain('A concise visual direction with no H3 sections.');
  });
  it('keeps quoted text on a sign out of H3 spoken dialogue', async () => {
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: h3('The girl points to a sign reading "GPU".') }) });
    const result = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, kind: 'interstitial', prompt: 'The girl points to a sign that says "GPU".' });
    expect(result.prompt).toContain('sign reading "GPU"');
    expect(result.prompt).not.toContain('<d>');
  });
  it('accepts an H3 dialogue tag when the user requests speech without quoting a line', async () => {
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: h3('The girl (S1) says: <d>[English] Hello.</d> She closes her mouth.') }) });
    const result = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, prompt: 'The girl says hello.' });
    expect(result.prompt).toContain('<d>[English] Hello.</d>');
  });
  it('keeps repeated enhancements from accumulating the mandatory continuity block', async () => {
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: h3(`Quiet breathing. ${continuity}`) }) });
    const result = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, kind: 'idle', prompt: `Quiet breathing.\n\n${continuity}` });
    expect(JSON.parse(respond.mock.calls[0][0].input[0].content[0].text)).toMatchObject({ draft: 'Quiet breathing.', kind: 'idle' });
    expect(result.prompt).toContain('The character stays silent with their mouth closed throughout the generated loop. No speech, dialogue or lip movement. Only subtle ambient sound.');
    expect(result.prompt).toContain('The background must remain fixed and continuous, with no jumps, shifts, or sudden changes.');
    expect(result.prompt).toContain('Make this a perfect seamless loop: the first and last frames must match exactly');
    expect(result.prompt).toContain('Particle effects, if present, must remain continuous with no jumps');
    expect(result.prompt).toContain('particle state, with no visible jump when repeated');
    expect(result.prompt).not.toContain('English speech only');
    expect(respond.mock.calls[0][0].instructions).toContain('silent perfect seamless loop');
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: h3('Quiet breathing.') }) });
    const repeated = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, kind: 'idle', prompt: result.prompt });
    expect(JSON.parse(respond.mock.calls[1][0].input[0].content[0].text)).toMatchObject({ draft: h3('Quiet breathing.'), kind: 'idle' });
    expect(repeated.prompt).toBe(result.prompt);
  });
  it.each(['interstitial', 'call', 'idle', 'response', 'continuity'] as const)('locks lighting and color for %s and removes the old gradual-change rule', async mode => {
    const value: EnhancePromptInput = { ...input, kind: mode === 'continuity' ? 'call' : mode,
      target: mode === 'continuity' ? 'continuity' : undefined, currentFrame: 'data:image/jpeg;base64,Yw==' };
    const action = mode === 'continuity' ? 'Keep the same room and subject.' : h3('A small smile.');
    const legacy = 'Any changes in color or lighting should happen gradually across frames, without abrupt shifts or flashes.';
    const enhance = createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt;
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: action }) });
    const first = await enhance(value);
    expect(first.prompt.split(lightingColorContinuity)).toHaveLength(2);
    if (mode !== 'continuity') expect(first.prompt.indexOf(lightingColorContinuity)).toBeLessThan(first.prompt.indexOf('\noverall_soundscape:'));
    const previous = first.prompt.replace(lightingColorContinuity, legacy);
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: previous }) });
    const updated = await enhance({ ...value, prompt: previous, continuity: legacy });
    expect(updated.prompt).toBe(first.prompt);
    const options = respond.mock.calls[1][0], context = JSON.parse(options.input[0].content[0].text);
    expect(context.draft).toBe(action); expect(context.sharedContinuity).toBe('');
    expect(options.instructions).toContain('Use the current player frame as the lighting and color baseline');
    expect(options.instructions).not.toContain(legacy);
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: updated.prompt }) });
    expect((await enhance({ ...value, prompt: updated.prompt })).prompt).toBe(first.prompt);
  });
  it('replaces the previous Idle suffix without stacking loop instructions', async () => {
    const previousIdle = 'Keep the same shot, background, framing and character placement. Use smooth motion with no cuts or position jumps. The background must remain fixed and continuous, with no jumps, shifts, or sudden changes. Characters do not talk. Keep everything mostly quiet, with only subtle ambient sound.';
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: h3(`Quiet breathing. ${previousIdle}`) }) });
    const result = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, kind: 'idle', prompt: `Quiet breathing. ${previousIdle}` });
    expect(JSON.parse(respond.mock.calls[0][0].input[0].content[0].text).draft).toBe('Quiet breathing.');
    expect(result.prompt.match(/perfect seamless loop/g)).toHaveLength(1);
    expect(result.prompt.match(/No speech, dialogue or lip movement/g)).toHaveLength(1);
  });
  it('replaces an existing perfect-loop suffix when adding particle continuity', async () => {
    const previousIdle = 'Keep the same shot, background, framing and character placement. Use smooth motion with no cuts or position jumps. The background must remain fixed and continuous, with no jumps, shifts, or sudden changes. Characters do not talk. Keep everything mostly quiet, with only subtle ambient sound. Make this a perfect seamless loop: the first and last frames must match exactly in character pose, framing, background and lighting, with no visible jump when repeated.';
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: h3('Quiet breathing.') }) });
    const result = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, kind: 'idle', prompt: `Quiet breathing. ${previousIdle}` });
    expect(JSON.parse(respond.mock.calls[0][0].input[0].content[0].text).draft).toBe('Quiet breathing.');
    expect(result.prompt.match(/perfect seamless loop/g)).toHaveLength(1);
    expect(result.prompt.match(/Particle effects, if present/g)).toHaveLength(1);
  });
  it('uses separate instructions for every clip kind and excludes inherited speech from Idle context', async () => {
    respond.mockImplementation(async options => {
      const { kind } = JSON.parse(options.input[0].content[0].text);
      return { status: 'completed', output_text: JSON.stringify({ prompt: h3(kind === 'idle'
        ? 'Quiet motion. English speech only.' : 'Quiet motion. The character (S1) says: <d>[English] Speak now.</d> English speech only.') }) };
    });
    const enhancer = createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt;
    const kinds = ['interstitial', 'call', 'idle', 'response'] as const;
    const results = [];
    for (const kind of kinds) results.push(await enhancer({ ...input, kind, prompt: 'Quiet motion. English speech only.',
      continuity: 'Keep the same scene. English speech only.', dialogue: 'Speak now.' }));
    const instructions = respond.mock.calls.map(([options]) => options.instructions);
    for (const result of results) expect(result.prompt.split(motionContinuity)).toHaveLength(2);
    expect(new Set(instructions).size).toBe(4);
    expect(instructions[0]).toContain('For a regular interstitial');
    expect(instructions[1]).toContain('For a Call clip');
    expect(instructions[2]).toContain('For an Idle clip');
    expect(instructions[2]).toContain('Omit all dialogue, voices, speech and lip movement');
    expect(instructions[3]).toContain('For a Response clip');
    expect(instructions[0]).toContain('nothing is added at submission');
    expect(instructions[1]).toContain('include that exact line in an H3 dialogue tag with its vocal direction');
    const idleContext = JSON.parse(respond.mock.calls[2][0].input[0].content[0].text);
    expect(idleContext).toMatchObject({ draft: 'Quiet motion.', sharedContinuity: 'Keep the same scene.' });
    expect(idleContext).not.toHaveProperty('separateDialogue');
    expect(results[2].prompt).not.toContain('English speech only');
    expect(results[2].prompt).toContain('No speech, dialogue or lip movement');
    expect(results[2].prompt).toContain('Keep the same scene.');
    expect(results[2].prompt).not.toContain('<d>');
    for (const result of [results[0], results[1], results[3]]) {
      expect(result.prompt).toContain('Keep the same scene.');
      expect(result.prompt).toContain('<d>[English] Speak now.</d>');
    }
  });
  it('replaces the older continuity suffix when enhancing an existing clip again', async () => {
    const previous = 'Keep the same shot, background, framing and character placement. Use smooth motion with no cuts or position jumps. English speech only.';
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: h3(`A small gesture. ${previous}`) }) });
    const result = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, prompt: `A small gesture. ${previous}` });
    expect(JSON.parse(respond.mock.calls[0][0].input[0].content[0].text).draft).toBe('A small gesture.');
    expect(result.prompt).toBe(h3(`A small gesture. ${continuity}`));
    const lastWording = 'Keep the same shot, background, framing and character placement. Use smooth motion with no cuts or position jumps. no jumps in particle effects or lighting. The background must remain fixed and continuous, with no jumps, shifts, or sudden changes. Particle effects, if present, must remain continuous with no jumps, resets, popping, or sudden shifts between frames. English speech only.';
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: h3('A small gesture.') }) });
    const updated = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, prompt: `A small gesture. ${lastWording}` });
    expect(JSON.parse(respond.mock.calls[1][0].input[0].content[0].text).draft).toBe('A small gesture.');
    expect(updated.prompt).toBe(h3(`A small gesture. ${continuity}`));
    const earlierCurrent = `Keep the same shot, background, framing and character placement. ${motionContinuity} The background must remain fixed and continuous, with no jumps, shifts, or sudden changes. Particle effects, if present, must remain continuous with no jumps, resets, popping, or sudden shifts between frames. Only scripted dialogue is spoken, once each. After speaking, the character closes their mouth and remains silent. English speech only.`;
    const migrated = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, prompt: `A small gesture. ${earlierCurrent}` });
    expect(JSON.parse(respond.mock.calls[2][0].input[0].content[0].text).draft).toBe('A small gesture.');
    expect(migrated.prompt).toBe(h3(`A small gesture. ${continuity}`));
    const previousWithLighting = earlierCurrent.replace('Only scripted dialogue', `${lightingColorContinuity} Only scripted dialogue`);
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: h3(`A small gesture. ${previousWithLighting}`) }) });
    const synchronized = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, prompt: h3(`A small gesture. ${previousWithLighting}`) });
    expect(JSON.parse(respond.mock.calls[3][0].input[0].content[0].text).draft).toBe(h3('A small gesture.'));
    expect(synchronized.prompt).toBe(h3(`A small gesture. ${continuity}`));
  });
  it('enhances a shared continuity brief without treating it as a clip action or appending another brief', async () => {
    const brief = 'Preserve the same character, framing and lighting.';
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: brief }) });
    const result = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, target: 'continuity', prompt: brief });
    const options = respond.mock.calls[0][0];
    expect(JSON.parse(options.input[0].content[0].text).draft).toBe(brief);
    expect(options.instructions).toContain('shared continuity brief');
    expect(options.instructions).toContain('background to remain continuous without jumps');
    expect(options.instructions).toContain('particle effects must also move continuously without jumps');
    expect(options.instructions).toContain('Do not add stage-specific actions');
    expect(options.input[0].content[1].image_url).toBe(input.referenceFrames[0]);
    expect(result.prompt).toBe(`${brief} ${motionContinuity} The background must remain fixed and continuous, with no jumps, shifts, or sudden changes. Particle effects, if present, must remain continuous with no jumps, resets, popping, or sudden shifts between frames. ${lightingColorContinuity}`);
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: result.prompt }) });
    const repeated = await createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, target: 'continuity', prompt: result.prompt });
    expect(JSON.parse(respond.mock.calls[1][0].input[0].content[0].text).draft).toBe(brief);
    expect(repeated.prompt).toBe(result.prompt);
  });
  it.each([
    { status: 'incomplete', output_text: '{"prompt":"unfinished"}' },
    { status: 'completed', output_text: '{' },
    { status: 'completed', output_text: '{"prompt":""}' },
    { status: 'completed', output_text: JSON.stringify({ prompt: 'x'.repeat(8001) }) },
  ])('rejects incomplete or invalid provider output without returning a replacement prompt', async response => {
    respond.mockResolvedValue(response);
    await expect(createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt(input)).rejects.toMatchObject({ status: 502 });
  });
  it('does not expose connection error details or retry automatically', async () => {
    respond.mockRejectedValue(new Error('private-key https://private.example/request'));
    await expect(createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt(input)).rejects.toMatchObject({ status: 502, message: 'Prompt enhancement could not reach OpenAI. Try again.' });
    expect(respond).toHaveBeenCalledOnce();
  });
  it('honors cancellation before contacting the provider', async () => {
    const operation = new AbortController(); operation.abort();
    await expect(createProviders({ OPENAI_API_KEY: 'test-key' }).enhancePrompt({ ...input, signal: operation.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(respond).not.toHaveBeenCalled();
  });
});

describe('prompt enhancement API', () => {
  const enhancePrompt = vi.fn(), configured = { openai: true, gemini: false, comfy: false };
  const app = express(); app.use(protectRequests, express.json());
  addPromptEnhancementRoutes(app, { configured, enhancePrompt }); app.use(errorHandler);
  beforeEach(() => { configured.openai = true; enhancePrompt.mockResolvedValue({ prompt: `A restrained gesture.\n\n${continuity}`, model: AI_MODELS.promptEnhancement }); });
  const send = (body: object) => request(app).post('/api/interstitials/enhance-prompt').set('x-sparko-request', '1').send(body);
  const body = { prompt: input.prompt, kind: input.kind, duration: input.duration, referenceFrames: input.referenceFrames };
  it('validates the captured frame before forwarding it to the provider', async () => {
    const currentFrame = 'data:image/jpeg;base64,Yw==';
    await send({ ...body, currentFrame }).expect(200);
    expect(enhancePrompt).toHaveBeenCalledWith(expect.objectContaining({ currentFrame }));
    enhancePrompt.mockClear();
    for (const currentFrame of ['https://example.com/frame.jpg', 'data:image/jpeg;base64,' + 'YQ=='.repeat(8000), 123]) {
      await send({ ...body, currentFrame }).expect(400);
    }
    expect(enhancePrompt).not.toHaveBeenCalled();
  });
  it('passes only validated prompt context and frames to the enhancer', async () => {
    const response = await send({ ...body, apiKey: 'ignored', sourceUrl: 'https://ignored.example' }).expect(200);
    expect(enhancePrompt).toHaveBeenCalledWith({ ...body, signal: expect.any(AbortSignal) });
    expect(response.body.prompt).toContain('no cuts or position jumps');
  });
  it('validates and forwards optional LoRA instructions', async () => {
    await send({ ...body, loraInstructions: '  Name Sema.  ' }).expect(200);
    expect(enhancePrompt).toHaveBeenCalledWith(expect.objectContaining({ loraInstructions: 'Name Sema.' }));
    enhancePrompt.mockClear();
    for (const loraInstructions of ['x'.repeat(4001), 123, {}]) await send({ ...body, loraInstructions }).expect(400);
    expect(enhancePrompt).not.toHaveBeenCalled();
  });
  it('accepts a short Idle loop and retains compatibility with legacy dialogue settings', async () => {
    await send({ ...body, kind: 'idle', duration: 2, continuity: 'Keep the room and character.', dialogue: '' }).expect(200);
    expect(enhancePrompt).toHaveBeenCalledWith(expect.objectContaining({ kind: 'idle', duration: 2, continuity: 'Keep the room and character.', dialogue: '' }));
    enhancePrompt.mockClear();
    await send({ ...body, kind: 'response', duration: 2 }).expect(400);
    expect(enhancePrompt).not.toHaveBeenCalled();
  });
  it('accepts speech merged into a prompt longer than the old separate-field limit', async () => {
    const prompt = `${'A scene. '.repeat(500)}\n\nSpoken dialogue, verbatim: What do you think?`;
    await send({ ...body, prompt }).expect(200);
    expect(enhancePrompt).toHaveBeenCalledWith(expect.objectContaining({ prompt }));
  });
  it('allows an older 8,000-character draft to be enhanced instead of truncating it', async () => {
    const tail = '<d>[English] Keep these final words.</d>';
    const prompt = 'A'.repeat(8000 - tail.length) + tail;
    await send({ ...body, prompt }).expect(200);
    expect(enhancePrompt).toHaveBeenCalledWith(expect.objectContaining({ prompt }));
  });
  it('passes the continuity target through to the enhancer', async () => {
    await send({ ...body, target: 'continuity' }).expect(200);
    expect(enhancePrompt).toHaveBeenCalledWith(expect.objectContaining({ target: 'continuity' }));
  });
  it.each([
    { ...body, prompt: '' }, { ...body, prompt: 'x'.repeat(8001) }, { ...body, duration: 99 },
    { ...body, kind: 'unknown' }, { ...body, target: 'unknown' }, { ...body, referenceFrames: ['https://arbitrary.example/image.jpg'] },
    { ...body, referenceFrames: [...body.referenceFrames, ...body.referenceFrames, ...body.referenceFrames] },
  ])('rejects invalid input before making a paid request', async invalid => {
    await send(invalid).expect(400); expect(enhancePrompt).not.toHaveBeenCalled();
  });
  it('requires application headers, authentication and OpenAI configuration', async () => {
    await request(app).post('/api/interstitials/enhance-prompt').send(body).expect(403);
    await send(body).set('Origin', 'https://untrusted.example').expect(403);
    configured.openai = false; await send(body).expect(503);
    configured.openai = true; vi.stubEnv('APP_PASSWORD', 'workspace-secret'); await send(body).expect(401);
    expect(enhancePrompt).not.toHaveBeenCalled();
  });
});
