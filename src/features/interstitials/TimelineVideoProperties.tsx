import { Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { TIMELINE_FPS } from '../../../shared/constants';
import type { TimelineVideo } from '../../../shared/video-references';
import type { ProjectController } from '../project/ProjectController';
import AssetInput from '../project/AssetInput';
import { timelineSeconds } from './generation-timeline';
import { VolumeRow } from './GenerationAudioTracks';
import { audioLevel } from '../../../shared/audio-tracks';

export default function TimelineVideoProperties({ value, prefixFrames, middleFrames, projects, onChange, onVolume, onDelete, onPreviewPlay }: {
  value: TimelineVideo; prefixFrames: number; middleFrames: number; projects: ProjectController;
  onChange: (patch: Partial<TimelineVideo>) => void; onVolume: (volume: number) => void; onDelete: () => void; onPreviewPlay: () => void;
}) {
  const video = value.video;
  const current = useRef({ value, middleFrames, onChange }); current.current = { value, middleFrames, onChange };
  const clipFrames = video ? video.outFrame - video.inFrame : 1;
  const maxFrame = Math.max(0, middleFrames - clipFrames);
  const sourceFrames = video ? Math.max(video.outFrame, Math.floor((projects.getSnapshot().project?.library?.find(asset => asset.assetId === video.assetId)?.duration ?? 0) * TIMELINE_FPS)) : 1;
  return <div className="timeline-video-properties">
    <AssetInput projects={projects} kinds={['video']} multiple={false} label="Timeline video" value={video ? [{ ...video, kind: 'video' }] : []} onPreviewPlay={onPreviewPlay}
      onChange={values => {
        const ref = values[0], asset = projects.getSnapshot().project?.library?.find(asset => asset.assetId === ref?.assetId);
        // An upload can finish after the user changes this clip's timing or toggles.
        const { value, middleFrames, onChange } = current.current;
        const frame = Math.max(0, Math.min(middleFrames - 1, value.frame));
        onChange({ frame, video: ref ? { assetId: ref.assetId, name: ref.name, inFrame: 0, outFrame: Math.min(middleFrames - frame, Math.max(1, Math.floor((asset?.duration ?? 1) * TIMELINE_FPS))) } : undefined });
      }}/>
    <div className="generation-property-fields">
      <label>Time (s)<input type="number" aria-label="Video timeline time" min={timelineSeconds(prefixFrames)} max={timelineSeconds(prefixFrames + maxFrame)} step={1 / TIMELINE_FPS} value={timelineSeconds(prefixFrames + value.frame)} onChange={event => {
        const frame = Math.round(event.currentTarget.valueAsNumber * TIMELINE_FPS) - prefixFrames;
        if (Number.isFinite(frame)) onChange({ frame: Math.max(0, Math.min(maxFrame, frame)) });
      }}/></label>
      {video && (['inFrame', 'outFrame'] as const).map(field => <label key={field}>{field === 'inFrame' ? 'Source in (s)' : 'Source out (s)'}<input aria-label={field === 'inFrame' ? 'Video source in' : 'Video source out'} type="number" min={field === 'inFrame' ? Math.max(0, video.outFrame - Math.max(1, middleFrames - value.frame)) / TIMELINE_FPS : (video.inFrame + 1) / TIMELINE_FPS} max={field === 'inFrame' ? (video.outFrame - 1) / TIMELINE_FPS : Math.min(sourceFrames, video.inFrame + Math.max(1, middleFrames - value.frame)) / TIMELINE_FPS} step={1 / TIMELINE_FPS} value={timelineSeconds(video[field])} onChange={event => {
        const frame = Math.round(event.currentTarget.valueAsNumber * TIMELINE_FPS);
        const available = Math.max(1, middleFrames - value.frame);
        if (Number.isFinite(frame)) onChange({ video: { ...video, [field]: field === 'inFrame' ? Math.max(0, video.outFrame - available, Math.min(video.outFrame - 1, frame)) : Math.max(video.inFrame + 1, Math.min(sourceFrames, video.inFrame + available, frame)) } });
      }}/></label>)}
    </div>
    {video && <VolumeRow label="Video audio" volume={audioLevel(value.volume)} onBoundary={() => projects.endHistoryGroup()} onChange={onVolume}/>}
    <div className="generation-property-actions"><label><input type="checkbox" checked={value.enabled} onChange={event => onChange({ enabled: event.target.checked })}/>Enabled</label>
      <button type="button" className="text-button" onClick={onDelete}><Trash2 size={14}/>Delete video</button></div>
  </div>;
}
