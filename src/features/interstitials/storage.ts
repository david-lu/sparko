import { enhancedPromptSettings } from '../../../shared/prompt-versions';
import { generationSeedSchema } from '../../../shared/generation-seed';
import { videoKeyframesSchema } from '../../../shared/video-keyframes';
import { loraAddressSchema, loraInstructionsSchema, loraStrengthSchema } from '../../../shared/loras';
import { videoAssetReferenceSchema, videoReferenceSettings } from '../../../shared/video-references';
import { INTERSTITIAL } from '../../../shared/constants';
import { imageReferencesSchema, imageReferenceIndexSchema } from '../../../shared/image-references';
import { maskCurveSchema } from '../../../shared/mask-curves';
import { audioTracksSchema } from '../../../shared/audio-tracks';
import { clipMetadataSchema, clipOriginSchema } from '../../../shared/clip-metadata';
import { clipMaskInjection, referenceTypes, generationMethods, interstitialSettings, normalizeGenerationMethod, normalizeGenerationResolution, normalizeMaskTransitionMs, upscalePhases, type ClipReference, type GenerationReference, type Interstitial, type InterstitialResult, type InterstitialSettings, type UpscaledResult, type UpscaleJob } from '../../../shared/interstitials';

function readReference(value: unknown): GenerationReference | undefined {
  const validClip = (clip: ClipReference | undefined) => clip && typeof clip.sceneId === 'string' && typeof clip.assetId === 'string'
    && Number.isInteger(clip.inFrame) && Number.isInteger(clip.outFrame) && clip.inFrame >= 0 && clip.outFrame > clip.inFrame;
  const input = value as GenerationReference | undefined;
  return input && [input.beforeClips, input.afterClips].every(clips => clips === undefined || Array.isArray(clips) && clips.length <= 1000 && clips.every(validClip)) && (input.before ? validClip(input.before) : input.mode === 'custom' || input.mode === 'loop' && !input.after) && (!input.after || validClip(input.after)) ? input : undefined;
}

function readSettings(value: unknown): InterstitialSettings | undefined {
  if (!value || typeof value !== 'object') return;
  const settings = value as InterstitialSettings;
  const method = (value as { method?: string }).method;
  if (method !== undefined && method !== 'fal' && !generationMethods.includes(method as InterstitialSettings['method'] & string)) return;
  if (![settings.start_range, settings.end_range, settings.duration].every(value => typeof value === 'number' && Number.isFinite(value)) ||
    typeof settings.prompt !== 'string' || typeof settings.enable_prompt_expansion !== 'boolean') return;
  return interstitialSettings({ ...settings, ...readPromptVersions(settings), timelineVideos: videoReferenceSettings.timelineVideos.safeParse(settings.timelineVideos).data, keyframes: videoKeyframesSchema.safeParse(settings.keyframes).data, ...audioTrackSettings(settings), startVideoAssets: videoReferenceSettings.startVideoAssets.safeParse(settings.startVideoAssets).data, endVideoAssets: videoReferenceSettings.endVideoAssets.safeParse(settings.endVideoAssets).data, seed: generationSeedSchema.safeParse(settings.seed).data, turbo: typeof settings.turbo === 'boolean' ? settings.turbo : undefined, lora: loraAddressSchema.nullable().safeParse(settings.lora).data, loraInstructions: loraInstructionsSchema.safeParse(settings.loraInstructions).data, loraStrength: loraStrengthSchema.safeParse(settings.loraStrength).data, audioMaskCurve: maskCurveSchema.safeParse(settings.audioMaskCurve).data, videoMaskCurve: maskCurveSchema.safeParse(settings.videoMaskCurve).data, imageReferences: imageReferencesSchema.safeParse(settings.imageReferences).data, startImageIndex: imageReferenceIndexSchema.safeParse(settings.startImageIndex).data, endImageIndex: imageReferenceIndexSchema.safeParse(settings.endImageIndex).data, method: normalizeGenerationMethod(method) });
}

