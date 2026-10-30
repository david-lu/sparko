import { behaviorLabel } from './behaviors';
import { Copy, LayoutTemplate, Ungroup } from 'lucide-react';
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
    <div className="group-inspector-actions">
      <button className="button small" onClick={() => editor.saveTemplate(group.name)}><LayoutTemplate size={13} />Save group as template</button>
      <button className="button small" onClick={editor.duplicate}><Copy size={13} />Duplicate group</button>
      <button className="button small" onClick={() => editor.ungroup(group.id)}><Ungroup size={13} />Ungroup</button>
    </div>
    <details className="inspector-group" open><summary>Clips<span>{clips.length}</span></summary><div className="group-clip-list">
      {clips.map(n => <button key={n.id} onClick={() => editor.select(n.id)}><span>{editor.items.find(i => i.id === n.interstitialId)?.label ?? n.name}</span><small>{behaviorLabel(n)}</small></button>)}
    </div></details>
  </div>;
}
