import { useState } from 'react';
import { DiamondPlus, Trash2 } from 'lucide-react';
import { COMFY, TIMELINE_FPS } from '../../../shared/constants';
import { MAX_VIDEO_KEYFRAMES, type VideoKeyframe } from '../../../shared/video-keyframes';
import type { ProjectController } from '../project/ProjectController';
import AssetInput from '../project/AssetInput';
import './video-keyframes.css';

export default function VideoKeyframes({ projects, value = [], middleFrames, prefixFrames, suffixFrames, onChange, onPreviewPlay }: {
  projects: ProjectController; value?: VideoKeyframe[]; middleFrames: number; prefixFrames: number; suffixFrames: number;
  onChange: (update: (current: VideoKeyframe[]) => VideoKeyframe[]) => void; onPreviewPlay: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = value.find(keyframe => keyframe.id === selectedId) ?? value[0];
  const total = prefixFrames + middleFrames + suffixFrames;
  const edit = (id: string, patch: Partial<VideoKeyframe>) => onChange(current => current.map(keyframe => keyframe.id === id ? { ...keyframe, ...patch } : keyframe));
  const setFrame = (id: string, frame: number) => {
    if (Number.isFinite(frame)) edit(id, { frame: Math.max(0, Math.min(COMFY.maxFrames - 1, Math.round(frame))) });
  };
  const add = () => {
    const used = new Set(value.filter(keyframe => keyframe.enabled).map(keyframe => keyframe.frame));
    const midpoint = Math.floor((middleFrames - 1) / 2);
    const frame = Array.from({ length: middleFrames }, (_, i) => i).sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint)).find(frame => !used.has(frame));
    if (frame === undefined) return;
    const id = crypto.randomUUID();
    onChange(current => current.length < MAX_VIDEO_KEYFRAMES ? [...current, { id, frame, enabled: true }] : current);
    setSelectedId(id);
  };
  return <div className="video-keyframes">
    <div className="video-keyframes-heading"><span>Image keyframes <span className="hint">{value.length}/{MAX_VIDEO_KEYFRAMES}</span></span>
      <button type="button" className="text-button" onClick={add} disabled={value.length >= MAX_VIDEO_KEYFRAMES}><DiamondPlus size={14}/>Add image keyframe</button>
    </div>
    <p className="hint">Place an image at a specific moment in the generated section. Times snap to 24 fps; reference footage is added before and after.</p>
    <div className="video-keyframe-track" role="group" aria-label="Image keyframe timeline">
      <span className="video-keyframe-body" style={{ left: `${prefixFrames / total * 100}%`, width: `${middleFrames / total * 100}%` }}/>
      {value.filter(keyframe => keyframe.frame < middleFrames).map((keyframe, index) => <button key={keyframe.id} type="button" className="video-keyframe-marker"
        data-selected={keyframe.id === selected?.id} aria-pressed={keyframe.id === selected?.id} data-enabled={keyframe.enabled}
        style={{ left: `${(prefixFrames + keyframe.frame) / total * 100}%` }}
        aria-label={`Select image keyframe ${value.indexOf(keyframe) + 1}`} title={`${keyframe.image?.name ?? `Keyframe ${index + 1}`} · ${(keyframe.frame / TIMELINE_FPS).toFixed(3)}s generated`}
        onClick={() => setSelectedId(keyframe.id)}><span/></button>)}
    </div>
    <div className="video-keyframe-scale hint"><span>0s</span><span>{(prefixFrames / TIMELINE_FPS).toFixed(3)}–{((prefixFrames + middleFrames) / TIMELINE_FPS).toFixed(3)}s generated</span><span>{(total / TIMELINE_FPS).toFixed(3)}s</span></div>
    {!value.length && <p className="hint">Add a keyframe, then choose or drop an image from Library.</p>}
    {selected && <div className="video-keyframe-card" role="group" aria-label={`Image keyframe ${value.indexOf(selected) + 1}`}>
      <div className="video-keyframe-heading">
        <select aria-label="Selected image keyframe" value={selected.id} onChange={event => setSelectedId(event.target.value)}>
          {value.map((keyframe, i) => <option key={keyframe.id} value={keyframe.id}>{i + 1}. {keyframe.image?.name ?? 'Choose an image'}{keyframe.enabled ? '' : ' (disabled)'}</option>)}
        </select>
        <button type="button" className="icon-button small" aria-label="Delete image keyframe" onClick={() => onChange(current => current.filter(keyframe => keyframe.id !== selected.id))}><Trash2 size={14}/></button>
      </div>
      <AssetInput key={selected.id} projects={projects} value={selected.image ? [{ ...selected.image, kind: 'image' }] : []} kinds={['image']} multiple={false}
        label="Keyframe image" imageFormats={['image/png', 'image/jpeg', 'image/webp']} onPreviewPlay={onPreviewPlay}
        onChange={references => edit(selected.id, { image: references[0] ? { assetId: references[0].assetId, name: references[0].name } : undefined })}/>
      <div className="video-keyframe-time">
        <label>Time in generated section (s)<input aria-label="Keyframe time in seconds" type="number" min={0} max={(COMFY.maxFrames - 1) / TIMELINE_FPS} step="any"
          value={Number((selected.frame / TIMELINE_FPS).toFixed(3))} onChange={event => setFrame(selected.id, event.currentTarget.valueAsNumber * TIMELINE_FPS)}/></label>
        <label>Frame (from 0)<input aria-label="Keyframe frame" type="number" min={0} max={COMFY.maxFrames - 1} step={1} value={selected.frame}
          onChange={event => setFrame(selected.id, event.currentTarget.valueAsNumber)}/></label>
      </div>
      <input className="video-keyframe-position" type="range" aria-label="Keyframe position" min={0} max={Math.max(0, middleFrames - 1)} step={1} value={Math.min(selected.frame, middleFrames - 1)}
        onChange={event => setFrame(selected.id, event.currentTarget.valueAsNumber)}/>
      <div className="video-keyframe-footer"><label><input type="checkbox" checked={selected.enabled} onChange={event => edit(selected.id, { enabled: event.target.checked })}/>Enabled</label>
        <span className="hint">Full video: {((prefixFrames + selected.frame) / TIMELINE_FPS).toFixed(3)}s</span></div>
      <p className="video-keyframe-error hint" role="status">{selected.enabled && !selected.image ? 'Choose an image before generating.' : selected.frame >= middleFrames ? 'Outside the generated section. Move this keyframe or increase Duration.' : '\u00a0'}</p>
    </div>}
    <p className="hint">Keyframes guide the pose and composition; they do not freeze pixels or add audio. H3 currently supports whole-image guides, without painted masks or individual strength controls.</p>
  </div>;
}
