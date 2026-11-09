import { Trash2 } from 'lucide-react';
import { TIMELINE_FPS } from '../../../shared/constants';
import type { TimelineVideo } from '../../../shared/video-references';
import type { ProjectController } from '../project/ProjectController';
import AssetInput from '../project/AssetInput';

export default function TimelineVideoProperties({ value, prefixFrames, middleFrames, projects, onChange, onDelete, onPreviewPlay }: {
  value: TimelineVideo; prefixFrames: number; middleFrames: number; projects: ProjectController;
  onChange: (patch: Partial<TimelineVideo>) => void; onDelete: () => void; onPreviewPlay: () => void;
}) {
  const video = value.video;
  return <div className="timeline-video-properties">
    <AssetInput projects={projects} kinds={['video']} multiple={false} label="Timeline video" value={video ? [{ ...video, kind: 'video' }] : []} onPreviewPlay={onPreviewPlay}
      onChange={values => {
        const ref = values[0], asset = projects.getSnapshot().project?.library?.find(asset => asset.assetId === ref?.assetId);
        onChange({ video: ref ? { assetId: ref.assetId, name: ref.name, inFrame: 0, outFrame: Math.min(middleFrames - value.frame, Math.max(1, Math.floor((asset?.duration ?? 1) * TIMELINE_FPS))) } : undefined });
      }}/>
    <div className="generation-property-fields">
      <label>Time (s)<input type="number" aria-label="Video timeline time" min={prefixFrames / TIMELINE_FPS} step={1 / TIMELINE_FPS} value={(prefixFrames + value.frame) / TIMELINE_FPS} onChange={event => {
        const frame = Math.round(event.currentTarget.valueAsNumber * TIMELINE_FPS) - prefixFrames;
        if (Number.isFinite(frame)) onChange({ frame: Math.max(0, Math.min(middleFrames - 1, frame)) });
      }}/></label>
      {video && (['inFrame', 'outFrame'] as const).map(field => <label key={field}>{field === 'inFrame' ? 'Source in (s)' : 'Source out (s)'}<input aria-label={field === 'inFrame' ? 'Video source in' : 'Video source out'} type="number" min={0} step={1 / TIMELINE_FPS} value={video[field] / TIMELINE_FPS} onChange={event => {
        const frame = Math.round(event.currentTarget.valueAsNumber * TIMELINE_FPS);
        const asset = projects.getSnapshot().project?.library?.find(asset => asset.assetId === video.assetId);
        if (Number.isFinite(frame)) onChange({ video: { ...video, [field]: field === 'inFrame' ? Math.max(0, Math.min(video.outFrame - 1, frame)) : Math.max(video.inFrame + 1, Math.min(Math.floor((asset?.duration ?? frame / TIMELINE_FPS) * TIMELINE_FPS), frame)) } });
      }}/></label>)}
    </div>
    <div className="generation-property-actions"><label><input type="checkbox" checked={value.enabled} onChange={event => onChange({ enabled: event.target.checked })}/>Enabled</label>
      <button type="button" className="text-button" onClick={onDelete}><Trash2 size={14}/>Delete video</button></div>
  </div>;
}
