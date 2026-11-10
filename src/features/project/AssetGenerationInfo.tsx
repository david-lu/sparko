import { generationPrompt } from '../../../shared/prompt-versions';
import { assetModel } from '../../../shared/asset-generation';
import { referenceClips } from '../../../shared/reference-clips';
import { videoAssets } from '../../../shared/video-references';
import ContentIssues from '../../shared/ContentIssues';
import { assets } from './assets';
import { useAssetAvailability } from './useAssetAvailability';
import type { LibraryAsset } from './types';
import './generation-info.css';

/** Render provenance is immutable media information, shared by every placement. */
export default function AssetGenerationInfo({ asset, showPrompt = true, showBreakdown = true }: { asset?: LibraryAsset; showPrompt?: boolean; showBreakdown?: boolean }) {
  const generation = asset?.generation;
  const inputs = generation?.provider === 'fal' ? generation.settings.references : generation ? [
    ...generation.settings?.imageReferences ?? [],
    ...generation.settings?.keyframes?.flatMap(keyframe => keyframe.image ? [keyframe.image] : []) ?? [],
    ...videoAssets(generation.settings ?? {}, 'start'), ...videoAssets(generation.settings ?? {}, 'end'),
    ...(['before', 'after'] as const).flatMap(side => referenceClips(generation.result.reference, side).map((ref, index) => ({
      assetId: ref.assetId, name: referenceClips(generation.result.metadata?.references, side)[index]?.name ?? `${side === 'before' ? 'Start' : 'End'} video reference`,
    }))),
  ] : [];
  useAssetAvailability(inputs.map(ref => ref.assetId));
  const issues = [...new Map(inputs.map(ref => [ref.assetId, ref])).values()].flatMap(ref => assets.error(ref.assetId)
    ? [{ key: ref.assetId, title: `Missing reference: ${ref.name}`, message: assets.error(ref.assetId)! }] : []);
  if (!generation) return null;
  const result = generation?.provider === 'comfy' ? generation.result : undefined;
  const metadata = result?.metadata, settings = generation?.settings;
  const prompt = generation?.provider === 'fal' ? generationPrompt(generation.settings) : result?.prompt ?? metadata?.prompt;
  const references = generation?.provider === 'fal' ? generation.settings.references.map(ref => ref.name)
    : metadata ? [...referenceClips(metadata.references, 'before'), ...referenceClips(metadata.references, 'after')].map(ref => ref.name) : [];
  return <section className="asset-generation-info" aria-label="Generation info">
        <dl><div><dt>Model</dt><dd>{generation.provider === 'comfy' ? 'Comfy · H3' : assetModel(generation.settings.model)?.name ?? generation.settings.model}</dd></div>
          {settings && asset?.kind !== 'audio' && <div><dt>Resolution</dt><dd>{settings.resolution}</dd></div>}
          {showBreakdown && settings && asset?.kind !== 'image' && <div><dt>Duration</dt><dd>{result?.duration ?? settings.duration} s</dd></div>}
          {showBreakdown && (references.length > 0 || inputs.length > 0) && <div><dt>References</dt><dd><ContentIssues label="Saved reference errors" issues={issues}/>{(references.length ? references : inputs.map(ref => ref.name)).join(' → ')}</dd></div>}
          {metadata?.createdAt && <div><dt>Rendered</dt><dd>{metadata.createdAt}</dd></div>}
        </dl>
        {showPrompt && <details className="interstitial-prompt-details"><summary>Submitted prompt</summary><pre>{prompt || 'Not recorded for this media.'}</pre></details>}
        {settings && <details><summary>All saved settings</summary><pre>{JSON.stringify(settings, null, 2)}</pre></details>}
  </section>;
}
