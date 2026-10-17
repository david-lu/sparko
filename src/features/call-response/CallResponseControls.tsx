import { answerLabel, assignResponseButton, getScene, type CallResponseFlow, type SceneId } from './model';

export default function CallResponseControls({ flow, selectedSceneId, selectedEdgeId, onChange, onSelectEdge }: {
  flow: CallResponseFlow; selectedSceneId: SceneId | null; selectedEdgeId: string | null;
  onChange: (flow: CallResponseFlow) => void; onSelectEdge: (id: string) => void;
}) {
  const scene = selectedSceneId ? getScene(flow, selectedSceneId) : null;
  const edge = flow.edges.find(item => item.id === selectedEdgeId && (!scene || item.from === scene.id));
  const answer = flow.interaction.answers.find(answer => answer.sceneId === scene?.id);
  if (!scene && !edge) return null;
  return <div className="call-response-controls" aria-label="Clip behavior" data-project-edit>
    {scene && <>
      {answer && <label className="field">Response button<select aria-label="Response button" value={answer.id} onChange={event => onChange(assignResponseButton(flow, scene.id, event.target.value))}>
        {flow.interaction.answers.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select><span className="hint">Choosing another button swaps the two response assignments.</span></label>}
      {flow.edges.filter(item => item.from === scene.id).map(item => <button className="flow-connection-row" key={item.id} onClick={() => onSelectEdge(item.id)}><span>{item.when === 'pending' ? '↻ Repeat' : item.when === 'ended' ? 'Next' : answerLabel(flow, item.when)}</span><small>→ {getScene(flow, item.to).label}</small></button>)}
    </>}
    {edge && <>
      <p className="hint">{getScene(flow, edge.from).label} · {edge.when === 'ended' ? 'when the clip ends' : edge.when === 'pending' ? 'while no answer is available' : `answer = ${answerLabel(flow, edge.when)}`}</p>
      <p className="hint">Continues to {getScene(flow, edge.to).label}.</p>
    </>}
  </div>;
}