function readResult(value: unknown): InterstitialResult | undefined {
  if (!value || typeof value !== 'object') return;
  const result = value as Partial<InterstitialResult>;
  if(result.prompt!==undefined&&(typeof result.prompt!=='string'||result.prompt.length>8000))return;
  if (typeof result.url !== 'string' || !(result.url.startsWith('https://') || /^\/api\/comfy\/assets\/[A-Za-z0-9_-]{8,128}\/content$/.test(result.url) || typeof result.assetId === 'string' && result.url === `asset:${result.assetId}`)) return;
  if (result.fullAssetId !== undefined && (typeof result.fullAssetId !== 'string' || !result.fullAssetId)) return;
  if (result.fullRange && (![result.fullRange.start, result.fullRange.duration, result.fullRange.totalDuration].every(value => typeof value === 'number' && Number.isFinite(value))
    || result.fullRange.start < 0 || result.fullRange.duration <= 0 || result.fullRange.start + result.fullRange.duration > result.fullRange.totalDuration + 0.1)) return;
  if (![result.start, result.duration, result.totalDuration].every(value => typeof value === 'number' && Number.isFinite(value))) return;
  if (result.start! >= 0 && result.duration! > 0 && result.start! + result.duration! <= result.totalDuration! + 0.1) return { ...result, metadata: clipMetadataSchema.safeParse(result.metadata).data, reference: readReference(result.reference), upscaled: readUpscaled(result.upscaled) } as InterstitialResult;
}
function readUpscaled(value: unknown): UpscaledResult | undefined {
  const upscaled = value as Partial<UpscaledResult> | undefined;
  return upscaled && typeof upscaled.assetId === 'string' && upscaled.assetId && typeof upscaled.totalDuration === 'number' && Number.isFinite(upscaled.totalDuration) && upscaled.totalDuration > 0
    ? { assetId: upscaled.assetId, totalDuration: upscaled.totalDuration } : undefined;
}
function readUpscaleJob(value: unknown): UpscaleJob | undefined {
  const job = value as Partial<UpscaleJob> | undefined;
  if (!job || !upscalePhases.includes(job.phase!) || typeof job.sourceAssetId !== 'string' || !job.sourceAssetId) return;
  return { phase: job.phase!, sourceAssetId: job.sourceAssetId,
    ...(typeof job.requestId === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(job.requestId) ? { requestId: job.requestId } : {}),
    ...(typeof job.error === 'string' ? { error: job.error } : {}) };
}

