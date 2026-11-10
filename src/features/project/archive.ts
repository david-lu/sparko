import { enhancedPromptSettings } from '../../../shared/prompt-versions';
import { generationSeedSchema } from '../../../shared/generation-seed';
import { loraSettings, projectLorasSchema } from '../../../shared/loras';
import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { z } from 'zod';
import { generationMethods, generationResolutions, interstitialSettings, maskInjections } from '../../../shared/interstitials';
import { INTERSTITIAL, MASK_TRANSITION, TIMELINE_FPS } from '../../../shared/constants';
import { assetIds, type Asset, type LibraryAsset, type Project } from './types';
import { callResponseSchema } from '../call-response/schema';
import { storyGraphSchema } from '../story-flow/schema';
import { clipMetadataSchema, clipOriginSchema } from '../../../shared/clip-metadata';
import { imageReferencesSchema, imageReferenceIndexSchema } from '../../../shared/image-references';
import { maskCurveSchema } from '../../../shared/mask-curves';
import { videoReferenceSettings } from '../../../shared/video-references';
import { assetGenerationSchema, assetSettingsSchema } from '../../../shared/asset-generation';
import { videoKeyframesSchema } from '../../../shared/video-keyframes';
import { audioLayersSchema } from './audioLayers';

const MAX_BYTES = 8 * 1024 ** 3;
const MAX_MANIFEST = 8 * 1024 ** 2;
const number = z.number().finite().nonnegative();
const text = z.string().max(50_000);
const clipReferenceSchema = z.object({ kind: z.enum(['image','audio']).optional(), sceneId: z.string().min(1).max(200), assetId: z.uuid(), inFrame: number.int(), outFrame: number.int().positive() }).refine(value => value.outFrame > value.inFrame);
const generationReferenceSchema = z.object({ mode: z.enum(['extend', 'loop', 'bridge', 'custom']).optional(), before: clipReferenceSchema.optional(), after: clipReferenceSchema.optional(), beforeClips: z.array(clipReferenceSchema).max(1000).optional(), afterClips: z.array(clipReferenceSchema).max(1000).optional() });
const resultSchema = z.object({ url: text, assetId: z.uuid(), fullAssetId: z.uuid().optional(), prompt:z.string().max(8000).optional(), metadata: clipMetadataSchema.optional(),
  upscaled: z.object({ assetId: z.uuid(), totalDuration: number.positive() }).optional(),
  fullRange: z.object({ start: number, duration: number.positive(), totalDuration: number.positive() })
    .refine(value => value.start + value.duration <= value.totalDuration + 0.1, 'Invalid full video boundaries.').optional(),
  start: number, duration: number.positive(), totalDuration: number.positive(), reference: generationReferenceSchema.optional() })
  .refine(value => value.start + value.duration <= value.totalDuration + 0.1, 'Invalid video boundaries.');
