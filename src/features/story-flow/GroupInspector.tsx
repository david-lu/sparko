import { behaviorLabel } from './behaviors';
import { Info, Minus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { groupColors, type StoryGroup } from './model';
import type { StoryEditor } from './useStoryEditor';

export default function GroupInspector({ group, editor }: { group: StoryGroup; editor: StoryEditor }) {
  const [name, setName] = useState(group.name);
  useEffect(() => setName(group.name), [group.name]);
  const clips = editor.graph!.nodes.filter(n => group.nodeIds.includes(n.id));
  return <div className="story-inspector clip-inspector group-inspector" data-project-edit>
    <label className="sr-only" htmlFor="story-group-name">Group name</label>
    <input id="story-group-name" className="story-name" value={name} maxLength={200} onChange={e => setName(e.target.value)} onBlur={e => { editor.patchGroup(group.id, { name: e.target.value }); if (!e.target.value.trim()) setName(group.name); }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setName(group.name); e.currentTarget.value = group.name; e.currentTarget.blur(); } }} />
    <div className="inspector-clip-meta"><span>Group · {clips.length} {clips.length === 1 ? 'clip' : 'clips'}</span><span>Drag header to move</span></div>
    <div className="inspector-property"><span>Color</span><div className="group-colors" role="group" aria-label="Group color">
      {Object.entries(groupColors).map(([color, value]) => <button key={color} aria-label={`${color[0].toUpperCase() + color.slice(1)} group color`} aria-pressed={group.color === color}
        style={{ background: value }} onClick={() => editor.patchGroup(group.id, { color: color as StoryGroup['color'] })} />)}
    </div></div>
    <details className="inspector-group" open><summary>Clips<span>{clips.length}</span></summary><div className="group-clip-list">
      {clips.map(n => <div className="group-clip-row" key={n.id}><button onClick={() => editor.select(n.id)}><span>{editor.items.find(i => i.id === n.interstitialId)?.label ?? n.name}</span><small>{behaviorLabel(n)}</small></button>
        <button className="icon-button" aria-label={`Remove ${n.name} from group`} title="Remove from group · keep clip and connections" onClick={()=>editor.removeFromGroup(group.id,[n.id])}><Minus size={13}/></button></div>)}
      {!clips.length&&<p className="hint">Empty group. Select clips, then right-click this group to add them.</p>}
    </div></details>
    <p className="group-actions-hint"><Info size={13}/>Right-click the group header for actions.</p>
  </div>;
}
