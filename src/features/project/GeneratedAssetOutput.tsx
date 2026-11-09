import type { LibraryAsset } from './types';
import { AssetPreview } from './AssetInspector';
import AssetGenerationInfo from './AssetGenerationInfo';
import GeneratedVideoSeed from './GeneratedVideoSeed';

export default function GeneratedAssetOutput({ asset, kind, onPlay }: { asset?: LibraryAsset; kind: 'video' | 'image' | 'audio'; onPlay: () => void }) {
  return <details className="inspector-group inspector-output"><summary>Generated {kind}<span>{asset ? 'Saved media' : 'Not generated'}</span></summary>
    <div className="inspector-group-body generated-output-compact">{asset ? <>
      <AssetPreview id={asset.assetId} kind={kind} name={asset.name} onPlay={onPlay}/>
      <details className="generated-output-details"><summary>Render details</summary>
        {asset.generation?.provider === 'comfy' && <GeneratedVideoSeed result={asset.generation.result} settings={asset.generation.settings}/>}
        <AssetGenerationInfo asset={asset}/>
      </details>
    </> : <p className="hint">Generate this clip to see its {kind} and saved generation details.</p>}</div>
  </details>;
}