const settingsSchema = z.object({
  ...videoReferenceSettings,
  ...loraSettings,
  ...enhancedPromptSettings,
  turbo: z.boolean().optional(), seed: generationSeedSchema.optional(),
  imageReferences: imageReferencesSchema.optional(),
  keyframes: videoKeyframesSchema.optional(),
  startImageIndex: imageReferenceIndexSchema.optional(), endImageIndex: imageReferenceIndexSchema.optional(),
  startReferenceType: z.enum(['none', 'video', 'image']).optional(), endReferenceType: z.enum(['none', 'video', 'image']).optional(),
  resolution: z.enum(generationResolutions).optional(),
  useInputReference: z.boolean().optional(), useOutputReference: z.boolean().optional(),
  method: z.enum([...generationMethods, 'fal']).optional().transform(value => value === 'fal' || value === undefined ? 'comfy' as const : value),
  continuity: text.optional(), dialogue: text.optional(), analyzeReferences: z.boolean().optional(), loopAudio: z.boolean().optional(),
  interpolateMiddle: z.boolean().optional(),
  maskInjection: z.enum(maskInjections).optional(),
  audioMaskTransitionMs: number.int().max(MASK_TRANSITION.maxMs).optional(),
  videoMaskTransitionMs: number.int().max(MASK_TRANSITION.maxMs).optional(),
  audioMaskCurve: maskCurveSchema.optional(), videoMaskCurve: maskCurveSchema.optional(),
  maskTransitionMs: number.int().max(MASK_TRANSITION.maxMs).optional(),
  start_range: number.max(4), end_range: number.max(4), prompt: text,
  duration: number.min(1).max(INTERSTITIAL.maxDuration).default(INTERSTITIAL.defaultDuration),
  enable_prompt_expansion: z.boolean().default(INTERSTITIAL.enablePromptExpansion),
});
function preserveLegacyJobProvider(value: unknown) {
  if (!value || typeof value !== 'object') return value;
  const item = value as Record<string, unknown>;
  const settings = item.generationSettings as Record<string, unknown> | undefined;
  return item.requestId && item.requestMethod === undefined && (item.method === 'fal' || settings?.method === 'fal')
    ? { ...item, requestMethod: 'fal' } : value;
}
const projectSchema = z.object({
  id: text, name: z.string().min(1).max(1000), updatedAt: number,
  crossfadeFrames: z.number().int().min(2).max(2 * TIMELINE_FPS).refine(value => value % 2 === 0).optional(),
  callResponse: callResponseSchema.optional(),
  callResponses: z.array(callResponseSchema).max(100).optional(),
  storyFlow: storyGraphSchema.optional(),
  audioLayers: audioLayersSchema.optional(),
  libraryFolders: z.array(z.object({ id: z.uuid(), name: z.string().min(1).max(1000), parentId: z.uuid().optional() })).max(2000)
    .refine(folders => new Set(folders.map(f => f.id)).size === folders.length && folders.every(folder => {
      const seen = new Set([folder.id]); let parent = folder.parentId;
      while (parent) { if (seen.has(parent)) return false; seen.add(parent); const next = folders.find(f => f.id === parent); if (!next) return false; parent = next.parentId; }
      return true;
    }), 'Invalid folder hierarchy.').optional(),
  loras: projectLorasSchema.optional(),
  assetAliases: z.record(z.uuid(), z.uuid()).optional(),
  mediaModelVersion: z.literal(1).optional(),
  deletedAssetIds: z.array(z.uuid()).max(100000).optional(),
  assetGenerations: z.array(assetGenerationSchema).max(1000).optional(),
  clipGenerations: z.array(assetGenerationSchema).max(1000).refine(items => new Set(items.map(g => g.id)).size === items.length, 'Duplicate generations.').optional(),
  library: z.array(z.object({ assetId: z.uuid(), originalAssetId: z.uuid().optional(), normalizedFps: z.number().finite().min(1).max(240).optional(), name: z.string().min(1).max(1000),
    generation:z.discriminatedUnion('provider',[z.object({provider:z.literal('comfy'),settings:settingsSchema.optional(),result:resultSchema}),z.object({provider:z.literal('fal'),settings:assetSettingsSchema,createdAt:number})]).optional(),
    kind: z.enum(['video', 'generated', 'subtitle', 'image', 'audio']), folderId: z.uuid().optional(), generationId: z.uuid().optional(), width: number.int().optional(), height: number.int().optional(), duration: number.positive().optional(), inFrame: number.int().optional(), outFrame: number.int().positive().optional(), volume: z.number().min(0).max(1).optional(),
  }).refine(item => item.outFrame === undefined || item.outFrame > (item.inFrame ?? 0), 'Invalid library clip boundaries.')).max(2000)
    .refine(items => new Set(items.map(item => item.assetId)).size === items.length, 'Duplicate library assets.')
    // Accept legacy subtitle entries, but keep subtitles exclusively on the project track.
    .transform(items => items.filter((item): item is typeof item & {kind:LibraryAsset['kind']} => item.kind !== 'subtitle')).optional(),
  source: z.object({ name: z.string().min(1).max(1000), assetId: z.uuid().optional(), originalAssetId: z.uuid().optional() }),
  interstitials: z.array(z.preprocess(preserveLegacyJobProvider, z.object({
    id: z.string().min(1).max(200), label: z.string().max(1000), time: number, kind: z.enum(['regular', 'call-response']).optional(), groupId: text.optional(),
    ...settingsSchema.shape, generationSettings: settingsSchema.optional(),
    requestMethod: z.enum([...generationMethods, 'fal']).optional(),
    requestPrompt: z.string().max(8000).optional(),
    requestSeed: generationSeedSchema.optional(),
    requestReference: generationReferenceSchema.optional(),
    requestOrigin: clipOriginSchema.optional(),
    requestInsertion: z.object({ start: number, duration: number.positive(), totalDuration: number.positive() })
      .refine(value => value.start + value.duration <= value.totalDuration + 0.1, 'Invalid job boundaries.').optional(),
    phase: z.enum(['draft', 'preparing', 'uploading', 'queued', 'rendering', 'loading', 'ready', 'error', 'cancelled']),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/).optional(), result: resultSchema.optional(), previousResult: resultSchema.optional(), error: text.optional(),
  }))).max(1000).refine(items => new Set(items.map(item => item.id)).size === items.length, 'Duplicate video IDs.')
    .refine(items => items.every(item => item.phase !== 'ready' || item.result), 'A completed video is missing its media.'),
  subtitle: z.object({ name: text, assetId: z.uuid() }).nullable(),
  analysis: z.object({ slice: z.object({ start: number, end: number }), provider: z.enum(['openai', 'gemini']), instructions: text,
    result: z.object({ caption: text, description: text, provider: z.enum(['openai', 'gemini']), model: text, start: number, end: number, basis: text }).nullable(),
  }),
}).refine(project => (project.callResponses ?? (project.callResponse ? [project.callResponse] : [])).every(flow => flow.scenes.every(scene => !scene.interstitialId || project.interstitials.some(item => item.id === scene.interstitialId))), 'A scene references a missing video.')
  .refine(project=>!project.storyFlow||project.storyFlow.nodes.every(n=>!n.interstitialId||project.interstitials.some(i=>i.id===n.interstitialId)),'A story clip references a missing video.')
  .refine(project=>!project.mediaModelVersion||project.storyFlow?.nodes.every(n=>!n.generationId||project.clipGenerations?.some(g=>g.id===n.generationId)),'A clip references missing generation settings.')
  .refine(project=>!project.mediaModelVersion||(project.clipGenerations??[]).every(g=>project.storyFlow?.nodes.filter(n=>n.generationId===g.id).length===1),'Generation settings must belong to exactly one timeline clip.')
  .refine(project=>!!project.source.assetId||!!project.storyFlow&&!project.callResponse&&!project.callResponses?.length,'A legacy project is missing its source video.');
