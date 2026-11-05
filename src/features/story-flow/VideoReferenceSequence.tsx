import { ArrowDown, ArrowUp } from 'lucide-react';
import { TIMELINE_FPS } from '../../../shared/constants';
import type { VideoAssetReference } from '../../../shared/video-references';
import { DEFAULT_IMAGE_DURATION } from '../../media/stillImage';
import AssetInput from '../project/AssetInput';
import type { ProjectController } from '../project/ProjectController';

export default function VideoReferenceSequence({ projects, label, clips, onChange }: {
  projects: ProjectController; label: string; clips: VideoAssetReference[]; onChange: (clips: VideoAssetReference[]) => void;
}) {
  const library = projects.getSnapshot().project?.library ?? [];
  const update = (index: number, patch: Partial<VideoAssetReference>) => onChange(clips.map((clip, i) => i === index ? { ...clip, ...patch } : clip));
  const move = (index: number, direction: number) => {
    const next = [...clips]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; onChange(next);
  };
  return <>
    <AssetInput projects={projects} label={`${label} video`} kinds={['video', 'image']} value={clips.map(clip => ({ assetId: clip.assetId, name: clip.name, kind: clip.kind ?? 'video' }))} onChange={refs => onChange(refs.map(ref => {
      const existing = clips.find(clip => clip.assetId === ref.assetId), media = library.find(asset => asset.assetId === ref.assetId)
        ?? projects.getSnapshot().project?.library?.find(asset => asset.assetId === ref.assetId);
      return existing ?? { assetId: ref.assetId, name: ref.name, ...(ref.kind === 'image' ? { kind: 'image' as const } : {}),
        inFrame: media?.inFrame ?? 0, outFrame: media?.outFrame ?? Math.max(1, Math.floor((media?.duration ?? DEFAULT_IMAGE_DURATION) * TIMELINE_FPS)) };
    }))}/>
    {clips.length > 1 && <p className="hint">Playback order below. Start uses the end of this sequence; End uses the beginning.</p>}
    {clips.map((clip, index) => <div className="reference-sequence-clip" key={clip.assetId}>
      {clips.length > 1 && <div className="inspector-reference-heading"><span title={clip.name}>{index + 1}. {clip.name}</span><div>
        <button type="button" className="icon-button small" aria-label={`Move ${clip.name} earlier`} disabled={!index} onClick={() => move(index, -1)}><ArrowUp size={12}/></button>
        <button type="button" className="icon-button small" aria-label={`Move ${clip.name} later`} disabled={index === clips.length - 1} onClick={() => move(index, 1)}><ArrowDown size={12}/></button>
      </div></div>}
      {clip.kind === 'image' ? <label className="inspector-property"><span>Image duration (s)</span><input type="number" min={1 / TIMELINE_FPS} step={1 / TIMELINE_FPS} aria-label={`${label} ${clip.name} duration`} value={(clip.outFrame - clip.inFrame) / TIMELINE_FPS} onChange={e => {
        const frames = Math.round(e.target.valueAsNumber * TIMELINE_FPS);
        if (Number.isSafeInteger(frames) && frames > 0) update(index, { outFrame: clip.inFrame + frames });
      }}/></label> : <div className="range-fields">{(['inFrame', 'outFrame'] as const).map(field => <label className="inspector-property" key={field}><span>{field === 'inFrame' ? 'In (s)' : 'Out (s)'}</span><input
        aria-label={`${label} video ${clips.length > 1 ? `${index + 1} ` : ''}${field === 'inFrame' ? 'in' : 'out'}`} type="number" min={0} step={1 / TIMELINE_FPS} value={clip[field] / TIMELINE_FPS} onChange={e => {
          const frame = Math.round(e.target.valueAsNumber * TIMELINE_FPS), media = library.find(asset => asset.assetId === clip.assetId);
          if (Number.isFinite(frame)) update(index, { [field]: field === 'inFrame' ? Math.max(0, Math.min(clip.outFrame - 1, frame))
            : Math.max(clip.inFrame + 1, Math.min(Math.floor((media?.duration ?? clip.outFrame / TIMELINE_FPS) * TIMELINE_FPS), frame)) });
        }}/></label>)}</div>}
    </div>)}
  </>;
}
