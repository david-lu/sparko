import { useEffect, useRef } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { audioVolume } from '../../media/audioVolume';
import type { StoryNode } from './model';
import type { StoryEditor } from './useStoryEditor';
import '../project/asset-volume.css';

export default function ClipVolumeControl({ node, editor }: { node: StoryNode; editor: StoryEditor }) {
  const volume = audioVolume(node.volume), previous = useRef(1);
  useEffect(() => { previous.current = volume || 1; }, [node.id]);
  useEffect(() => { if (volume > 0) previous.current = volume; }, [volume]);
  const boundary = () => editor.projects.endHistoryGroup();
  const edit = (value: number) => { if (Number.isFinite(value)) editor.patch(node.id, { volume: audioVolume(value) }); };
  return <details className="inspector-group asset-volume" open><summary>Clip audio</summary>
    <div className="asset-volume-row">
      <button type="button" className="icon-button small" aria-label={volume === 0 ? 'Unmute clip' : 'Mute clip'} onClick={() => { boundary(); edit(volume === 0 ? previous.current : 0); boundary(); }}>
        {volume === 0 ? <VolumeX size={14}/> : <Volume2 size={14}/>}
      </button>
      <label><span>Volume</span><input type="range" min={0} max={100} step={1} value={Math.round(volume * 100)} aria-label="Clip volume" aria-valuetext={`${Math.round(volume * 100)}%`}
        onPointerDown={boundary} onPointerUp={boundary} onPointerCancel={boundary} onBlur={boundary} onKeyUp={boundary} onChange={e => edit(e.currentTarget.valueAsNumber / 100)}/></label>
      <output aria-label="Clip volume percentage">{Math.round(volume * 100)}%</output>
    </div>
    <p className="hint">Applies to this clip in playback and exports.</p>
  </details>;
}
