import './styles.css';
import { useRef, type ReactNode } from 'react';
import { ArrowLeft, Clapperboard, Repeat2, Sparkles, Trash2 } from 'lucide-react';
import { formatTime, type AppStatus } from '../../../shared/contracts';
import { isGenerating, playableResult, type Interstitial } from '../../../shared/interstitials';
import type { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import type { InterstitialController } from './InterstitialController';
import { assets } from '../project/assets';
import { phaseLabel } from './status';
import InterstitialEditor from './InterstitialEditor';
import { clipTypeLabel, interstitialScenes, type SceneId } from '../call-response/model';
import type { FlowTimeline } from '../timeline/FlowTracks';
import CallResponsePanel from '../call-response/CallResponsePanel';
import InterstitialName from './InterstitialName';

function RemoveInterstitialButton({ item, controller, disabled = false }: { item: Interstitial; controller: InterstitialController; disabled?: boolean }) {
  const handledTouch = useRef(false);
  return <button className="icon-button small" aria-label={`Remove ${item.label}`} disabled={disabled} title={disabled ? 'This interstitial is used by a connected timeline clip.' : undefined}
    onPointerDown={() => { handledTouch.current = false; }}
    onPointerUp={event => {
      if (disabled) return;
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
      // A tap immediately after a captured timeline drag may have no synthesized click.
      handledTouch.current = true; event.preventDefault(); void controller.remove(item.id);
    }} onClick={event => {
      if (handledTouch.current && event.detail !== 0) { handledTouch.current = false; return; }
      handledTouch.current = false; void controller.remove(item.id);
    }}><Trash2 size={14} /></button>;
}

export default function InterstitialPanel({ items, selectedId, controller, engine, info, status, active, onAdd, onSelect, onPreviewPlay, connectedIds = [], callResponse, renderClipControls }: {
  items: Interstitial[]; selectedId: string | null; controller: InterstitialController; engine: MediaEngine | null; info: MediaInfo | null; status: AppStatus | null;
  active: boolean; onAdd: () => void; onSelect: (id: string | null) => void; onPreviewPlay: () => void;
  connectedIds?: string[];
  callResponse?: FlowTimeline;
  renderClipControls?: (id: SceneId) => ReactNode;
}) {
  const selected = items.find(item => item.id === selectedId);
  const members = callResponse ? interstitialScenes(callResponse.flow) : [];
  const childIds = new Set(callResponse?.flow.scenes.flatMap(scene => scene.interstitialId ? [scene.interstitialId] : []));
  const standaloneItems = items.filter(item => !childIds.has(item.id));
  const groupReady = members.length > 0 && members.every(scene => !!assets.url(scene.clip.assetId));
  if (callResponse && renderClipControls && (callResponse.selectedInterstitial || members.some(scene => scene.interstitialId === selectedId || scene.id === callResponse.selectedSceneId))) {
    return <CallResponsePanel value={callResponse} items={items} onBack={() => onSelect(null)} renderControls={renderClipControls}
      controller={controller} engine={engine} info={info} status={status} active={active} onPreviewPlay={onPreviewPlay} />;
  }
  if (!selected) return <div className="panel-content interstitial-panel">
    <div className="panel-intro"><h2>Interstitials</h2></div>
    <button className="button full-width" disabled={!info || connectedIds.length > 0} onClick={onAdd}><Sparkles size={14} /> New interstitial at playhead</button>
    {!items.length && !callResponse ? <div className="empty-state"><h3>No interstitials yet</h3><p>Press <kbd>P</kbd> to add an interstitial at the playhead.</p></div> : <ol className="interstitial-list">
      {callResponse && <li className="interstitial-group" data-interstitial-id={callResponse.flow.interstitial.id}>
        <div className="interstitial-group-title">
          <button className={`interstitial-row interstitial-group-heading ${groupReady ? 'ready' : ''}`} disabled={!members.length}
            aria-label={`Select ${callResponse.flow.interstitial.label}`} onClick={callResponse.onSelectInterstitial}>
            <span className="interstitial-number">1</span><span className="interstitial-row-content"><strong>{callResponse.flow.interstitial.label}</strong><span>{formatTime(callResponse.flow.interstitial.time, true)} · {members.length} clips</span></span>
            <span className="status-icon">{groupReady && <Clapperboard size={14} />}</span>
          </button>
          <button className="icon-button small" aria-label={`Remove ${callResponse.flow.interstitial.label}`} onClick={callResponse.onRemoveInterstitial}><Trash2 size={14} /></button>
        </div>
        <ol className="interstitial-clips" aria-label={`Clips in ${callResponse.flow.interstitial.label}`}>
          {members.map(scene => {
            const item = items.find(item => item.id === scene.interstitialId);
            return <li key={scene.clip.id}><button className="interstitial-row" aria-label={`Select ${clipTypeLabel(scene.clip, callResponse.flow)} clip`} onClick={() => callResponse.onSelectScene(scene.id)}>
              {scene.clip.kind === 'idle' ? <Repeat2 size={14} /> : <Clapperboard size={14} />}
              <span className="interstitial-row-content"><strong>{clipTypeLabel(scene.clip, callResponse.flow)}</strong><span>{scene.label}</span></span>
              <span className="status-icon">{item && isGenerating(item) && <span className="spinner" />}</span>
            </button></li>;
          })}
        </ol>
      </li>}
      {standaloneItems.map((item, i) => <li key={item.id}>
      <button className={`interstitial-row ${playableResult(item) ? 'ready' : ''}`} onClick={() => onSelect(item.id)} aria-label={`Select ${item.label}`}>
        <span className="interstitial-number">{i + 1 + (callResponse ? 1 : 0)}</span><span className="interstitial-row-content"><strong title={item.label}>{item.label}</strong><span title={`${formatTime(item.time, true)} · ${phaseLabel(item)}`}>{formatTime(item.time, true)} · {phaseLabel(item)}</span></span>
        <span className="status-icon">{isGenerating(item) ? <span className="spinner" /> : playableResult(item) ? <Clapperboard size={14} /> : null}</span>
      </button><RemoveInterstitialButton item={item} controller={controller} disabled={connectedIds.includes(item.id)} />
    </li>)}</ol>}
  </div>;
  return <div className="panel-content interstitial-panel">
    <button className="text-button interstitial-back" onClick={() => onSelect(null)}><ArrowLeft size={13} /> All interstitials</button>
    <div className="interstitial-title">
      <InterstitialName key={selected.id} name={selected.label} onChange={name => controller.rename(selected.id, name)} />
      {selected.phase === 'draft' && <span className="interstitial-draft">Draft</span>}
      <RemoveInterstitialButton item={selected} controller={controller} disabled={connectedIds.includes(selected.id)} />
    </div>
    <InterstitialEditor selected={selected} controller={controller} engine={engine} info={info} status={status} active={active} onPreviewPlay={onPreviewPlay} />
  </div>;
}
