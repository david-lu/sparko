import { describe, expect, it } from 'vitest';
import { comfyBridgePlan, comfyDimensions, comfyReferenceRange, validateComfyResolution } from '../../shared/comfy';
import { bridgeWorkflow } from '../../server/features/comfy/workflow';
import { COMFY } from '../../shared/constants';
import { videoTransitionPoints } from '../../server/features/comfy/mask-transition';

describe('H3 two-sided temporal bridge', () => {
  it('anchors both ends of an image-only loop to Picture 1, keeping other images as references', () => {
    const input = { mode: 'loop' as const, before: 0, after: 0, duration: 6, prompt: 'A gentle looping motion', width: 960, height: 544, hasAudio: false };
    expect(() => bridgeWorkflow(undefined, input, 1)).toThrow('needs an image reference');
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
  it.each(['bridge', 'loop'] as const)('combines the vignette with the soft reference transitions for %s', mode => {
    const input = { mode, before: 1.625, after: 1.625, duration: 7, width: 960, height: 544, prompt: 'Exact prompt', hasAudio: true, maskInjection: 'vignette' as const };
    expect(() => bridgeWorkflow('asset', input, 123)).toThrow('uploaded gradient');
    const graph = bridgeWorkflow('asset', input, 123, 'mask-asset');
    expect(graph.vignette_image.inputs.image).toEqual({ __type: 'core/ASSET', info: { id: 'mask-asset' } });
    expect(graph.vignette_amplitude.inputs.value).toBe(.05); expect(graph.vignette_floor.inputs.value).toBe(.95);
    expect(graph.vignette_scaled.inputs).toMatchObject({ destination: ['vignette_gradient', 0], source: ['vignette_amplitude', 0], operation: 'multiply' });
    expect(graph.vignette_mask.inputs).toMatchObject({ destination: ['vignette_scaled', 0], source: ['vignette_floor', 0], operation: 'add' });
    expect(graph.middle_mask.inputs).toMatchObject({ width: 960, height: 544, frames: 260, points_string: '0:(0),27:(0),39:(1),221:(1),233:(0),259:(0)' });
    expect(graph.scale_middle_mask.inputs).toMatchObject({ destination: ['middle_mask', 0], source: ['vignette_mask', 0], operation: 'multiply' });
    expect(graph.latent_mask.inputs).toMatchObject({ masks: ['scale_middle_mask', 0], spatial_method: 'max', temporal_method: 'max', grow_spatial: 0, grow_temporal: 0 });
    expect(graph.freeze_video.inputs.mask).toEqual(['latent_mask', 0]);
    expect(graph.encode_target.inputs.pixels).toEqual(['interpolated_target', 0]);
    expect(graph.freeze_audio.inputs.start_time).toBe(39 / 24);
    expect(graph.freeze_audio.inputs.end_time).toBeCloseTo(221 / 24, 10);
    expect(graph.conditioning.inputs.prompt).toBe('Exact prompt');
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
  it.each(['bridge', 'loop'] as const)('seeds %s with motion interpolation at 0.97 while keeping the references and audio masks independent', mode => {
    const plan = comfyBridgePlan(2, 3, 6, mode);
    const graph = bridgeWorkflow('asset', { mode, before: 2, after: 3, duration: 6, width: 960, height: 544, prompt: 'Exact prompt', hasAudio: true, interpolateMiddle: true }, 123);
    expect(graph.last_before.inputs).toEqual({ image: ['before', 0], batch_index: plan.prefixFrames - 1, length: 1 });
    expect(graph.first_after.inputs).toEqual({ image: ['after', 0], batch_index: 0, length: 1 });
    expect(graph.boundary_frames.inputs).toEqual({ image1: ['last_before', 0], image2: ['first_after', 0] });
    expect(graph.interpolation_model.inputs.model_name).toBe('film_net_fp16.safetensors');
    expect(Object.values(graph).some(node => node.class_type === 'TransitionImagesMulti')).toBe(false);
    expect(graph.target_prefix.inputs).toEqual({ image1: ['before', 0], image2: ['interpolate_middle', 0] });
    expect(graph.interpolated_target.inputs).toEqual({ image1: ['target_prefix', 0], image2: ['after', 0] });
    expect(plan.prefixFrames + plan.middleFrames + plan.suffixFrames).toBe(plan.totalFrames);
    expect(graph.encode_target.inputs).toEqual({ pixels: ['interpolated_target', 0], vae: ['video_vae', 0] });
    expect(graph.place_before.inputs.destination).toEqual(['encode_target', 0]);
    expect(graph.middle_strength.inputs.value).toBe(0.97);
    expect(graph.scale_middle_mask.inputs).toMatchObject({ destination: ['middle_mask', 0], source: ['middle_strength', 0], operation: 'multiply' });
    expect(graph.latent_mask.inputs.masks).toEqual(['scale_middle_mask', 0]);
    expect(graph.freeze_audio.inputs).toMatchObject({ start_time: plan.insertion.start, end_time: plan.insertion.start + plan.insertion.duration, existing_mask: 'replace' });
    expect(graph.conditioning.inputs.prompt).toBe('Exact prompt');
  });
  it.each([2, 7, 11.5])('fits motion interpolation to the exact interior frame count for %s seconds', duration => {
    const mode = duration < 5 ? 'loop' : 'bridge';
    const plan = comfyBridgePlan(1.625, 1.625, duration, mode);
    const graph = bridgeWorkflow('asset', { mode, before: 1.625, after: 1.625, duration, width: 960, height: 544, prompt: 'Exact', hasAudio: false, interpolateMiddle: true }, 123);
    let intervals = 1, previous = ['boundary_frames', 0];
    for (const [id, node] of Object.entries(graph).filter(([, node]) => node.class_type === 'FrameInterpolate')) {
      const multiplier = Number(node.inputs.multiplier);
      expect(multiplier).toBeGreaterThanOrEqual(2); expect(multiplier).toBeLessThanOrEqual(16);
      expect(node.inputs.images).toEqual(previous);
      intervals *= multiplier; previous = [id, 0];
    }
    expect(graph.interpolate_middle.inputs.image).toEqual(previous);
    const indexes = String(graph.interpolate_middle.inputs.indexes).split(',').map(Number);
    expect(indexes).toHaveLength(plan.middleFrames);
    expect(new Set(indexes).size).toBe(plan.middleFrames);
    expect(indexes[0]).toBeGreaterThan(0); expect(indexes.at(-1)).toBeLessThan(intervals);
    indexes.forEach((index, i) => expect(Math.abs(index / intervals - (i + 1) / (plan.middleFrames + 1))).toBeLessThanOrEqual(.5 / intervals + 1e-9));
  });
});
