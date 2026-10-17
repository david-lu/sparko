import { answerLabel, changeClipKind, editAnswer, getScene, reconnectEdge, type CallResponseFlow, type SceneId, type TimelineClip } from './model';
import AnswerEditor from './AnswerEditor';

export default function CallResponseControls({ flow, selectedSceneId, selectedEdgeId, onChange, onSelectEdge, onRemoveAnswer }: {
  flow: CallResponseFlow; selectedSceneId: SceneId | null; selectedEdgeId: string | null;
  onChange: (flow: CallResponseFlow) => void; onSelectEdge: (id: string) => void;
  onRemoveAnswer: (id: string) => void;
}) {
  const scene = selectedSceneId ? getScene(flow, selectedSceneId) : null;
  const edge = flow.edges.find(item => item.id === selectedEdgeId);
  const answer = flow.interaction.answers.find(answer => answer.sceneId === scene?.id);
  if (!scene && !edge) return null;
  const setType = (kind: TimelineClip['kind']) => {
    if (!scene) return;
    onChange(changeClipKind(flow, scene.id, kind));
  };
  return <div className="call-response-controls" aria-label="Clip behavior" data-project-edit>
    <h2>{edge ? 'Connection' : 'Clip behavior'}</h2>
    {edge ? <>
      <p className="hint">{getScene(flow, edge.from).label} · {edge.when === 'ended' ? 'when the clip ends' : edge.when === 'pending' ? 'while no answer is available' : `answer = ${answerLabel(flow, edge.when)}`}</p>
      <label className="field">Destination<select aria-label="Connection destination" value={edge.to} disabled={edge.when === 'pending'} onChange={event => onChange(reconnectEdge(flow, edge.id, event.target.value as SceneId))}>{flow.scenes.filter(item => item.id !== edge.from || edge.when === 'pending').map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    </> : scene && <>
      {answer && <AnswerEditor key={answer.id} answer={answer} onChange={patch => onChange(editAnswer(flow, answer.id, patch))} onRemove={() => onRemoveAnswer(answer.id)} removable={flow.interaction.answers.length > 1} />}
      <label className="field">Clip type<select aria-label="Clip type" value={scene.clip.kind} onChange={event => setType(event.target.value as TimelineClip['kind'])}><option value="video">Video clip</option><option value="call">Call clip</option><option value="idle">Idle clip</option><option value="response">Response clip</option></select></label>
      {scene.clip.kind === 'idle' && <label className="field">Unmatched answer<select aria-label="Unmatched answer" value={flow.interaction.fallbackAnswerId ?? ''} onChange={event => onChange({ ...flow, interaction: { ...flow.interaction, fallbackAnswerId: event.target.value || null } })}>
        <option value="">Keep waiting</option>{flow.interaction.answers.map(answer => <option key={answer.id} value={answer.id}>{answer.label}</option>)}
      </select></label>}
      {flow.edges.filter(item => item.from === scene.id).map(item => <button className="flow-connection-row" key={item.id} onClick={() => onSelectEdge(item.id)}><span>{item.when === 'pending' ? '↻ Repeat' : item.when === 'ended' ? 'Next' : answerLabel(flow, item.when)}</span><small>→ {getScene(flow, item.to).label}</small></button>)}
    </>}
  </div>;
}
