import type { TimelineComposition } from '../../media/TimelineComposition';
import { compositionTransitions } from '../../media/CompositionTransitions';
import './crossfades.css';

export default function CrossfadeMarks({ composition, width }: { composition: TimelineComposition; width: number }) {
  if (!composition.crossfade || !composition.duration) return null;
  return <div className="timeline-crossfades">{compositionTransitions(composition.segments, composition.crossfadeFrames, composition.fps).map(transition => {
    const frames = transition.endFrame - transition.startFrame;
    const label = `Crossfade: ${transition.before.label} to ${transition.after.label}, ${frames} frames (${(frames / composition.fps).toFixed(2)} s)`;
    return <span className="timeline-crossfade" key={`${transition.before.id}:${transition.after.id}`} role="img" aria-label={label} title={label}
      style={{ left: `${(transition.startFrame + frames / 2) / composition.fps / composition.duration * 100}%`, width: frames / composition.fps / composition.duration * width }}>
      <svg viewBox="0 0 20 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0L20 60H0Z" /><path d="M20 0L0 60H20Z" /><path className="crossfade-lines" d="M0 0L20 60M20 0L0 60" /></svg>
    </span>;
  })}</div>;
}
