import { Trash2 } from 'lucide-react';
import { COMFY, TIMELINE_FPS } from '../../../shared/constants';
import { type VideoKeyframe } from '../../../shared/video-keyframes';
import type { ProjectController } from '../project/ProjectController';
import AssetInput from '../project/AssetInput';
import { timelineSeconds } from './generation-timeline';
import './video-keyframes.css';

/** Properties for the selected image guide; all positioning lives in GenerationTimeline. */
export default function VideoKeyframes({ projects, value = [], selectedId, onSelect, middleFrames, prefixFrames, onChange, onPreviewPlay }: {
  projects: ProjectController; value?: VideoKeyframe[]; selectedId?: string; onSelect: (id: string) => void; middleFrames: number; prefixFrames: number;
  onChange: (update: (current: VideoKeyframe[]) => VideoKeyframe[]) => void; onPreviewPlay: () => void;
}) {
  const selected = value.find(keyframe => keyframe.id === selectedId) ?? value[0];
  const edit = (id: string, patch: Partial<VideoKeyframe>) => onChange(current => current.map(keyframe => keyframe.id === id ? { ...keyframe, ...patch } : keyframe));
  const setFrame = (id: string, frame: number) => {
    if (Number.isFinite(frame)) edit(id, { frame: Math.max(0, Math.min(COMFY.maxFrames - 1, Math.round(frame))) });
  };
  return <div className="video-keyframes">
    {selected && <div className="video-keyframe-card" role="group" aria-label={`Image keyframe ${value.indexOf(selected) + 1}`}>
      <div className="video-keyframe-heading">
        <select aria-label="Selected image keyframe" value={selected.id} onChange={event => onSelect(event.target.value)}>
          {value.map((keyframe, i) => <option key={keyframe.id} value={keyframe.id}>{i + 1}. {keyframe.image?.name ?? 'Choose an image'}{keyframe.enabled ? '' : ' (disabled)'}</option>)}
        </select>
        <button type="button" className="icon-button small" aria-label="Delete image keyframe" onClick={() => onChange(current => current.filter(keyframe => keyframe.id !== selected.id))}><Trash2 size={14}/></button>
      </div>
      <AssetInput key={selected.id} projects={projects} value={selected.image ? [{ ...selected.image, kind: 'image' }] : []} kinds={['image']} multiple={false}
        label="Keyframe image" imageFormats={['image/png', 'image/jpeg', 'image/webp']} onPreviewPlay={onPreviewPlay}
        onChange={references => edit(selected.id, { image: references[0] ? { assetId: references[0].assetId, name: references[0].name } : undefined })}/>
      <div className="video-keyframe-time">
        <label>Time in full video (s)<input aria-label="Keyframe time in seconds" type="number" min={timelineSeconds(prefixFrames)} max={timelineSeconds(prefixFrames + COMFY.maxFrames - 1)} step="any"
          value={timelineSeconds(prefixFrames + selected.frame)} onChange={event => setFrame(selected.id, event.currentTarget.valueAsNumber * TIMELINE_FPS - prefixFrames)}/></label>
        <label>Full-video frame<input aria-label="Keyframe frame" type="number" min={prefixFrames} max={prefixFrames + COMFY.maxFrames - 1} step={1} value={prefixFrames + selected.frame}
          onChange={event => setFrame(selected.id, event.currentTarget.valueAsNumber - prefixFrames)}/></label>
      </div>
      <div className="video-keyframe-footer"><label><input type="checkbox" checked={selected.enabled} onChange={event => edit(selected.id, { enabled: event.target.checked })}/>Enabled</label>
        <span className="hint">Generated: {(selected.frame / TIMELINE_FPS).toFixed(3)}s · frame {selected.frame}</span></div>
      <p className="video-keyframe-error hint" role="status">{selected.enabled && !selected.image ? 'Choose an image before generating.' : selected.frame >= middleFrames ? 'Outside the generated section. Move this keyframe or increase Duration.' : '\u00a0'}</p>
    </div>}
    <p className="hint">Image guides define the pose and composition at their marked times. They add no duration or audio; the mask lanes control reference regeneration.</p>
  </div>;
}
