import { Clapperboard, Play, X } from 'lucide-react';
import type { InterstitialEditorProps } from '../interstitials/InterstitialEditor';
import { generationProvider, hasUnsubmittedChanges, isGenerating, type Interstitial } from '../../../shared/interstitials';
import { clipTypeLabel, type CallResponseFlow } from './model';
import { generationOrder, sequenceActive } from './sequence';

export default function SequenceControls({ flow, items, controller, engine, info, status }: Pick<InterstitialEditorProps, 'controller' | 'engine' | 'info' | 'status'> & {
  flow: CallResponseFlow; items: Interstitial[];
}) {
  const globalSequence = controller.getSnapshot().sequence, ids = generationOrder(flow);
  const sequence = globalSequence?.ids.join('|') === ids.join('|') ? globalSequence : null;
  const running = sequenceActive(sequence);
  const clips = ids.flatMap(id => items.find(item => item.id === id) ?? []);
  const busy = clips.some(isGenerating);
  const missingPrompt = clips.find(item => !item.prompt.trim());
  const disconnected = clips.find(item => !status?.providers[generationProvider(item.method)]);
  const disabled = !engine || !info || !clips.length || busy || sequenceActive(globalSequence) || !!missingPrompt || !!disconnected;
  const canContinue = sequence && ['cancelled', 'error'].includes(sequence.phase) && sequence.ids.join('|') === ids.join('|');
  const activeScene = flow.scenes.find(scene => scene.interstitialId === sequence?.activeId);
  const activeLabel = activeScene ? clipTypeLabel(activeScene.clip, flow) : '';
  const message = sequence?.phase === 'cancelling' ? 'Cancelling the active clip and stopping the sequence…'
    : running ? `${sequence!.completedIds.length} of ${sequence!.ids.length} complete${activeLabel ? ` · Generating ${activeLabel}` : ''}`
    : sequence?.phase === 'ready' ? `All ${sequence.ids.length} clips generated.${clips.some(hasUnsubmittedChanges) ? ' Some clips have newer edits.' : ''}`
    : sequence?.message ?? (sequence?.phase === 'cancelled' ? `Sequence cancelled · ${sequence.completedIds.length} of ${sequence.ids.length} complete` : 'Call → Idle → each response, one clip at a time.');
  const generate = (remaining = false) => { if (engine && info) void controller.generateAll(engine, info, status?.providers, remaining, flow.interstitial.id); };
  return <div className="sequence-controls" aria-label="Sequence generation">
    <div className="sequence-actions">
      <button className="button primary full-width" disabled={disabled} onClick={() => generate()}><Clapperboard size={14} /> Generate all sequentially</button>
      {canContinue && <button className="button full-width" disabled={disabled} onClick={() => generate(true)}><Play size={14} /> Continue sequence</button>}
      {running && <button className="button full-width" disabled={sequence?.phase === 'cancelling'} onClick={() => void controller.cancelSequence()}><X size={14} /> Cancel sequence</button>}
    </div>
    <p className={sequence?.phase === 'error' ? 'inline-error' : 'hint'} role={sequence?.phase === 'error' ? 'alert' : 'status'}>{message}</p>
    <p className="hint">Edit any clip at any time. Waiting clips use your latest edits; running clips keep their submitted settings.</p>
    {!running && missingPrompt && <p className="hint">Add a prompt for {missingPrompt.label} to generate the whole sequence.</p>}
    {!running && disconnected && status && <p className="hint">Connect {generationProvider(disconnected.method) === 'comfy' ? 'Comfy Cloud' : 'fal.ai'} to generate {disconnected.label}.</p>}
    {!running && busy && <p className="hint">Finish or cancel the current clip generation before starting the sequence.</p>}
  </div>;
}
