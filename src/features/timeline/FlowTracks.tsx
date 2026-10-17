import type { CSSProperties } from 'react';
import { ArrowRight, Repeat2, RotateCcw } from 'lucide-react';
import { formatTime } from '../../../shared/contracts';
import { assets } from '../project/assets';
import { answerLabel, branchScenes, clipTypeLabel, flowLayout, getScene, interstitialScenes, sceneFrames, type CallResponseFlow, type Outcome, type PlaybackSession, type SceneId, type TimelineScene } from '../call-response/model';
import VideoFilmstrip from './VideoFilmstrip';
import './flow.css';
import { isGenerating, type Interstitial } from '../../../shared/interstitials';
import { phaseLabel } from '../interstitials/status';
import ClipLoading, { ClipJobStatus } from '../../shared/ClipLoading';

export type FlowTimeline = {
  flow: CallResponseFlow;
  session: PlaybackSession | null;
  selectedSceneId: SceneId | null;
  selectedEdgeId: string | null;
  selectedInterstitial: boolean;
  staleClipIds?: ReadonlySet<string>;
  onSelectInterstitial: (id?: string) => void;
  onRemoveInterstitial: (id?: string) => void;
  onRenameInterstitial: (name: string) => void;
  onAddAnswer: () => void;
  onRemoveAnswer: (id: string) => void;
  onSelectScene: (id: SceneId, frame?: number) => void;
  onSelectEdge: (id: string) => void;
  onBranch: (id: SceneId, outcome: Outcome) => void;
  groups?: FlowTimeline[];
  onTypeChange?: (kind: 'regular' | 'call-response') => void;
  onChange?: (flow: CallResponseFlow) => void;
};
export default function FlowTracks({ value, width, items = [] }: { value: FlowTimeline; width: number; items?: Interstitial[] }) {
  const { flow, session } = value, layout = flowLayout(flow), unit = width / layout.totalFrames;
  const groups = flow.groups ?? [flow];
  const rows = Math.max(1, ...groups.map(group => branchScenes(group).length));
  const box = (id: SceneId) => ({ x: layout.starts[id] * unit, width: sceneFrames(getScene(flow, id)) * unit });
  const renderClip = (scene: TimelineScene, offset = 0) => {
      const bounds = box(scene.id), active = session?.sceneId === scene.id, idle = scene.clip.kind === 'idle';
      const url = assets.url(scene.clip.assetId);
      const item = items.find(item => item.id === scene.interstitialId);
      const busy = item && isGenerating(item);
      const stale = !!scene.interstitialId && !!value.staleClipIds?.has(scene.interstitialId);
      const row = branchScenes(groups.find(group => group.scenes.some(member => member.id === scene.id)) ?? flow).findIndex(branch => branch.id === scene.id);
      const outputs = flow.edges.filter(edge => edge.from === scene.id && edge.when !== 'pending');
      return <div key={scene.id} className={`timeline-flow-clip clip-${scene.clip.kind} ${value.selectedSceneId === scene.id ? 'selected' : ''} ${active ? 'active' : ''} ${scene.draft ? 'draft' : ''} ${stale ? 'stale' : ''}`}
        style={{ left: bounds.x - offset, width: bounds.width, top: row < 0 ? undefined : `calc(50% + var(--timeline-clip-height) * ${row - rows / 2})` }} data-scene-id={scene.id} data-clip-kind={scene.clip.kind} data-active={active} data-stale={stale}>
        <button className={`flow-clip-body ${value.selectedSceneId === scene.id ? 'selected' : ''}`} aria-label={`Select clip ${scene.label}`} title={`${scene.label} · ${(sceneFrames(scene) / flow.fps).toFixed(1)}s${idle ? ' · Idle: repeats until an answer' : ''}`} onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          value.onSelectScene(scene.id, event.detail === 0 ? 0 : Math.floor((event.clientX - rect.left) / rect.width * sceneFrames(scene)));
        }} aria-description={stale ? 'Stale: upstream video changed. Regenerate this clip to match.' : undefined} aria-pressed={value.selectedSceneId === scene.id}>
          {url ? <VideoFilmstrip url={url} start={scene.clip.inFrame / flow.fps} end={scene.clip.outFrame / flow.fps} width={bounds.width} /> : <ClipLoading failed={!busy} message={busy ? phaseLabel(item) : 'Clip media unavailable'} />}
          {url && busy && <ClipJobStatus label={scene.label} message={phaseLabel(item)} />}
          {stale && <span className="flow-clip-stale" title="Upstream video changed. Regenerate this clip to match.">Stale</span>}
          <span className={`timeline-clip-label ${scene.clip.kind !== 'video' ? 'flow-clip-type' : ''}`}>
            {idle && <Repeat2 size={13} role="img" aria-label="Loops until an answer" />}
            <span>{scene.clip.kind === 'video' ? scene.label : clipTypeLabel(scene.clip, flow)}{scene.draft ? ' · Draft' : ''}</span>
          </span>
        </button>
        {flow.edges.filter(edge => edge.from === scene.id).map(edge => <button key={edge.id}
          className={`timeline-flow-edge flow-output-port ${edge.when === 'pending' ? 'flow-repeat-port' : ''} ${value.selectedEdgeId === edge.id ? 'selected' : ''}`}
          aria-label={edge.when === 'pending' ? `Inspect repeat from ${scene.label}` : `Inspect ${answerLabel(flow, edge.when)} from ${scene.label}`}
          aria-pressed={value.selectedEdgeId === edge.id} title={edge.when === 'pending' ? 'Repeat until an answer' : `Continues to ${getScene(flow, edge.to).label}`}
          data-edge-id={edge.id} data-to={edge.to} data-traversed={!!session?.traversedEdgeIds.includes(edge.id)}
          style={{ top: edge.when === 'pending' ? 13 : `${(outputs.indexOf(edge) + .5) / outputs.length * 100}%` }}
          onClick={() => value.onSelectEdge(edge.id)}>
          {edge.when === 'pending' ? <RotateCcw size={13} aria-hidden="true" /> : <ArrowRight size={13} aria-hidden="true" />}
        </button>)}
        {active && <div className="playhead flow-playhead" style={{ left: `${Math.min(100, session.frame / sceneFrames(scene) * 100)}%` }}><span /></div>}
      </div>;
  };
  return <div className="timeline-flow-tracks" style={{ width, '--response-count': rows } as CSSProperties} aria-label="Call response clips">
    {flow.scenes.filter(scene => scene.clip.kind === 'video').map(scene => renderClip(scene))}
    {groups.map((group, index) => {
      const members = interstitialScenes(group);
      if (!members.length) return null;
      const groupStart = Math.min(...members.map(scene => box(scene.id).x)), groupEnd = Math.max(...members.map(scene => box(scene.id).x + box(scene.id).width));
      const selectedParent = value.groups?.find(value => value.flow.interstitial.id === group.interstitial.id)?.selectedInterstitial ?? value.selectedInterstitial;
      const groupSelected = selectedParent || members.some(scene => scene.id === value.selectedSceneId || flow.edges.some(edge => edge.id === value.selectedEdgeId && edge.from === scene.id));
      const groupReady = members.every(scene => !scene.draft && !!assets.url(scene.clip.assetId) && !value.staleClipIds?.has(scene.interstitialId!));
      return <div key={group.interstitial.id} className="timeline-interstitial-group" role="group" aria-label={group.interstitial.label}
      data-interstitial-id={group.interstitial.id} style={{ left: groupStart, width: groupEnd - groupStart }}>
      <button className={`timeline-interstitial-container ${groupSelected ? 'selected' : ''}`} aria-label={`Select entire ${group.interstitial.label}`}
        aria-pressed={selectedParent} onClick={() => value.onSelectInterstitial(group.interstitial.id)} />
      <div className={`timeline-marker timeline-interstitial-marker ${groupReady ? 'ready' : ''} ${groupSelected ? 'selected' : ''}`}>
        <button className="timeline-pin" aria-label={`Select ${group.interstitial.label} at ${formatTime(group.interstitial.time)}`}
          aria-pressed={groupSelected} title={`${group.interstitial.label} · ${formatTime(group.interstitial.time, true)}`}
          onClick={() => value.onSelectInterstitial(group.interstitial.id)}>{index + 1}</button>
      </div>
      {members.map(scene => renderClip(scene, groupStart))}
    </div>; })}
  </div>;
}
