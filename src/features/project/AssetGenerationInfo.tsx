import { assetModel } from '../../../shared/asset-generation';
import { referenceClips } from '../../../shared/reference-clips';
import type { LibraryAsset } from './types';
import './generation-info.css';

/** Render provenance is immutable media information, shared by every placement. */
export default function AssetGenerationInfo({ asset, showPrompt = true, showBreakdown = true }: { asset?: LibraryAsset; showPrompt?: boolean; showBreakdown?: boolean }) {
  const generation = asset?.generation;
  if (!generation) return null;
  const result = generation?.provider === 'comfy' ? generation.result : undefined;
  const metadata = result?.metadata, settings = generation?.settings;
  const prompt = generation?.provider === 'fal' ? generation.settings.prompt : result?.prompt ?? metadata?.prompt;
  const references = generation?.provider === 'fal' ? generation.settings.references.map(ref => ref.name)
    : metadata ? [...referenceClips(metadata.references, 'before'), ...referenceClips(metadata.references, 'after')].map(ref => ref.name) : [];
  return <section className="asset-generation-info" aria-label="Generation info">
        <dl><div><dt>Model</dt><dd>{generation.provider === 'comfy' ? 'Comfy · H3' : assetModel(generation.settings.model)?.name ?? generation.settings.model}</dd></div>
          {showBreakdown && result && <div><dt>Seed</dt><dd>{metadata?.seed ?? 'Not recorded'}</dd></div>}
          {settings && asset?.kind !== 'audio' && <div><dt>Resolution</dt><dd>{settings.resolution}</dd></div>}
          {showBreakdown && settings && asset?.kind !== 'image' && <div><dt>Duration</dt><dd>{result?.duration ?? settings.duration} s</dd></div>}
          {showBreakdown && references.length > 0 && <div><dt>References</dt><dd>{references.join(' → ')}</dd></div>}
          {metadata?.createdAt && <div><dt>Rendered</dt><dd>{metadata.createdAt}</dd></div>}
        </dl>
        {showPrompt && <details className="interstitial-prompt-details"><summary>Submitted prompt</summary><pre>{prompt || 'Not recorded for this media.'}</pre></details>}
        {settings && <details><summary>All saved settings</summary><pre>{JSON.stringify(settings, null, 2)}</pre></details>}
  </section>;
}
