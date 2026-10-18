import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { z } from 'zod';
import { generationMethods, interstitialSettings, maskInjections } from '../../../shared/interstitials';
import { INTERSTITIAL, TIMELINE_FPS } from '../../../shared/constants';
import { assetIds, type Asset, type Project } from './types';
import { callResponseSchema } from '../call-response/schema';

const MAX_BYTES = 8 * 1024 ** 3;
const MAX_MANIFEST = 8 * 1024 ** 2;
const number = z.number().finite().nonnegative();
const text = z.string().max(50_000);
const clipReferenceSchema = z.object({ sceneId: z.string().min(1).max(200), assetId: z.uuid(), inFrame: number.int(), outFrame: number.int().positive() }).refine(value => value.outFrame > value.inFrame);
const generationReferenceSchema = z.object({ mode: z.enum(['extend', 'loop', 'bridge']).optional(), before: clipReferenceSchema, after: clipReferenceSchema.optional() });
const resultSchema = z.object({ url: text, assetId: z.uuid(), fullAssetId: z.uuid().optional(),
  fullRange: z.object({ start: number, duration: number.positive(), totalDuration: number.positive() })
    .refine(value => value.start + value.duration <= value.totalDuration + 0.1, 'Invalid full video boundaries.').optional(),
  start: number, duration: number.positive(), totalDuration: number.positive(), reference: generationReferenceSchema.optional() })
  .refine(value => value.start + value.duration <= value.totalDuration + 0.1, 'Invalid interstitial boundaries.');
const settingsSchema = z.object({
  method: z.enum([...generationMethods, 'fal']).optional().transform(value => value === 'fal' || value === undefined ? 'comfy' as const : value),
  continuity: text.optional(), dialogue: text.optional(), loopAudio: z.boolean().optional(),
  interpolateMiddle: z.boolean().optional(),
  maskInjection: z.enum(maskInjections).optional(),
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
  source: z.object({ name: z.string().min(1).max(1000), assetId: z.uuid(), originalAssetId: z.uuid().optional() }),
  interstitials: z.array(z.preprocess(preserveLegacyJobProvider, z.object({
    id: z.string().min(1).max(200), label: z.string().max(1000), time: number, kind: z.enum(['regular', 'call-response']).optional(), groupId: text.optional(),
    ...settingsSchema.shape, generationSettings: settingsSchema.optional(),
    requestMethod: z.enum([...generationMethods, 'fal']).optional(),
    requestPrompt: z.string().max(8000).optional(),
    requestReference: generationReferenceSchema.optional(),
    requestInsertion: z.object({ start: number, duration: number.positive(), totalDuration: number.positive() })
      .refine(value => value.start + value.duration <= value.totalDuration + 0.1, 'Invalid job boundaries.').optional(),
    phase: z.enum(['draft', 'preparing', 'uploading', 'queued', 'rendering', 'loading', 'ready', 'error', 'cancelled']),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/).optional(), result: resultSchema.optional(), previousResult: resultSchema.optional(), error: text.optional(),
  }))).max(1000).refine(items => new Set(items.map(item => item.id)).size === items.length, 'Duplicate interstitial IDs.')
    .refine(items => items.every(item => item.phase !== 'ready' || item.result), 'A completed interstitial is missing its media.'),
  subtitle: z.object({ name: text, assetId: z.uuid() }).nullable(),
  analysis: z.object({ slice: z.object({ start: number, end: number }), provider: z.enum(['openai', 'gemini']), instructions: text,
    result: z.object({ caption: text, description: text, provider: z.enum(['openai', 'gemini']), model: text, start: number, end: number, basis: text }).nullable(),
  }),
}).refine(project => (project.callResponses ?? (project.callResponse ? [project.callResponse] : [])).every(flow => flow.scenes.every(scene => !scene.interstitialId || project.interstitials.some(item => item.id === scene.interstitialId))), 'A scene references a missing interstitial.');
const manifestSchema = z.object({ format: z.literal('sparko-project'), version: z.union([z.literal(1), z.literal(2)]), project: projectSchema,
  assets: z.array(z.object({ id: z.uuid(), name: z.string().min(1).max(1000), mime: z.string().max(200), size: number.int().positive().max(MAX_BYTES) })).max(2000),
});
type Progress = (message: string, fraction: number) => void;

