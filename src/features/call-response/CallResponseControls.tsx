import { changeClipKind, getScene, reconnectEdge, type CallResponseFlow, type SceneId, type TimelineClip } from './model';

export default function CallResponseControls({ flow, selectedSceneId, selectedEdgeId, onChange, onSelectEdge }: {
  flow: CallResponseFlow; selectedSceneId: SceneId | null; selectedEdgeId: string | null;
  onChange: (flow: CallResponseFlow) => void; onSelectEdge: (id: string) => void;
}) {
  const scene = selectedSceneId ? getScene(flow, selectedSceneId) : null;
  const edge = flow.edges.find(item => item.id === selectedEdgeId);
  if (!scene && !edge) return null;
  const setType = (kind: TimelineClip['kind']) => {
    if (!scene) return;
    onChange(changeClipKind(flow, scene.id, kind));
  };
  return <div className="call-response-controls" aria-label="Clip behavior">
    <h2>{edge ? 'Connection' : 'Clip behavior'}</h2>
    {edge ? <>
      <p className="hint">{getScene(flow, edge.from).label} · {edge.when === 'ended' ? 'when the clip ends' : edge.when === 'pending' ? 'while no answer is available' : `answer = ${edge.when}`}</p>
      <label className="field">Destination<select aria-label="Connection destination" value={edge.to} disabled={edge.when === 'pending'} onChange={event => onChange(reconnectEdge(flow, edge.id, event.target.value as SceneId))}>{flow.scenes.filter(item => item.id !== edge.from || edge.when === 'pending').map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    </> : scene && <>
      <label className="field">Clip type<select aria-label="Clip type" value={scene.clip.kind} onChange={event => setType(event.target.value as TimelineClip['kind'])}><option value="video">Video clip</option><option value="call">Call clip</option><option value="idle">Idle clip</option><option value="response">Response clip</option></select></label>
      {flow.edges.filter(item => item.from === scene.id).map(item => <button className="flow-connection-row" key={item.id} onClick={() => onSelectEdge(item.id)}><span>{item.when === 'pending' ? '↻ Repeat' : item.when === 'ended' ? 'Next' : item.when}</span><small>→ {getScene(flow, item.to).label}</small></button>)}
    </>}
  </div>;
}
