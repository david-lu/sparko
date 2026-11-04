import { useEffect, useRef } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { audioVolume } from '../../media/audioVolume';
import type { ProjectController } from './ProjectController';
import { assetVolume, volumeAssetId } from './assetVolume';
import './asset-volume.css';

export default function AssetVolumeControl({ projects, assetId }: { projects: ProjectController; assetId?: string }) {
  const library = projects.getSnapshot().project?.library, asset = library?.find(asset => asset.assetId === assetId);
  const volume = assetVolume(library, assetId), previous = useRef(1);
  useEffect(() => { previous.current = volume || 1; }, [assetId]);
  useEffect(() => { if (volume > 0) previous.current = volume; }, [volume]);
  const edit = (value: number) => {
    if (!asset || !Number.isFinite(value)) return;
    projects.editAssets(project => {
      const owner = volumeAssetId(project.library, asset.assetId);
      return { ...project, library: project.library?.map(item => volumeAssetId(project.library, item.assetId) === owner ? { ...item, volume: audioVolume(value) } : item) };
    });
  };
  const boundary = () => projects.endHistoryGroup();
  return <details className="inspector-group asset-volume" open><summary>Audio</summary>
    <div className="asset-volume-row">
      <button type="button" className="icon-button small" disabled={!asset} aria-label={volume === 0 ? 'Unmute asset' : 'Mute asset'} title={volume === 0 ? 'Unmute asset' : 'Mute asset'} onClick={() => { boundary(); edit(volume === 0 ? previous.current : 0); boundary(); }}>
        {volume === 0 ? <VolumeX size={14}/> : <Volume2 size={14}/>}
      </button>
      <label><span>Volume</span><input type="range" min={0} max={100} step={1} value={Math.round(volume * 100)} disabled={!asset} aria-label="Asset volume" aria-valuetext={`${Math.round(volume * 100)}%`}
        onPointerDown={boundary} onPointerUp={boundary} onPointerCancel={boundary} onBlur={boundary} onKeyUp={boundary} onChange={e => edit(e.currentTarget.valueAsNumber / 100)}/></label>
      <output aria-label="Asset volume percentage">{Math.round(volume * 100)}%</output>
    </div>
    <p className="hint">Applies to this asset in the timeline and exports. The base preview stays unchanged.</p>
  </details>;
}