export async function packProject(project: Project, assets: Asset[], signal: AbortSignal, progress: Progress) {
  const manifest = manifestSchema.parse({ format: 'sparko-project', version: project.callResponse ? 2 : 1, project: {
    ...project, interstitials: project.interstitials.map(item => ({ ...item, ...interstitialSettings(item), interpolateMiddle: undefined,
      generationSettings: item.generationSettings ? interstitialSettings(item.generationSettings) : undefined,
      result: item.result ? { ...item.result, url: `asset:${item.result.assetId}` } : undefined,
      previousResult: item.previousResult ? { ...item.previousResult, url: `asset:${item.previousResult.assetId}` } : undefined,
    })),
  }, assets: assets.map(asset => ({ id: asset.id, name: asset.name, mime: asset.blob.type, size: asset.blob.size })) });
  const total = assets.reduce((sum, asset) => sum + asset.blob.size, 0);
  if (total > MAX_BYTES) throw new Error('Project files currently support up to 8 GB of media.');
  const manifestText = JSON.stringify(manifest);
  if (new Blob([manifestText]).size > MAX_MANIFEST) throw new Error('Project metadata exceeds 8 MB.');
  const supplied = new Set(assets.map(asset => asset.id));
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
    if (![1, 2].includes(raw.version) || raw.format !== 'sparko-project') throw new Error('This project format or version is not supported.');
    const parsed = manifestSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Invalid project metadata: ${parsed.error.issues[0].message}`);
    const { project, assets: descriptions } = parsed.data;
    const ids = new Set(descriptions.map(asset => asset.id));
    if (ids.size !== descriptions.length || entries.length !== descriptions.length + 1 || assetIds(project).some(id => !ids.has(id))) throw new Error('The project has missing or duplicate assets.');
    const total = descriptions.reduce((sum, asset) => sum + asset.size, 0);
    if (total > MAX_BYTES) throw new Error('This project exceeds the 8 GB import limit.');
    const remap = new Map(descriptions.map(asset => [asset.id, crypto.randomUUID()]));
    const remapReference = (input?: z.infer<typeof generationReferenceSchema>) => input ? { mode: input.mode, before: { ...input.before, assetId: remap.get(input.before.assetId)! },
      after: input.after ? { ...input.after, assetId: remap.get(input.after.assetId)! } : undefined } : undefined;
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
      ...project, id: `project:${crypto.randomUUID()}`, updatedAt: Date.now(),
      callResponse: project.callResponse ? { ...project.callResponse, scenes: project.callResponse.scenes.map(scene => ({ ...scene, clip: { ...scene.clip, assetId: remap.get(scene.clip.assetId)! } })) } : undefined,
      callResponses: project.callResponses?.map(flow => ({ ...flow, scenes: flow.scenes.map(scene => ({ ...scene, clip: { ...scene.clip, assetId: remap.get(scene.clip.assetId)! } })) })),
      source: { ...project.source, assetId: remap.get(project.source.assetId)!, originalAssetId: project.source.originalAssetId ? remap.get(project.source.originalAssetId)! : undefined },
      subtitle: project.subtitle ? { ...project.subtitle, assetId: remap.get(project.subtitle.assetId)! } : null,
      interstitials: project.interstitials.map(item => ({ ...item, ...interstitialSettings(item), interpolateMiddle: undefined,
        generationSettings: item.generationSettings ? interstitialSettings(item.generationSettings) : undefined,
        requestReference: remapReference(item.requestReference),
        phase: ['preparing', 'uploading'].includes(item.phase) ? 'draft' : item.phase,
        result: item.result ? { ...item.result, reference: remapReference(item.result.reference), assetId: remap.get(item.result.assetId)!, ...(item.result.fullAssetId ? { fullAssetId: remap.get(item.result.fullAssetId)! } : {}), url: `asset:${remap.get(item.result.assetId)}` } : undefined,
        previousResult: item.previousResult ? { ...item.previousResult, reference: remapReference(item.previousResult.reference), assetId: remap.get(item.previousResult.assetId)!, ...(item.previousResult.fullAssetId ? { fullAssetId: remap.get(item.previousResult.fullAssetId)! } : {}), url: `asset:${remap.get(item.previousResult.assetId)}` } : undefined,
      })),
    }, assets };
  } finally { await reader.close(); }
}
