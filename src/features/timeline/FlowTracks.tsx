import { useEffect, useState, type CSSProperties } from 'react';
import { Repeat2 } from 'lucide-react';
import { formatTime } from '../../../shared/contracts';
import { assets } from '../project/assets';
import { answerLabel, branchScenes, clipTypeLabel, flowLayout, getScene, interstitialScenes, sceneFrames, type CallResponseFlow, type Outcome, type PlaybackSession, type SceneId, type TimelineScene } from '../call-response/model';
import VideoFilmstrip from './VideoFilmstrip';
import './flow.css';

export type FlowTimeline = {
  flow: CallResponseFlow;
  session: PlaybackSession | null;
  selectedSceneId: SceneId | null;
  selectedEdgeId: string | null;
  selectedInterstitial: boolean;
  onSelectInterstitial: () => void;
  onRemoveInterstitial: () => void;
  onRenameInterstitial: (name: string) => void;
  onAddAnswer: () => void;
  onRemoveAnswer: (id: string) => void;
  onSelectScene: (id: SceneId, frame?: number) => void;
  onSelectEdge: (id: string) => void;
  onBranch: (id: SceneId, outcome: Outcome) => void;
  onReconnect: (id: string, to: SceneId) => void;
};
export default function FlowTracks({ value, width }: { value: FlowTimeline; width: number }) {
  const { flow, session } = value, layout = flowLayout(flow), unit = width / layout.totalFrames;
  const branches = branchScenes(flow), rows = Math.max(1, branches.length);
  const [connecting, setConnecting] = useState<string | null>(null);
  useEffect(() => { const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') setConnecting(null); }; window.addEventListener('keydown', cancel); return () => window.removeEventListener('keydown', cancel); }, []);
  const box = (id: SceneId) => ({ x: layout.starts[id] * unit, width: sceneFrames(getScene(flow, id)) * unit });
  const members = interstitialScenes(flow);
  const groupStart = members.length ? Math.min(...members.map(scene => box(scene.id).x)) : 0;
  const groupEnd = members.length ? Math.max(...members.map(scene => box(scene.id).x + box(scene.id).width)) : 0;
  const groupSelected = value.selectedInterstitial || members.some(scene => scene.id === value.selectedSceneId || flow.edges.some(edge => edge.id === value.selectedEdgeId && edge.from === scene.id));
  const groupReady = members.every(scene => !!assets.url(scene.clip.assetId));
  const renderClip = (scene: TimelineScene, offset = 0) => {
      const bounds = box(scene.id), active = session?.sceneId === scene.id, idle = scene.clip.kind === 'idle';
      const url = assets.url(scene.clip.assetId);
      const row = branches.findIndex(branch => branch.id === scene.id);
      const outputs = flow.edges.filter(edge => edge.from === scene.id && edge.when !== 'pending');
      return <div key={scene.id} className={`timeline-flow-clip clip-${scene.clip.kind} ${value.selectedSceneId === scene.id ? 'selected' : ''} ${active ? 'active' : ''} ${connecting ? 'connect-target' : ''}`}
        style={{ left: bounds.x - offset, width: bounds.width, top: row < 0 ? undefined : `calc(50% + var(--timeline-clip-height) * ${row - rows / 2})` }} data-scene-id={scene.id} data-clip-kind={scene.clip.kind} data-active={active}>
        <button className={`flow-clip-body ${scene.clip.kind !== 'video' ? 'rendered-interstitial' : ''} ${value.selectedSceneId === scene.id ? 'selected' : ''}`} aria-label={`${connecting ? 'Connect to' : 'Select clip'} ${scene.label}`} title={`${scene.label} · ${(sceneFrames(scene) / flow.fps).toFixed(1)}s${idle ? ' · Idle: repeats until an answer' : ''}`} onClick={event => {
          if (connecting) { value.onReconnect(connecting, scene.id); setConnecting(null); return; }
          const rect = event.currentTarget.getBoundingClientRect();
          value.onSelectScene(scene.id, event.detail === 0 ? 0 : Math.floor((event.clientX - rect.left) / rect.width * sceneFrames(scene)));
        }} aria-pressed={connecting ? undefined : value.selectedSceneId === scene.id}>
          {url && <VideoFilmstrip url={url} start={scene.clip.inFrame / flow.fps} end={scene.clip.outFrame / flow.fps} width={bounds.width} />}
          {scene.clip.kind !== 'video' && <span className="flow-clip-type">
            {idle && <Repeat2 size={13} role="img" aria-label="Loops until an answer" />}
            <span>{clipTypeLabel(scene.clip, flow)}</span>
          </span>}
        </button>
        {flow.edges.filter(edge => edge.from === scene.id).map(edge => <button key={edge.id}
          className={`timeline-flow-edge flow-output-port ${edge.when === 'pending' ? 'flow-repeat-port' : ''} ${connecting === edge.id ? 'connecting' : ''} ${value.selectedEdgeId === edge.id ? 'selected' : ''}`}
          aria-label={edge.when === 'pending' ? `Inspect repeat from ${scene.label}` : `Reconnect ${answerLabel(flow, edge.when)} from ${scene.label}`}
          aria-pressed={value.selectedEdgeId === edge.id} title={edge.when === 'pending' ? 'Repeat until an answer' : `Reconnect ${answerLabel(flow, edge.when)}`}
          data-edge-id={edge.id} data-to={edge.to} data-traversed={!!session?.traversedEdgeIds.includes(edge.id)}
          style={{ top: edge.when === 'pending' ? 8 : `${(outputs.indexOf(edge) + .5) / outputs.length * 100}%`, background: edge.when === 'pending' ? '#dfc179' : edge.when === 'ended' ? '#95b1d5' : '#8cc8a2' }}
          onClick={() => { setConnecting(edge.when === 'pending' ? null : edge.id); value.onSelectEdge(edge.id); }} />)}
        {active && <div className="playhead flow-playhead" style={{ left: `${Math.min(100, session.frame / sceneFrames(scene) * 100)}%` }}><span /></div>}
      </div>;
  };
  return <div className="timeline-flow-tracks" style={{ width, '--response-count': rows } as CSSProperties} aria-label="Call response clips">
    {flow.scenes.filter(scene => scene.clip.kind === 'video').map(scene => renderClip(scene))}
    {!!members.length && <div className="timeline-interstitial-group" role="group" aria-label={flow.interstitial.label}
      data-interstitial-id={flow.interstitial.id} style={{ left: groupStart, width: groupEnd - groupStart }}>
      <button className={`timeline-interstitial-container ${groupSelected ? 'selected' : ''}`} aria-label={`Select entire ${flow.interstitial.label}`}
        aria-pressed={value.selectedInterstitial} onClick={value.onSelectInterstitial} />
      <div className={`timeline-marker timeline-interstitial-marker ${groupReady ? 'ready' : ''} ${groupSelected ? 'selected' : ''}`}>
        <button className="timeline-pin" aria-label={`Select ${flow.interstitial.label} at ${formatTime(flow.interstitial.time)}`}
          aria-pressed={groupSelected} title={`${flow.interstitial.label} · ${formatTime(flow.interstitial.time, true)}`}
          onClick={value.onSelectInterstitial}>1</button>
      </div>
      {members.map(scene => renderClip(scene, groupStart))}
    </div>}
    {connecting && <div className="flow-connect-hint" role="status">Click the destination clip · Escape to cancel</div>}
  </div>;
}
