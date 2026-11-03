import { useId, useState } from 'react';
import { formatTime, type Slice } from '../../../shared/contracts';
import { previewLabels, previewSegmentAt, type PreviewSegment } from './previewSegments';
import './preview.css';

export default function PreviewTimeline({ segments, time, duration, buffered, variable, onSeek }: {
  segments: PreviewSegment[]; time: number; duration: number; buffered: Slice[]; variable: boolean; onSeek: (time: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const descriptionId = useId();
  const percent = (value: number) => duration ? Math.max(0, Math.min(100, value / duration * 100)) : 0;
  const active = previewSegmentAt(segments, hover ?? time);
  const types = (['scene', 'loop', 'choice'] as const).filter(kind => segments.some(segment => segment.kind === kind));
  return <div className="preview-timeline">
    <div className="preview-timeline-info">
      <span className="preview-chapter" title={active?.label}>{hover !== null && <span>{formatTime(hover)} · </span>}{active?.label || 'Preview'}{active?.draft ? ' · Not generated yet' : ''}</span>
      <span className="preview-legend" aria-label="Timeline colors">{types.map(kind => <span key={kind}><i className={`preview-color ${kind}`} />{previewLabels[kind]}</span>)}</span>
    </div>
    <div className="preview-scrubber" onPointerLeave={() => setHover(null)} onPointerMove={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      setHover(Math.max(0, Math.min(duration, (event.clientX - rect.left) / rect.width * duration)));
    }}>
      <div className="preview-track" aria-hidden="true">
        {buffered.map((range, index) => <span key={index} className="preview-buffered" style={{ left: `${percent(range.start)}%`, width: `${percent(range.end) - percent(range.start)}%` }} />)}
        <span className="preview-progress" style={{ width: `${percent(time)}%` }} />
        {segments.filter(segment => segment.kind !== 'source').map(segment => <span key={segment.id}
          className={`preview-marker preview-color ${segment.kind}${segment.draft ? ' draft' : ''}`} data-scene-id={segment.sceneId}
          title={`${segment.label} · ${previewLabels[segment.kind]} · ${formatTime(segment.start)}–${formatTime(segment.end)}`}
          style={{ left: `${percent(segment.start)}%`, width: `${percent(segment.end) - percent(segment.start)}%` }} />)}
      </div>
      <input type="range" className="preview-seek" aria-label="Seek video" aria-describedby={descriptionId}
        aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}${previewSegmentAt(segments, time)?.label ? ` · ${previewSegmentAt(segments, time)!.label}` : ''}`}
        min={0} max={duration || 1} step="any" value={Math.min(time, duration)} disabled={!duration}
        onChange={event => onSeek(Number(event.target.value))} onKeyDown={event => {
          const target = event.key === 'Home' ? 0 : event.key === 'End' ? duration
            : ['ArrowRight', 'ArrowUp'].includes(event.key) ? time + 5 : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? time - 5 : null;
          if (target === null) return;
          event.preventDefault(); event.stopPropagation(); onSeek(Math.max(0, Math.min(duration, target)));
        }} />
    </div>
    <span className="sr-only" id={descriptionId}>{variable ? 'Timeline shows one pass through the current path. Choices and loops can change the running time. ' : ''}Use the arrow keys to seek five seconds, Home to start, or End to finish.</span>
  </div>;
}