export const interstitialKey = (sourceId: string) => `sparko:interstitials:v1:${sourceId}`;
export function loadInterstitials(sourceId: string): Interstitial[] {
  try {
    const stored = localStorage.getItem(interstitialKey(sourceId));
    const saved: unknown = JSON.parse(stored ?? localStorage.getItem(`sparko:pins:v1:${sourceId}`) ?? '[]');
    if (!Array.isArray(saved)) return [];
    const ids = new Set<string>();
    return saved.flatMap((item): Interstitial[] => {
      if (!item || typeof item.id !== 'string' || ids.has(item.id) || !Number.isFinite(item.time) || item.time < 0) return [];
      ids.add(item.id);
      const phase = ['draft', 'queued', 'rendering', 'loading', 'ready', 'error', 'cancelled'].includes(item.phase) ? item.phase : 'draft';
      const result = readResult(item.result);
      return [{ id: item.id, label: typeof item.label === 'string' ? item.label.replace(/^Pin (\d+)$/, 'Interstitial $1') : 'Video', time: item.time, kind: item.kind === 'call-response' ? 'call-response' : item.kind === 'regular' ? 'regular' : undefined, groupId: typeof item.groupId === 'string' ? item.groupId : undefined,
        lora: loraAddressSchema.nullable().safeParse(item.lora).data, loraInstructions: loraInstructionsSchema.safeParse(item.loraInstructions).data, loraStrength: loraStrengthSchema.safeParse(item.loraStrength).data,
        seed: generationSeedSchema.safeParse(item.seed).data,
        turbo: typeof item.turbo === 'boolean' ? item.turbo : undefined,
        timelineVideos: videoReferenceSettings.timelineVideos.safeParse(item.timelineVideos).data, keyframes: videoKeyframesSchema.safeParse(item.keyframes).data, ...audioTrackSettings(item),
        analyzeReferences: typeof item.analyzeReferences === 'boolean' ? item.analyzeReferences : undefined,
        continuity: typeof item.continuity === 'string' ? item.continuity : undefined, dialogue: typeof item.dialogue === 'string' ? item.dialogue : undefined, loopAudio: typeof item.loopAudio === 'boolean' ? item.loopAudio : undefined,
        useStartVideoAsset: typeof item.useStartVideoAsset === 'boolean' ? item.useStartVideoAsset : undefined,
        useEndVideoAsset: typeof item.useEndVideoAsset === 'boolean' ? item.useEndVideoAsset : undefined,
        startVideoAssets: videoReferenceSettings.startVideoAssets.safeParse(item.startVideoAssets).data, endVideoAssets: videoReferenceSettings.endVideoAssets.safeParse(item.endVideoAssets).data,
        startVideoAsset: videoAssetReferenceSchema.safeParse(item.startVideoAsset).data,
        endVideoAsset: videoAssetReferenceSchema.safeParse(item.endVideoAsset).data,
        startReferenceType: referenceTypes.includes(item.startReferenceType) ? item.startReferenceType : undefined,
        endReferenceType: referenceTypes.includes(item.endReferenceType) ? item.endReferenceType : undefined,
        useInputReference: typeof item.useInputReference === 'boolean' ? item.useInputReference : undefined,
        useOutputReference: typeof item.useOutputReference === 'boolean' ? item.useOutputReference : undefined,
        maskInjection: clipMaskInjection(item),
        audioMaskTransitionMs: normalizeMaskTransitionMs(item.audioMaskTransitionMs ?? item.maskTransitionMs),
        videoMaskTransitionMs: normalizeMaskTransitionMs(item.videoMaskTransitionMs ?? item.maskTransitionMs),
        audioMaskCurve: maskCurveSchema.safeParse(item.audioMaskCurve).data,
        videoMaskCurve: maskCurveSchema.safeParse(item.videoMaskCurve).data,
        resolution: normalizeGenerationResolution(item.resolution),
        imageReferences: imageReferencesSchema.safeParse(item.imageReferences).data,
        startImageIndex: imageReferenceIndexSchema.safeParse(item.startImageIndex).data, endImageIndex: imageReferenceIndexSchema.safeParse(item.endImageIndex).data,
        start_range: Number.isFinite(item.start_range) ? item.start_range : INTERSTITIAL.defaultRange,
        end_range: Number.isFinite(item.end_range) ? item.end_range : INTERSTITIAL.defaultRange,
        duration: Number.isFinite(item.duration) ? item.duration : INTERSTITIAL.defaultDuration,
        enable_prompt_expansion: typeof item.enable_prompt_expansion === 'boolean' ? item.enable_prompt_expansion : INTERSTITIAL.enablePromptExpansion,
        method: normalizeGenerationMethod(item.method), generationSettings: readSettings(item.generationSettings),
        requestMethod: item.requestMethod === 'fal' || generationMethods.includes(item.requestMethod) ? item.requestMethod
          : item.requestId && (item.method === 'fal' || item.generationSettings?.method === 'fal') ? 'fal' : undefined,
        requestPrompt: typeof item.requestPrompt === 'string' ? item.requestPrompt : undefined,
        requestSeed: generationSeedSchema.safeParse(item.requestSeed).data,
        requestReference: readReference(item.requestReference),
        requestOrigin: clipOriginSchema.safeParse(item.requestOrigin).data,
        requestInsertion: item.requestInsertion && [item.requestInsertion.start, item.requestInsertion.duration, item.requestInsertion.totalDuration].every((v: unknown) => typeof v === 'number' && Number.isFinite(v))
          && item.requestInsertion.start >= 0 && item.requestInsertion.duration > 0 && item.requestInsertion.start + item.requestInsertion.duration <= item.requestInsertion.totalDuration + 0.1 ? item.requestInsertion : undefined,
        ...readPromptVersions(item),
        prompt: typeof item.prompt === 'string' ? item.prompt : '', phase: phase === 'ready' && !result ? 'error' : phase,
        requestId: typeof item.requestId === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(item.requestId) ? item.requestId : undefined,
        result, previousResult: readResult(item.previousResult), upscale: readUpscaleJob(item.upscale), error: typeof item.error === 'string' ? item.error : undefined }];
    }).sort((a, b) => a.time - b.time);
  } catch { return []; }
}
export function saveInterstitials(sourceId: string, items: Interstitial[]) {
  try {
    const key = interstitialKey(sourceId);
    const value = JSON.stringify(items.map(({ progress: _progress, progressDetails: _details, queuePosition: _position, ...item }) => ({ ...item,
      upscale: item.upscale && { ...item.upscale, progress: undefined, progressDetails: undefined, queuePosition: undefined } })));
    if (localStorage.getItem(key) !== value) localStorage.setItem(key, value);
    return true;
  }
  catch { return false; }
}

function audioTrackSettings(value: { inputAudioTracks?: unknown; generatedAudioTracks?: unknown; startReferenceVolume?: unknown; endReferenceVolume?: unknown }) {
  const level = (volume: unknown) => typeof volume === 'number' && Number.isFinite(volume) && volume >= 0 && volume <= 1 ? volume : undefined;
  return { inputAudioTracks: audioTracksSchema.safeParse(value.inputAudioTracks).data, generatedAudioTracks: audioTracksSchema.safeParse(value.generatedAudioTracks).data,
    startReferenceVolume: level(value.startReferenceVolume), endReferenceVolume: level(value.endReferenceVolume) };
}
function readPromptVersions(value: Record<string, unknown>) {
  return { enhancedPrompt: enhancedPromptSettings.enhancedPrompt.safeParse(value.enhancedPrompt).data,
    enhancedPromptStale: enhancedPromptSettings.enhancedPromptStale.safeParse(value.enhancedPromptStale).data,
    useEnhancedPrompt: enhancedPromptSettings.useEnhancedPrompt.safeParse(value.useEnhancedPrompt).data };
}
