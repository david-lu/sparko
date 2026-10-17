import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { answerLabel, getScene, interactionFor, type Outcome, type SceneId } from '../call-response/model';
import type { FlowTimeline } from '../timeline/FlowTracks';

const EXIT_MS = 220;
const HOLD_MS = 1000;
type Choice = { id: string; label: string; outcome: Outcome };
type Presentation = {
  sceneId: SceneId; question: string; choices: Choice[]; selectedId: string | null;
  phase: 'choosing' | 'dismissing' | 'holding' | 'exiting' | 'done';
};

export default function PlayerChoices({ value }: { value: FlowTimeline }) {
  const scene = value.session ? getScene(value.flow, value.session.sceneId) : null;
  const idleId = scene?.clip.kind === 'idle' ? scene.id : null;
  const question = idleId ? interactionFor(value.flow, idleId).question : '';
  const questionId = useId();
  const controls = useRef<HTMLDivElement>(null);
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
        return current.choices === choices && current.question === question ? current : { ...current, choices, question };
      }
      return { sceneId: idleId, question, choices, selectedId, phase: selectedId ? 'dismissing' : 'choosing' };
    });
  }, [idleId, outcome, choices, question]);

  const selectedId = presentation?.selectedId;
  const sceneId = presentation?.sceneId;
  const phase = presentation?.phase;
  useLayoutEffect(() => {
    const group = controls.current, button = group?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    if (!group || !button || !selectedId) return;
    // Measure the layout position, excluding hover and entry-animation transforms.
    const center = () => button.style.setProperty('--choice-center-x', `${(group.clientWidth - button.offsetWidth) / 2 - button.offsetLeft + group.scrollLeft}px`);
    center();
    const observer = new ResizeObserver(center);
    observer.observe(group); observer.observe(button);
    group.addEventListener('scroll', center);
    return () => { observer.disconnect(); group.removeEventListener('scroll', center); };
  }, [sceneId, selectedId]);
  useEffect(() => {
    if (!selectedId || !phase || phase === 'choosing' || phase === 'done') return;
    const exitMs = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : EXIT_MS;
    // Start each timer after the previous phase renders, preserving the full confirmation hold.
    const next = phase === 'dismissing' ? 'holding' : phase === 'holding' ? 'exiting' : 'done';
    const timer = setTimeout(() => setPresentation(current => current && { ...current, phase: next }), phase === 'holding' ? HOLD_MS : exitMs);
    return () => clearTimeout(timer);
  }, [selectedId, sceneId, phase]);

  if (!presentation || !presentation.choices.length || presentation.phase === 'done') return null;
  return <div key={presentation.sceneId} ref={controls} className="player-branch-controls" role="group" aria-label="Choose an answer"
    aria-describedby={presentation.question.trim() ? questionId : undefined}
    data-phase={presentation.phase} style={{ '--choice-columns': Math.min(3, presentation.choices.length), '--choice-exit-duration': `${EXIT_MS}ms` } as CSSProperties}
    onDoubleClick={event => event.stopPropagation()}>
    {presentation.question.trim() && <p id={questionId} className="player-branch-question">{presentation.question}</p>}
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