const manifestSchema = z.object({ format: z.literal('sparko-project'), version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]), project: projectSchema,
  assets: z.array(z.object({ id: z.uuid(), name: z.string().min(1).max(1000), mime: z.string().max(200), size: number.int().positive().max(MAX_BYTES) })).max(2000),
});
type Progress = (message: string, fraction: number) => void;

export async function packProject(project: Project, assets: Asset[], signal: AbortSignal, progress: Progress) {
  assets = assets.filter(asset => !project.deletedAssetIds?.includes(asset.id));
  const supplied = new Set(assets.map(asset => asset.id));
  const manifest = manifestSchema.parse({ format: 'sparko-project', version: project.audioLayers?.length ? 6 : project.mediaModelVersion ? 5 : project.assetGenerations?.length || project.clipGenerations?.length || project.libraryFolders?.length || project.library?.some(a => a.kind === 'image' || a.kind === 'audio') ? 4 : project.storyFlow ? 3 : project.callResponse ? 2 : 1, project: {
    ...project,
    assetAliases: project.assetAliases ? Object.fromEntries(Object.entries(project.assetAliases).filter(([, id]) => supplied.has(id))) : undefined,
    interstitials: project.interstitials.map(item => ({ ...item, ...interstitialSettings(item), interpolateMiddle: undefined, maskTransitionMs: undefined,
      generationSettings: item.generationSettings ? interstitialSettings(item.generationSettings) : undefined,
      result: item.result ? { ...item.result, url: `asset:${item.result.assetId}` } : undefined,
      previousResult: item.previousResult ? { ...item.previousResult, url: `asset:${item.previousResult.assetId}` } : undefined,
    })),
  }, assets: assets.map(asset => ({ id: asset.id, name: asset.name, mime: asset.blob.type, size: asset.blob.size })) });
  const total = assets.reduce((sum, asset) => sum + asset.blob.size, 0);
  if (total > MAX_BYTES) throw new Error('Project files currently support up to 8 GB of media.');
  const manifestText = JSON.stringify(manifest);
  if (new Blob([manifestText]).size > MAX_MANIFEST) throw new Error('Project metadata exceeds 8 MB.');
  if (assetIds(project).some(id => !supplied.has(id))) throw new Error('A project asset is missing. Export was cancelled.');
  const writer = new ZipWriter(new BlobWriter('application/zip'), { level: 0, useWebWorkers: false });
  let written = 0;
  try {
    await writer.add('project.json', new TextReader(manifestText), { signal });
    for (const asset of assets) {
      signal.throwIfAborted();
      await writer.add(`assets/${asset.id}`, new BlobReader(asset.blob), { signal,
        onprogress: count => progress(`Packaging ${asset.name}`, (written + count) / Math.max(1, total)),
      });
      written += asset.blob.size;
    }
    return await writer.close();
  } catch (error) { await writer.close().catch(() => undefined); throw error; }
}

