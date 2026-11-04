import { useState } from 'react';
import { AssetPreview } from './AssetInspector';
import { assets } from './assets';
import type { Video } from './videos';

/** Archived renders remain available without becoming duplicate library videos. */
export default function VideoVersions({ video, onPlay }: { video: Video; onPlay: () => void }) {
  const [selected, setSelected] = useState<string>();
  const versions = video.versions ?? [], version = versions.find(v => v.assetId === selected) ?? versions.at(-1);
  if (versions.length < 2 || !version) return null;
  return <details className="inspector-group"><summary>Versions<span>{versions.length}</span></summary>
    <div className="asset-versions">{versions.map((v, i) => <button key={v.assetId} type="button" aria-pressed={version.assetId === v.assetId} onClick={() => setSelected(v.assetId)}>v{i + 1}</button>)}</div>
    <AssetPreview id={version.assetId} name={video.name} kind="video" onPlay={onPlay}/>
    <a className="text-button" href={assets.url(version.assetId)} download={`${video.name}-v${versions.indexOf(version) + 1}.mp4`}>Download version</a>
  </details>;
}
