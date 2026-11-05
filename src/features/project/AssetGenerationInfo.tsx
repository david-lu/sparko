import { assetModel } from '../../../shared/asset-generation';
import { referenceClips } from '../../../shared/reference-clips';
import type { LibraryAsset } from './types';
import './generation-info.css';

/** Render provenance is immutable media information, shared by every placement. */
export default function AssetGenerationInfo({ asset }: { asset?: LibraryAsset }) {
  const generation = asset?.generation;
  const result = generation?.provider === 'comfy' ? generation.result : undefined;
  const metadata = result?.metadata, settings = generation?.settings;
  const prompt = generation?.provider === 'fal' ? generation.settings.prompt : result?.prompt ?? metadata?.prompt;
  const references = generation?.provider === 'fal' ? generation.settings.references.map(ref => ref.name)
    : metadata ? [...referenceClips(metadata.references, 'before'), ...referenceClips(metadata.references, 'after')].map(ref => ref.name) : [];
  return <details className="inspector-group asset-render-info" open><summary>Render info<span>{generation ? generation.provider === 'comfy' ? 'Comfy · H3' : assetModel(generation.settings.model)?.name : 'Media provenance'}</span></summary>
    <section className="asset-render-info-body" aria-label="Generation info" tabIndex={0}>
      {generation ? <>
        <dl><div><dt>Model</dt><dd>{generation.provider === 'comfy' ? 'Comfy · H3' : assetModel(generation.settings.model)?.name ?? generation.settings.model}</dd></div>
          {result && <div><dt>Seed</dt><dd>{metadata?.seed ?? 'Not recorded'}</dd></div>}
          {settings && <><div><dt>Resolution</dt><dd>{settings.resolution}</dd></div><div><dt>Duration</dt><dd>{result?.duration ?? settings.duration} s</dd></div></>}
          {references.length > 0 && <div><dt>References</dt><dd>{references.join(' → ')}</dd></div>}
          {metadata?.createdAt && <div><dt>Rendered</dt><dd>{metadata.createdAt}</dd></div>}
        </dl>
        <strong>Submitted prompt</strong><pre>{prompt || 'Not recorded for this video.'}</pre>
        {settings && <details><summary>All saved settings</summary><pre>{JSON.stringify(settings, null, 2)}</pre></details>}
      </> : <p className="hint">{asset ? 'No generation information was saved with this media.' : 'Generate this clip or choose an asset to see its saved render information.'}</p>}
    </section>
  </details>;
}
