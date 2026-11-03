import { describe, expect, it } from 'vitest';
import { comfyBridgePlan, comfyDimensions, comfyReferenceRange, validateComfyResolution } from '../../shared/comfy';
import { bridgeWorkflow } from '../../server/features/comfy/workflow';
import { COMFY } from '../../shared/constants';
import { videoTransitionPoints } from '../../server/features/comfy/mask-transition';

describe('H3 two-sided temporal bridge', () => {
  it.each(['custom', 'loop'] as const)('generates a %s clip with no video or image references', mode => {
    const graph = bridgeWorkflow(undefined, { mode, before: 0, after: 0, duration: 6, prompt: 'A drifting cloud', width: 1280, height: 736, hasAudio: false }, 1);
    expect(graph.conditioning.class_type).toBe('MiniMaxH3ImageToVideo');
    expect(Object.values(graph).some(node => ['VHS_LoadVideoFFmpeg', 'LoadImage', 'MiniMaxH3AddGuide'].includes(node.class_type))).toBe(false);
    expect(graph.output).toBeDefined();
  });
  it('guides independent endpoints with chosen pictures and supports mixed footage', () => {
    const input = { mode: 'custom' as const, before: 0, after: 0, duration: 6, prompt: 'Move between poses', width: 960, height: 544, hasAudio: false, startImageIndex: 1, endImageIndex: 0 };
    const graph = bridgeWorkflow(undefined, input, 1, undefined, ['end', 'start']);
    expect(graph.guide_start.inputs).toMatchObject({ image: ['reference_image_1', 0], frame_idx: 0 });
    expect(graph.guide_end.inputs).toMatchObject({ image: ['reference_image_0', 0], frame_idx: -1, positive: ['guide_start', 0] });
    expect(graph.guider.inputs.conditioning).toEqual(['guide_end', 0]);
    const mixed = bridgeWorkflow('footage', { ...input, before: 1.625, startImageIndex: undefined }, 1, undefined, ['end']);
    expect(mixed.before).toBeDefined(); expect(mixed.guide_start).toBeUndefined(); expect(mixed.guide_end).toBeDefined();
    expect(() => bridgeWorkflow('footage', { ...input, before: 1.625 }, 1, undefined, ['end', 'start'])).toThrow('each endpoint');
    expect(() => bridgeWorkflow(undefined, input, 1, undefined, ['end'])).toThrow('each endpoint');
  });
  it('keeps optional subject images separate from loop endpoint guides', () => {
    const input = { mode: 'loop' as const, before: 0, after: 0, duration: 6, prompt: 'A drifting cloud', width: 960, height: 544, hasAudio: false, loopImageGuide: false };
    const free = bridgeWorkflow(undefined, input, 1, undefined, ['style', 'pose']);
    expect(free.conditioning.class_type).toBe('MiniMaxH3ReferenceToVideo'); expect(free.loop_start).toBeUndefined();
    const guided = bridgeWorkflow(undefined, { ...input, loopImageGuide: true, startImageIndex: 1, endImageIndex: 1 }, 1, undefined, ['style', 'pose']);
    expect(guided.loop_start.inputs.image).toEqual(['reference_image_1', 0]); expect(guided.loop_end.inputs.image).toEqual(['reference_image_1', 0]);
  });
  it('anchors both ends of an image-only loop to Picture 1, keeping other images as references', () => {
    const input = { mode: 'loop' as const, before: 0, after: 0, duration: 6, prompt: 'A gentle looping motion', width: 960, height: 544, hasAudio: false };
    expect(bridgeWorkflow(undefined, input, 1).loop_start).toBeUndefined();
    const graph = bridgeWorkflow(undefined, input, 1, undefined, ['pose', 'style']);
    expect(graph.loop_start).toMatchObject({ class_type: 'MiniMaxH3AddGuide', inputs: { image: ['reference_image_0', 0], frame_idx: 0 } });
    expect(graph.loop_end).toMatchObject({ class_type: 'MiniMaxH3AddGuide', inputs: { image: ['reference_image_0', 0], frame_idx: -1, positive: ['loop_start', 0] } });
    expect(graph.guider.inputs.conditioning).toEqual(['loop_end', 0]);
    expect(graph.reference_image_1.inputs.image).toEqual({ __type: 'core/ASSET', info: { id: 'style' } });
    expect(graph.before).toBeUndefined(); expect(graph.after).toBeUndefined();
  });
  it.each(['bridge', 'extend', 'loop', 'custom'] as const)('conditions %s generation on ordered image references without changing timeline masks', mode => {
    const input = { mode, before: mode === 'custom' ? 0 : 1.625, after: mode === 'extend' || mode === 'custom' ? 0 : 1.625,
      duration: 6, prompt: 'Use <Picture 1> for the character and <Picture 2> for style.', width: 960, height: 544, hasAudio: true };
    const base = bridgeWorkflow('video-asset', input, 123);
    const graph = bridgeWorkflow('video-asset', input, 123, undefined, ['character-asset', 'style-asset']);
    expect(graph.conditioning).toEqual({ class_type: 'MiniMaxH3ReferenceToVideo', inputs: { ...base.conditioning.inputs,
      ref_image_size: 'match', 'ref_images.ref_image_0': ['reference_image_0', 0], 'ref_images.ref_image_1': ['reference_image_1', 0] } });
    expect(graph.reference_image_0.inputs.image).toEqual({ __type: 'core/ASSET', info: { id: 'character-asset' } });
    expect(graph.reference_image_1.inputs.image).toEqual({ __type: 'core/ASSET', info: { id: 'style-asset' } });
    for (const node of ['middle_mask', 'freeze_video', 'freeze_audio', 'sample', 'empty_streams']) expect(graph[node]).toEqual(base[node]);
    expect(() => bridgeWorkflow('video-asset', input, 0, undefined, Array(10).fill('image'))).toThrow('9 image references');
  });
  it.each(['bridge','extend','loop','custom'] as const)('uses official H3 2K regeneration after the complete %s base render',mode=>{
    const input={mode,before:mode==='custom'?0:1.625,after:mode==='extend'||mode==='custom'?0:1.625,duration:6,width:1344,height:768,prompt:'Details',hasAudio:true};
    const native=bridgeWorkflow(input.before?'asset':undefined,input,123),high=bridgeWorkflow(input.before?'asset':undefined,{...input,resolution:'2k'},123);
    expect(native.regenerate_2k).toBeUndefined();expect(high.conditioning).toEqual(native.conditioning);expect(high.sample).toEqual(native.sample);
    expect(high.decode_video).toEqual(native.decode_video);expect(high.decode_audio).toEqual(native.decode_audio);
    expect(high.base_video).toEqual({class_type:'CreateVideo',inputs:{images:['decode_video',0],audio:['decode_audio',0],fps:24}});
    expect(high.regenerate_2k).toEqual({class_type:'MinimaxHailuo03RegenerateNode',inputs:{video:['base_video',0],model:'MiniMax H3','model.prompt':input.prompt,'model.resolution':'2K',watermark:false}});
    expect(high.output).toEqual({class_type:'SaveVideo',inputs:{video:['regenerate_2k',0],filename_prefix:'sparko/interstitial',format:'mp4','format.codec':'auto'}});
    expect(Object.values(high).some(node=>/Upscale|ImageScale/.test(node.class_type))).toBe(false);
    expect(high.middle_mask).toEqual(native.middle_mask);expect(high.freeze_audio).toEqual(native.freeze_audio);
  });
  it('keeps the 2K base render on the native H3 canvas for small, portrait and square references',()=>{
    expect(comfyDimensions(320,180)).toEqual({width:320,height:192});expect(comfyDimensions(320,180,'2k')).toEqual({width:1344,height:768});
    for(const [width,height] of [[1920,1080],[1080,1920],[1000,1000]]){
      const native=comfyDimensions(width,height,'2k');
      expect(Math.max(native.width,native.height)).toBeLessThanOrEqual(1344);expect(Math.min(native.width,native.height)).toBeLessThanOrEqual(768);
      expect(native.width%32).toBe(0);expect(native.height%32).toBe(0);expect(native.width*native.height).toBeLessThanOrEqual(1032192);
    }
    expect(()=>comfyDimensions(NaN,1080,'2k')).toThrow('dimensions');
  });
  it('rejects source renders shorter than the official regeneration frame minimum before paid submission',()=>{
    const input={mode:'custom' as const,before:0,after:0,duration:2,width:1344,height:768,prompt:'Short scene',hasAudio:false};
    expect(()=>bridgeWorkflow(undefined,{...input,resolution:'2k'},1)).toThrow('4.46 seconds');
    expect(()=>bridgeWorkflow(undefined,input,1)).not.toThrow();
    expect(()=>validateComfyResolution({totalFrames:107},'2k')).not.toThrow();
    expect(()=>comfyReferenceRange({method:'comfy-loop',time:0,start_range:2,end_range:2,duration:2,resolution:'2k',useInputReference:false,useOutputReference:false},4)).toThrow('4.46 seconds');
  });
  it.each([[true, true], [true, false], [false, true], [false, false]])('omits disabled reference loaders and masks (input %s, output %s)', (before, after) => {
    const input = { mode: 'custom' as const, before: before ? 1.625 : 0, after: after ? 1.625 : 0, duration: 6, width: 960, height: 544, prompt: 'A new scene', hasAudio: true };
    const plan = comfyBridgePlan(input.before, input.after, 6, 'custom');
    const graph = bridgeWorkflow(before || after ? 'asset' : undefined, input, 123);
    expect(!!graph.before).toBe(before); expect(!!graph.place_before).toBe(before);
    expect(!!graph.after).toBe(after); expect(!!graph.place_after).toBe(after);
    expect(!!graph.freeze_audio).toBe(before || after);
    expect(!!graph.audio_mask).toBe(before || after);
    if (before || after) expect(graph.middle_mask.inputs.points_string).toBe(videoTransitionPoints(plan.prefixFrames, plan.suffixFrames, plan.totalFrames, 500));
    else expect(graph.middle_mask.inputs.ranges).toBe(`0:${plan.totalFrames}`);
    if (before) expect(graph.before).toMatchObject({ class_type: 'VHS_LoadVideoFFmpeg', inputs: { start_time: 0, frame_load_cap: plan.prefixFrames } });
    if (after) expect(graph.after).toMatchObject({ class_type: 'VHS_LoadVideoFFmpeg', inputs: { start_time: plan.prefixFrames / 24, frame_load_cap: plan.suffixFrames } });
    if (!before && after) expect(graph.audio_full.inputs.audio1).toEqual(['gap_audio', 0]);
    if (!before && !after) expect(graph.freeze_video.inputs.samples).toEqual(['empty_streams', 0]);
    // Every node link points at an existing node, including either one-sided path.
    for (const node of Object.values(graph)) for (const value of Object.values(node.inputs)) {
      if (Array.isArray(value) && typeof value[0] === 'string') expect(graph[value[0]]).toBeDefined();
    }
  });
  it.each(['uniform', 'vignette'] as const)('ignores retired %s masks and uses native H3 generation', maskInjection => {
    const input = { mode: 'bridge' as const, before: 1.625, after: 1.625, duration: 7, width: 960, height: 544, prompt: 'Exact prompt', hasAudio: true };
    const standard = bridgeWorkflow('asset', input, 123);
    expect(bridgeWorkflow('asset', { ...input, maskInjection }, 123)).toEqual(standard);
    expect(bridgeWorkflow('asset', { ...input, interpolateMiddle: true }, 123)).toEqual(standard);
    expect(standard.place_before.inputs.destination).toEqual(['empty_streams', 0]);
    expect(standard.latent_mask.inputs.masks).toEqual(['middle_mask', 0]);
    expect(Object.values(standard).some(node => /Interpolate|Interpolation/.test(node.class_type))).toBe(false);
  });
  it('extends a Call with a soft preceding reference and generates the entire tail', () => {
    const range = comfyReferenceRange({ method: 'comfy-extend', time: 2, start_range: 2, end_range: 2, duration: 6 }, 2);
    expect(range.mode).toBe('extend'); expect(range.after).toBe(0);
    expect(range.plan.insertion.start + range.plan.insertion.duration).toBe(range.plan.insertion.totalDuration);
    const graph = bridgeWorkflow('asset', { mode: 'extend', before: 1.625, after: 0, duration: 6, width: 960, height: 544, prompt: 'Ask', hasAudio: true }, 1);
    expect(graph.after).toBeUndefined(); expect(graph.place_after).toBeUndefined();
    expect(graph.interpolate_middle).toBeUndefined(); expect(graph.middle_strength).toBeUndefined();
    expect(graph.place_before.inputs.destination).toEqual(['empty_streams', 0]);
    expect(graph.latent_mask.inputs.masks).toEqual(['middle_mask', 0]);
    expect(graph.freeze_video.inputs.samples).toEqual(['place_before', 0]);
    expect(graph.encode_audio.inputs.audio).toEqual(['audio_prefix', 0]);
    expect(graph.middle_mask.inputs.points_string).toBe(`0:(0),27:(0),39:(1),${range.plan.totalFrames - 1}:(1)`);
  });
  it('accepts a short Idle loop with two protected context windows', () => {
    const plan = comfyBridgePlan(2, 2, 2, 'loop');
    expect(plan.insertion.duration).toBeGreaterThanOrEqual(2);
    expect(plan.insertion.duration).toBeLessThan(3);
    expect(plan.prefixFrames).toBe(plan.suffixFrames);
    expect(() => comfyBridgePlan(2, 2, 2, 'bridge')).toThrow('5');
    expect(() => comfyBridgePlan(2, 1, 6, 'extend')).toThrow();
  });
  it('snaps the generated target and protected contexts to H3’s grid', () => {
    const plan = comfyBridgePlan(2, 2, 6);
    expect(plan).toEqual({ prefixFrames: 39, suffixFrames: 39, middleFrames: 148, totalFrames: 226,
      insertion: { start: 39 / 24, duration: 148 / 24, totalDuration: 226 / 24 } });
    const range = comfyReferenceRange({ time: 10, start_range: 2, end_range: 3, duration: 6 }, 20);
    expect(range.start + range.insertAt).toBe(10);
    expect(range.end - range.after).toBe(10);
    expect(range.plan.suffixFrames).toBe(56);
    expect((range.plan.totalFrames - 5) % 17).toBe(0);
    expect(range.plan.insertion.duration).toBeGreaterThanOrEqual(6);
  });
  it('rejects missing context and oversized targets before an upload or paid job', () => {
    for (const time of [0, 1, 19, 20]) expect(() => comfyReferenceRange({ time, start_range: 2, end_range: 2, duration: 6 }, 20)).toThrow('1.625');
    expect(() => comfyBridgePlan(4, 4, 13)).toThrow('362 frames');
    expect(() => comfyBridgePlan(NaN, 2, 6)).toThrow();
    expect(comfyDimensions(2544, 1456)).toEqual({ width: 1344, height: 768 });
    expect(comfyDimensions(720, 1280)).toEqual({ width: 736, height: 1280 });
    expect(comfyDimensions(2000, 2000)).toEqual({ width: 768, height: 768 });
  });
  it.each([[2, 39], [3, 56], [4, 90]])('loads %s-second reference windows with FFmpeg without rounding the suffix seek', (before, prefixFrames) => {
    const graph = bridgeWorkflow('asset', { before, after: 2, duration: 6, width: 960, height: 544, prompt: 'Continue', hasAudio: true }, 123);
    for (const [node, start, frames] of [[graph.before, 0, prefixFrames], [graph.after, prefixFrames / 24, 39]] as const) {
      expect(node).toEqual({ class_type: 'VHS_LoadVideoFFmpeg', inputs: {
        video: { __type: 'core/ASSET', info: { id: 'asset' } }, force_rate: 24, custom_width: 960, custom_height: 544,
        frame_load_cap: frames, start_time: start, format: 'None',
      } });
    }
    expect(graph.encode_before.inputs.pixels).toEqual(['before', 0]);
    expect(graph.encode_after.inputs.pixels).toEqual(['after', 0]);
    expect(graph.audio_prefix.inputs.audio1).toEqual(['before', 2]);
    expect(graph.audio_full.inputs.audio2).toEqual(['after', 2]);
  });
  it('conditions on both motion windows with soft reference edges and a fully generated middle', () => {
    const graph = bridgeWorkflow('uploaded-asset', { before: 1.625, after: 1.625, duration: 6, width: 960, height: 544, prompt: 'Continue moving', hasAudio: true }, 123);
    expect(graph.before.inputs).toMatchObject({ video: { __type: 'core/ASSET', info: { id: 'uploaded-asset' } }, start_time: 0, frame_load_cap: 39 });
    expect(graph.after.inputs).toMatchObject({ start_time: 39 / 24, frame_load_cap: 39 });
    expect(graph.place_before.inputs).toMatchObject({ source: ['encode_before', 0], index: 0 });
    expect(graph.place_after.inputs).toMatchObject({ source: ['encode_after', 0], index: -12 });
    expect(graph.end_guide).toBeUndefined();
    expect(graph.interpolate_middle).toBeUndefined();
    expect(graph.middle_strength).toBeUndefined();
    expect(graph.place_before.inputs.destination).toEqual(['empty_streams', 0]);
    expect(graph.latent_mask.inputs.masks).toEqual(['middle_mask', 0]);
    expect(graph.guider.inputs.conditioning).toEqual(['conditioning', 0]);
    expect(graph.middle_mask.inputs).toMatchObject({ frames: 226, points_string: '0:(0),27:(0),39:(1),187:(1),199:(0),225:(0)' });
    expect(graph.freeze_video.inputs).toEqual({ samples: ['place_after', 0], mask: ['latent_mask', 0] });
    expect(graph.freeze_audio.inputs).toMatchObject({ start_time: 39 / 24, end_time: 187 / 24 });
    expect(graph.sample.inputs.latent_image).toEqual(['freeze_audio', 0]);
    expect(graph.conditioning.inputs.prompt).toBe('Continue moving');
    expect(graph.output.inputs).toMatchObject({ frame_rate: 24, format: 'video/h264-mp4', trim_to_audio: false });
    expect(Object.values(graph).some(node => /MaskedAVBridge/.test(node.class_type))).toBe(false);
  });
  it('generates audio when the source is silent without connecting missing source audio', () => {
    const graph = bridgeWorkflow('uploaded-asset', { before: 1.625, after: 1.625, duration: 6, width: 960, height: 544, prompt: 'Continue', hasAudio: false }, 123);
    expect(graph.encode_audio).toBeUndefined();
    expect(graph.audio_mask).toBeUndefined();
    expect(graph.sample.inputs.latent_image).toEqual(['joint', 0]);
    expect(graph.joint.inputs.audio_latent).toEqual(['empty_streams', 1]);
    expect(graph.decode_audio).toBeDefined();
  });
  it.each([
    { before: 1.625, after: 1.625, start: 45, width: 287, left: 20, right: 20 },
    { before: 3, after: 2, start: 73, width: 287, left: 20, right: 20 },
    { before: 1.625, after: 0, start: 45, width: ['audio_mask_size', 0], left: 20, right: 0 },
    { before: 0, after: 1.625, start: 0, width: 275, left: 0, right: 20 },
  ])('feathers only inside connected reference audio: $before / $after', ({ before, after, start, width, left, right }) => {
    const graph = bridgeWorkflow('asset', { mode: 'custom', before, after, duration: 6, width: 960, height: 544, prompt: 'Continue', hasAudio: true }, 123);
    expect(graph.audio_mask_size).toEqual({ class_type: 'GetAudioLatentSize', inputs: { latent: ['fit_audio', 0] } });
    expect(graph.audio_mask_base.inputs).toEqual({ value: 0, width: ['audio_mask_size', 0], height: 1 });
    expect(graph.audio_mask_middle.inputs).toEqual({ value: 1, width, height: 1 });
    expect(graph.audio_mask_feather).toEqual({ class_type: 'FeatherMask', inputs: { mask: ['audio_mask_middle', 0], left, top: 0, right, bottom: 0 } });
    expect(graph.audio_mask.inputs).toEqual({ destination: ['audio_mask_base', 0], source: ['audio_mask_feather', 0], x: start, y: 0, operation: 'add' });
    expect(graph.freeze_audio.inputs).toMatchObject({ latent: ['fit_audio', 0], mask: ['audio_mask', 0], existing_mask: 'replace' });
    expect(graph.freeze_video.inputs.mask).toEqual(['latent_mask', 0]);
    expect(graph.sample.inputs.latent_image).toEqual(['freeze_audio', 0]);
  });
  it.each([
    { before: 1.625, after: 1.625, duration: 9.5 }, // Reported clip: joins at 1.625s / 11.333s.
    { before: 3, after: 2, duration: 6 }, // Reference boundaries between audio latent frames.
    { before: 1.625, after: 0, duration: 6 },
    { before: 0, after: 1.625, duration: 6 },
  ])('leaves every latent frame overlapping the blank audio fully generative: %j', input => {
    const plan = comfyBridgePlan(input.before, input.after, input.duration, 'custom');
    const graph = bridgeWorkflow('asset', { ...input, mode: 'custom', width: 960, height: 544, prompt: 'Continue', hasAudio: true }, 123);
    const x = Number(graph.audio_mask.inputs.x), left = Number(graph.audio_mask_feather.inputs.left), right = Number(graph.audio_mask_feather.inputs.right);
    const gapFirst = Math.floor(plan.insertion.start * COMFY.audioLatentsPerSecond);
    const gapEnd = Math.ceil((plan.insertion.start + plan.insertion.duration) * COMFY.audioLatentsPerSecond);
    // FeatherMask ramps inward from each end of the white region. Neither ramp
    // may overlap even a fraction of a latent frame that contains seeded silence.
    expect(x + left).toBeLessThanOrEqual(gapFirst);
    if (input.after) expect(x + Number(graph.audio_mask_middle.inputs.width) - right).toBeGreaterThanOrEqual(gapEnd);
    else expect(right).toBe(0);
    if (input.before) expect(left).toBeGreaterThan(0);
    else expect(left).toBe(0);
  });
});
