import type { LibraryAsset } from './types';
import { AssetPreview } from './AssetInspector';
import AssetGenerationInfo from './AssetGenerationInfo';

export default function GeneratedAssetOutput({ asset, kind, onPlay }: { asset?: LibraryAsset; kind: 'video' | 'image' | 'audio'; onPlay: () => void }) {
  return <details className="inspector-group inspector-output"><summary>Generated {kind}<span>{asset ? 'Saved media' : 'Not generated'}</span></summary>
    <div className="inspector-group-body">{asset ? <>
      <AssetPreview id={asset.assetId} kind={kind} name={asset.name} onPlay={onPlay}/>
      <AssetGenerationInfo asset={asset}/>
    </> : <p className="hint">Generate this clip to see its {kind} and saved generation details.</p>}</div>
  </details>;
}
