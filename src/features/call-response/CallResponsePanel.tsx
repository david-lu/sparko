import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, Clapperboard, Plus, Repeat2, Trash2 } from 'lucide-react';
import type { Interstitial } from '../../../shared/interstitials';
import InterstitialEditor, { type InterstitialEditorProps } from '../interstitials/InterstitialEditor';
import { clipTypeLabel, editAnswer, interstitialScenes, type SceneId } from './model';
import type { FlowTimeline } from '../timeline/FlowTracks';
import InterstitialName from '../interstitials/InterstitialName';
import SequenceControls from './SequenceControls';
import { sequenceActive } from './sequence';
import AnswerEditor from './AnswerEditor';
import ContinuityBriefEditor from './ContinuityBriefEditor';
import { ClipStatusBadge, clipStatus } from './ClipStatus';

export default function CallResponsePanel({ value, items, onBack, renderControls, createActions, ...editor }: Omit<InterstitialEditorProps, 'selected'> & {
  value: FlowTimeline; items: Interstitial[]; onBack: () => void; renderControls: (id: SceneId) => ReactNode; createActions?: ReactNode;
}) {
  const members = interstitialScenes(value.flow);
  const panels = useRef<HTMLDivElement>(null);
  const sequence = editor.controller.getSnapshot().sequence;
  useEffect(() => {
    const section = Array.from(panels.current?.children ?? []).find(element => (element as HTMLElement).dataset.sceneId === value.selectedSceneId);
    section?.scrollIntoView({ block: 'nearest' });
  }, [value.selectedSceneId]);
  return <div className="panel-content interstitial-panel call-response-panel" aria-label="Call Response Interstitial panel">
    <button className="text-button interstitial-back" onClick={onBack}><ArrowLeft size={13} /> All interstitials</button>
    {createActions}
    <div className="interstitial-title"><InterstitialName key={value.flow.interstitial.id} name={value.flow.interstitial.label} onChange={value.onRenameInterstitial} />
      <button className="icon-button small" aria-label={`Remove ${value.flow.interstitial.label}`} onClick={() => value.onRemoveInterstitial()}><Trash2 size={14} /></button>
    </div>
    <ContinuityBriefEditor value={value} engine={editor.engine} info={editor.info} status={editor.status} />
    <fieldset className="response-buttons-editor" aria-label="Question and responses" data-project-edit>
      <legend>Question and responses</legend>
      <p className="hint">Shown together on the video while Idle waits for an answer.</p>
      <label className="field">Question<textarea aria-label="Question" rows={2} maxLength={1000} value={value.flow.interaction.question} onChange={event => value.onChange?.({ ...value.flow, interaction: { ...value.flow.interaction, question: event.target.value } })} /></label>
      {value.flow.interaction.answers.map((answer, index) => <AnswerEditor key={answer.id} answer={answer} index={index}
        onChange={patch => value.onChange?.(editAnswer(value.flow, answer.id, patch))} onRemove={() => value.onRemoveAnswer(answer.id)} removable={value.flow.interaction.answers.length > 1} />)}
      <button className="button full-width add-answer" onClick={value.onAddAnswer} disabled={value.flow.interaction.answers.length >= 100}><Plus size={14} /> Add answer</button>
      <label className="field">Unmatched answer<select aria-label="Unmatched answer" value={value.flow.interaction.fallbackAnswerId ?? ''} onChange={event => value.onChange?.({ ...value.flow, interaction: { ...value.flow.interaction, fallbackAnswerId: event.target.value || null } })}>
        <option value="">Keep waiting</option>{value.flow.interaction.answers.map(answer => <option key={answer.id} value={answer.id}>{answer.label}</option>)}
      </select></label>
    </fieldset>
    <p className="hint">Call → Idle → Responses → Parent video. Idle repeats silently; only its entry and exit crossfade. Each clip appears on the timeline when it finishes generating.</p>
    <label className="interstitial-option" data-project-edit><input type="checkbox" checked={value.flow.interstitial.linkResponseDurations !== false} onChange={event => value.onChange?.({ ...value.flow, interstitial: { ...value.flow.interstitial, linkResponseDurations: event.target.checked } })} /> Link response durations</label>
    <SequenceControls {...editor} flow={value.flow} items={items} />
    <div className="call-response-subpanels" ref={panels}>
      {members.map(scene => {
        const item = items.find(item => item.id === scene.interstitialId), selected = value.selectedSceneId === scene.id;
        const dependency = item && editor.controller.dependency(item.id);
        const label = clipTypeLabel(scene.clip, value.flow);
        const waiting = sequenceActive(sequence) && item && sequence!.ids.includes(item.id) && !sequence!.completedIds.includes(item.id) && sequence!.activeId !== item.id;
        const status = clipStatus(item, { waiting: !!waiting, stale: !!dependency?.stale });
        return <section className={`clip-subpanel ${selected ? 'selected' : ''}`} key={scene.clip.id} aria-label={`${label} clip`} data-scene-id={scene.id} data-stale={!!dependency?.stale} data-status={status.kind}>
          <button className="clip-subpanel-heading" aria-pressed={selected}
            onClick={() => value.onSelectScene(scene.id)}>
            {scene.clip.kind === 'idle' ? <Repeat2 size={14} /> : <Clapperboard size={14} />}
            <span className="clip-subpanel-label"><strong title={label}>{label}</strong><small title={status.detail}>{status.detail}</small></span>
            <ClipStatusBadge status={status} />
          </button>
          <div className="clip-subpanel-body" id={`clip-panel-${scene.id}`}>
            {renderControls(scene.id)}
            {item ? <InterstitialEditor {...editor} selected={item} /> : <p className="hint">This source clip has no generation settings.</p>}
          </div>
        </section>;
      })}
    </div>
  </div>;
}
