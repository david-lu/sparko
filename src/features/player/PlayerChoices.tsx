import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { answerLabel, getScene, type Outcome, type SceneId } from '../call-response/model';
import type { FlowTimeline } from '../timeline/FlowTracks';

const EXIT_MS = 220;
const HOLD_MS = 1000;
type Choice = { id: string; label: string; outcome: Outcome };
type Presentation = {
  sceneId: SceneId; choices: Choice[]; selectedId: string | null;
  phase: 'choosing' | 'dismissing' | 'holding' | 'exiting' | 'done';
};

export default function PlayerChoices({ value }: { value: FlowTimeline }) {
  const scene = value.session ? getScene(value.flow, value.session.sceneId) : null;
  const idleId = scene?.clip.kind === 'idle' ? scene.id : null;
  const outcome = value.session?.outcome;
  const choices = useMemo(() => value.flow.edges
    .filter(edge => edge.from === idleId && value.flow.interaction.answers.some(answer => answer.id === edge.when))
    .map(edge => ({ id: edge.id, outcome: edge.when, label: answerLabel(value.flow, edge.when) })), [value.flow, idleId]);
  const [presentation, setPresentation] = useState<Presentation | null>(null);

  useEffect(() => {
    setPresentation(current => {
      // A response can start before the confirmation animation finishes.
      if (!idleId) return current?.selectedId ? current : null;
      const selectedId = choices.find(choice => choice.outcome === outcome)?.id ?? null;
      if (current?.sceneId === idleId && current.selectedId === selectedId) {
        return current.choices === choices ? current : { ...current, choices };
      }
      return { sceneId: idleId, choices, selectedId, phase: selectedId ? 'dismissing' : 'choosing' };
    });
  }, [idleId, outcome, choices]);

  const selectedId = presentation?.selectedId;
  const sceneId = presentation?.sceneId;
  useEffect(() => {
    if (!selectedId) return;
    const exitMs = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : EXIT_MS;
    const advance = (phase: Presentation['phase']) => setPresentation(current => current && { ...current, phase });
    const timers = [
      setTimeout(() => advance('holding'), exitMs),
      setTimeout(() => advance('exiting'), exitMs + HOLD_MS),
      setTimeout(() => advance('done'), exitMs * 2 + HOLD_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [selectedId, sceneId]);

  if (!presentation || !presentation.choices.length || presentation.phase === 'done') return null;
  return <div key={presentation.sceneId} className="player-branch-controls" role="group" aria-label="Choose an answer"
    data-phase={presentation.phase} style={{ '--choice-columns': Math.min(3, presentation.choices.length), '--choice-exit-duration': `${EXIT_MS}ms` } as CSSProperties}
    onDoubleClick={event => event.stopPropagation()}>
    {presentation.choices.map((choice, index) => <button key={choice.id}
      style={{ animationDelay: selectedId ? '0ms' : `${Math.min(index, 6) * 100}ms` }}
      aria-label={`Choose ${choice.label}`} aria-pressed={selectedId === choice.id} aria-disabled={!!selectedId}
      tabIndex={selectedId && selectedId !== choice.id ? -1 : undefined}
      onClick={() => {
        if (selectedId) return;
        setPresentation({ ...presentation, selectedId: choice.id, phase: 'dismissing' });
        value.onBranch(presentation.sceneId, choice.outcome);
      }} onKeyDown={event => { if (event.key === ' ') event.stopPropagation(); }}>
      <span className="player-branch-label">{choice.label}</span>
    </button>)}
  </div>;
}
