import type { ReactNode } from 'react';
import { ArrowLeft, ChevronDown, Clapperboard, Plus, Repeat2, Trash2 } from 'lucide-react';
import { isGenerating, type Interstitial } from '../../../shared/interstitials';
import InterstitialEditor, { type InterstitialEditorProps } from '../interstitials/InterstitialEditor';
import { phaseLabel } from '../interstitials/status';
import { clipTypeLabel, interstitialScenes, type SceneId } from './model';
import type { FlowTimeline } from '../timeline/FlowTracks';
import InterstitialName from '../interstitials/InterstitialName';

export default function CallResponsePanel({ value, items, onBack, renderControls, ...editor }: Omit<InterstitialEditorProps, 'selected'> & {
  value: FlowTimeline; items: Interstitial[]; onBack: () => void; renderControls: (id: SceneId) => ReactNode;
}) {
  const members = interstitialScenes(value.flow);
  return <div className="panel-content interstitial-panel call-response-panel" aria-label="Call Response Interstitial panel">
    <button className="text-button interstitial-back" onClick={onBack}><ArrowLeft size={13} /> All interstitials</button>
    <div className="interstitial-title"><InterstitialName key={value.flow.interstitial.id} name={value.flow.interstitial.label} onChange={value.onRenameInterstitial} />
      <button className="icon-button small" aria-label={`Remove ${value.flow.interstitial.label}`} onClick={value.onRemoveInterstitial}><Trash2 size={14} /></button>
    </div>
    <div className="call-response-subpanels">
      {members.map(scene => {
        const item = items.find(item => item.id === scene.interstitialId), open = value.selectedSceneId === scene.id;
        const dependency = item && editor.controller.dependency(item.id);
        const label = clipTypeLabel(scene.clip, value.flow);
        return <section className={`clip-subpanel ${open ? 'selected' : ''}`} key={scene.clip.id} aria-label={`${label} clip`}>
          <button className="clip-subpanel-heading" aria-expanded={open} aria-controls={`clip-panel-${scene.id}`}
            onClick={() => open ? value.onSelectInterstitial() : value.onSelectScene(scene.id)}>
            {scene.clip.kind === 'idle' ? <Repeat2 size={14} /> : <Clapperboard size={14} />}
            <span><strong>{label}</strong><small>{item && isGenerating(item) ? phaseLabel(item) : dependency?.stale ? 'Needs regeneration' : item ? phaseLabel(item) : scene.label}</small></span>
            {item && isGenerating(item) ? <span className="spinner" /> : <ChevronDown size={14} />}
          </button>
          {open && <div className="clip-subpanel-body" id={`clip-panel-${scene.id}`}>
            {renderControls(scene.id)}
            {item ? <InterstitialEditor {...editor} selected={item} /> : <p className="hint">This source clip has no generation settings.</p>}
          </div>}
        </section>;
      })}
    </div>
    <button className="button full-width add-answer" onClick={value.onAddAnswer} disabled={value.flow.interaction.answers.length >= 100}><Plus size={14} /> Add answer</button>
  </div>;
}