export async function unpackProject(file: Blob, signal: AbortSignal, progress: Progress): Promise<{ project: Project; assets: Asset[] }> {
  if (file.size > MAX_BYTES + MAX_MANIFEST * 2) throw new Error('This project exceeds the 8 GB import limit.');
  const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false, checkSignature: true, strictness: 'strict' });
  try {
    signal.throwIfAborted();
    const entries = await reader.getEntries();
    signal.throwIfAborted();
    if (entries.length > 2001 || new Set(entries.map(entry => entry.filename)).size !== entries.length) throw new Error('Invalid project archive entries.');
    for (const entry of entries) {
      if (entry.directory || entry.encrypted || entry.compressionMethod !== 0 || entry.compressedSize !== entry.uncompressedSize) throw new Error('Use a Sparko project archive with uncompressed, unencrypted assets.');
    }
    const entry = entries.find(entry => entry.filename === 'project.json');
    if (!entry || entry.directory || entry.uncompressedSize > MAX_MANIFEST) throw new Error('The archive is missing a valid project.json manifest.');
    const raw = JSON.parse(await entry.getData(new TextWriter(), { signal, checkSignature: true }));
    if (![1, 2, 3, 4, 5, 6].includes(raw.version) || raw.format !== 'sparko-project') throw new Error('This project format or version is not supported.');
    const parsed = manifestSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Invalid project metadata: ${parsed.error.issues[0].message}`);
    const { project, assets: descriptions } = parsed.data;
    const ids = new Set(descriptions.map(asset => asset.id));
    if (ids.size !== descriptions.length || entries.length !== descriptions.length + 1 || assetIds(project).some(id => !ids.has(id))) throw new Error('The project has missing or duplicate assets.');
    const total = descriptions.reduce((sum, asset) => sum + asset.size, 0);
    if (total > MAX_BYTES) throw new Error('This project exceeds the 8 GB import limit.');
    const remap = new Map([...descriptions.map(asset => asset.id), ...project.deletedAssetIds ?? []].map(id => [id, crypto.randomUUID()]));
    // MP4 provenance retains its original IDs. Keep every earlier ID mapped directly to the new local asset.
    const assetAliases = Object.fromEntries([...remap, ...Object.entries(project.assetAliases ?? {})
      .filter(([, id]) => remap.has(id)).map(([alias, id]) => [alias, remap.get(id)!])]);
    const remapAssetSettings = (settings: import('../../../shared/asset-generation').AssetSettings) => ({ ...settings, references: settings.references.map(ref => ({ ...ref, assetId: remap.get(ref.assetId)??ref.assetId })) });
    const remapVideo = (ref: import('../../../shared/video-references').VideoAssetReference) => ({ ...ref, assetId: remap.get(ref.assetId)??ref.assetId });
    const remapSettings = (settings: Parameters<typeof interstitialSettings>[0]) => ({ ...interstitialSettings(settings),
      timelineVideos: settings.timelineVideos?.map(clip => ({ ...clip, video: clip.video ? remapVideo(clip.video) : undefined })),
      startVideoAssets: settings.startVideoAssets?.map(remapVideo), endVideoAssets: settings.endVideoAssets?.map(remapVideo),
      startVideoAsset: settings.startVideoAsset ? { ...settings.startVideoAsset, assetId: remap.get(settings.startVideoAsset.assetId)! } : undefined,
      endVideoAsset: settings.endVideoAsset ? { ...settings.endVideoAsset, assetId: remap.get(settings.endVideoAsset.assetId)! } : undefined,
      ...(settings.keyframes ? { keyframes: settings.keyframes.map(keyframe => ({ ...keyframe, image: keyframe.image ? { ...keyframe.image, assetId: remap.get(keyframe.image.assetId) ?? keyframe.image.assetId } : undefined })) } : {}),
      ...(settings.imageReferences?.length ? { imageReferences: settings.imageReferences.map(image => ({ ...image, assetId: remap.get(image.assetId)??image.assetId })) } : {}),
    });
    const remapClip = (clip: z.infer<typeof clipReferenceSchema>) => ({ ...clip,
      ...(clip.sceneId.startsWith('asset:') ? { sceneId: `asset:${remap.get(clip.assetId)}` } : {}), assetId: remap.get(clip.assetId)! });
    const remapReference = (input?: z.infer<typeof generationReferenceSchema>) => input ? { ...input,
      before: input.before && remapClip(input.before), after: input.after && remapClip(input.after),
      beforeClips: input.beforeClips?.map(remapClip), afterClips: input.afterClips?.map(remapClip) } : undefined;
    const remapGeneration=(g:import('../../../shared/asset-generation').AssetGeneration)=>({...g,settings:remapAssetSettings(g.settings),submitted:g.submitted?remapAssetSettings(g.submitted):undefined,selectedAssetId:g.selectedAssetId?remap.get(g.selectedAssetId)!:undefined,versions:g.versions.map(v=>({...v,assetId:remap.get(v.assetId)!,settings:remapAssetSettings(v.settings)}))});
    const remapResult=(result:z.infer<typeof resultSchema>)=>({...result,reference:remapReference(result.reference),assetId:remap.get(result.assetId)??result.assetId,fullAssetId:result.fullAssetId?remap.get(result.fullAssetId)??result.fullAssetId:undefined,
      upscaled:result.upscaled?{...result.upscaled,assetId:remap.get(result.upscaled.assetId)??result.upscaled.assetId}:undefined,url:`asset:${remap.get(result.assetId)??result.assetId}`});
    const assets: Asset[] = []; let read = 0;
    for (const asset of descriptions) {
      signal.throwIfAborted();
      const media = entries.find(entry => entry.filename === `assets/${asset.id}`);
      if (!media || media.directory || media.uncompressedSize !== asset.size) throw new Error(`Missing or damaged asset: ${asset.name}`);
      const blob = await media.getData(new BlobWriter(asset.mime), { signal, checkSignature: true,
        onprogress: count => progress(`Reading ${asset.name}`, (read + count) / Math.max(1, total)),
      });
      if (blob.size !== asset.size) throw new Error(`Incomplete asset: ${asset.name}`);
      assets.push({ id: remap.get(asset.id)!, name: asset.name, blob }); read += blob.size;
    }
    return { project: {
      ...project, id: `project:${crypto.randomUUID()}`, updatedAt: Date.now(), assetAliases,
      deletedAssetIds: project.deletedAssetIds?.map(id => remap.get(id)!),
      audioLayers: project.audioLayers?.map(layer => ({ ...layer, assetId: remap.get(layer.assetId)! })),
      library: project.library?.map(item => ({ ...item, generation:item.generation?.provider==='comfy'?{...item.generation,result:remapResult(item.generation.result),settings:item.generation.settings?remapSettings(item.generation.settings):undefined}:item.generation?{...item.generation,settings:remapAssetSettings(item.generation.settings)}:undefined, assetId: remap.get(item.assetId)!, originalAssetId: item.originalAssetId ? remap.get(item.originalAssetId)! : undefined })),
      assetGenerations:project.assetGenerations?.map(remapGeneration),
      clipGenerations: project.clipGenerations?.map(g => ({ ...g, settings: remapAssetSettings(g.settings), submitted: g.submitted ? remapAssetSettings(g.submitted) : undefined,
        selectedAssetId: g.selectedAssetId ? remap.get(g.selectedAssetId)! : undefined,
        phase: g.phase === 'preparing' ? 'draft' : g.phase,
        versions: g.versions.map(v => ({ ...v, assetId: remap.get(v.assetId)!, settings: remapAssetSettings(v.settings) })) })),
      storyFlow: project.storyFlow ? {...project.storyFlow,nodes:project.storyFlow.nodes.map(n=>({...n,source:n.source?{...n.source,assetId:remap.get(n.source.assetId)!,originalAssetId:n.source.originalAssetId?remap.get(n.source.originalAssetId)!:undefined}:undefined})),
        templates:project.storyFlow.templates.map(t=>({...t,generations:t.generations?.map(remapGeneration),settings:Object.fromEntries(Object.entries(t.settings).map(([id,settings])=>[id,remapSettings(settings)])),nodes:t.nodes.map(n=>({...n,source:n.source?{...n.source,assetId:remap.get(n.source.assetId)!,originalAssetId:n.source.originalAssetId?remap.get(n.source.originalAssetId)!:undefined}:undefined}))}))}:undefined,
      callResponse: project.callResponse ? { ...project.callResponse, scenes: project.callResponse.scenes.map(scene => ({ ...scene, clip: { ...scene.clip, assetId: remap.get(scene.clip.assetId)! } })) } : undefined,
      callResponses: project.callResponses?.map(flow => ({ ...flow, scenes: flow.scenes.map(scene => ({ ...scene, clip: { ...scene.clip, assetId: remap.get(scene.clip.assetId)! } })) })),
      source: { ...project.source, assetId: project.source.assetId?remap.get(project.source.assetId)!:undefined, originalAssetId: project.source.originalAssetId ? remap.get(project.source.originalAssetId)! : undefined },
      subtitle: project.subtitle ? { ...project.subtitle, assetId: remap.get(project.subtitle.assetId)! } : null,
      interstitials: project.interstitials.map(item => ({ ...item, ...remapSettings(item), interpolateMiddle: undefined, maskTransitionMs: undefined,
        generationSettings: item.generationSettings ? remapSettings(item.generationSettings) : undefined,
        requestReference: remapReference(item.requestReference),
        phase: ['preparing', 'uploading'].includes(item.phase) ? 'draft' : item.phase,
        result: item.result ? { ...item.result, reference: remapReference(item.result.reference), assetId: remap.get(item.result.assetId)!, ...(item.result.fullAssetId ? { fullAssetId: remap.get(item.result.fullAssetId)! } : {}), ...(item.result.upscaled ? { upscaled: { ...item.result.upscaled, assetId: remap.get(item.result.upscaled.assetId)! } } : {}), url: `asset:${remap.get(item.result.assetId)}` } : undefined,
        previousResult: item.previousResult ? { ...item.previousResult, reference: remapReference(item.previousResult.reference), assetId: remap.get(item.previousResult.assetId)!, ...(item.previousResult.fullAssetId ? { fullAssetId: remap.get(item.previousResult.fullAssetId)! } : {}), ...(item.previousResult.upscaled ? { upscaled: { ...item.previousResult.upscaled, assetId: remap.get(item.previousResult.upscaled.assetId)! } } : {}), url: `asset:${remap.get(item.previousResult.assetId)}` } : undefined,
      })),
    }, assets };
  } finally { await reader.close(); }
}
