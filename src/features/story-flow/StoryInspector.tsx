import { Copy, Flag, Scissors, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppStatus } from '../../../shared/contracts';
import { TIMELINE_FPS } from '../../../shared/constants';
import { playableResult } from '../../../shared/interstitials';
import type { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import InterstitialEditor from '../interstitials/InterstitialEditor';
import { freshId, nodeDuration } from './model';
import { behaviors, conditionsFor, defaultCondition } from './behaviors';
import BehaviorSection from './BehaviorSection';
import type { StoryEditor } from './useStoryEditor';
import ConnectionInspector from './ConnectionInspector';
import GeneratedVideoInfo from './GeneratedVideoInfo';
import GroupInspector from './GroupInspector';
import { connectedReferences, storyGenerationItem } from './referenceInputs';
import './inspector.css';
import { useShortcuts } from '../../shared/shortcuts';
import LoopReferenceHelp from './LoopReferenceHelp';
import StoryReferences from './StoryReferences';
import AssetInspector from '../project/AssetInspector';
import ProjectInspector from './ProjectInspector';

function ClipName({ value, onSave }: { value: string; onSave: (name: string) => void }) {
  const [name, setName] = useState(value);
  useEffect(() => setName(value), [value]);
  return <input id="story-clip-name" className="story-name" value={name} onChange={e => setName(e.target.value)} onBlur={e => onSave(e.target.value)}
    onKeyDown={e => {
      if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
      if (e.key === 'Escape') { e.currentTarget.value = value; setName(value); e.currentTarget.blur(); }
    }} />;
}

export default function StoryInspector({ editor, engine, info, status }: { editor: StoryEditor; engine: MediaEngine | null; info: MediaInfo | null; status: AppStatus | null }) {
  const shortcuts=useShortcuts();
  const { graph, items } = editor;
  if(editor.clipDrag)return <ProjectInspector key={editor.projects.getSnapshot().project?.id} editor={editor}/>;
  if (editor.librarySelection?.type === 'asset' || editor.librarySelection?.type === 'generation') return <AssetInspector editor={editor} status={status}/>;
  if (editor.librarySelection?.type === 'job') {
    const job = items.find(i => i.id === editor.librarySelection!.id);
    if (job) return <div className="story-inspector clip-inspector"><h2>{job.label}</h2><InterstitialEditor compact selected={job} controller={editor.jobs} engine={engine} info={info} status={status} active onPreviewPlay={() => editor.player.pause()}/></div>;
  }
  if (!graph) return null;
  const node = graph.nodes.find(n => n.id === editor.selectedId), connection = graph.edges.find(e => e.id === editor.selectedEdge);
  const nameOf = (id: string) => { const n = graph.nodes.find(n => n.id === id); return items.find(i => i.id === n?.interstitialId)?.label ?? n?.name ?? 'Disconnected'; };
  if (connection) return <ConnectionInspector editor={editor} connection={connection} info={info} />;
  if (editor.selectedGroup) return <GroupInspector key={editor.selectedGroup.id} editor={editor} group={editor.selectedGroup} />;
  if (!node) return <ProjectInspector key={editor.projects.getSnapshot().project?.id} editor={editor}/>;
  const savedItem = items.find(i => i.id === node.interstitialId), item = savedItem && storyGenerationItem(savedItem, node);
  const duration = nodeDuration(node, items), behavior=behaviors(node), conditions=conditionsFor(graph,node);
  const refs = connectedReferences(graph, node.id);
  const referenceLabel = (ids: string[]) => ids.length === 1 ? nameOf(ids[0]) : ids.length ? `${ids.length} connected clips` : 'Not connected';
  return <div className="story-inspector clip-inspector" data-project-edit>
    <div className="inspector-clip-heading">
      <label className="sr-only" htmlFor="story-clip-name">Clip name</label>
      <ClipName key={node.id} value={item?.label ?? node.name} onSave={name => editor.rename(node.id, name)} />
      <div className="inspector-clip-tools" role="group" aria-label="Clip actions">
        <button className="icon-button small" aria-label="Duplicate clip" title={shortcuts.title('duplicate')} onClick={editor.duplicate}><Copy size={13} /></button>
        <button className="icon-button small" aria-label="Split at playhead" title={shortcuts.title('split')} onClick={() => editor.split()}><Scissors size={13} /></button>
        <button className="icon-button small" aria-label="Delete selected clips" title={shortcuts.title('delete')} onClick={editor.remove}><Trash2 size={13} /></button>
      </div>
    </div>
    <div className="inspector-clip-meta">
      <span>{duration.toFixed(2)} s · {item ? playableResult(item) ? 'Generated' : 'Draft' : 'Source'}{editor.selected.length > 1 ? ` · ${editor.selected.length} selected` : ''}</span>
      {graph.entryId===node.id&&<span className="inspector-entry" title="The experience starts with this video"><Flag size={11}/>Start video</span>}
    </div>
    <BehaviorSection key={`loop:${node.id}`} name="Loop" enabled={behavior.loop} onToggle={enabled=>editor.toggleBehavior(node.id,'loop',enabled)} help={!item && <LoopReferenceHelp />}>
      <label className="inspector-property"><span>Loop count</span><input aria-label="Loop count" type="number" min={0} max={10000} value={node.loopCount} title="0 repeats until a condition matches or Continue is pressed." onChange={e=>Number.isFinite(e.target.valueAsNumber)&&editor.patch(node.id,{loopCount:Math.max(0,Math.min(10000,Math.round(e.target.valueAsNumber)))})}/></label>
      <p className="inspector-behavior-hint">{node.loopCount?`Play up to ${node.loopCount} times; a choice can exit sooner.`:behavior.conditional?'Repeat until a condition matches.':'Repeat until Continue is pressed.'}</p>
    </BehaviorSection>
    <BehaviorSection key={`conditional:${node.id}`} name="Conditional" enabled={behavior.conditional} onToggle={enabled=>editor.toggleBehavior(node.id,'conditional',enabled)}>
      {conditions.map((condition,index)=><div className="inspector-rule" key={condition.id}>
        <div className="inspector-rule-heading"><input aria-label={`Condition ${index+1} label`} maxLength={200} value={condition.label} onChange={e=>editor.updateConditions(node.id,conditions.map(c=>c.id===condition.id?{...c,label:e.target.value}:c))}/><button className="icon-button small" aria-label={`Remove condition ${index+1}`} onClick={()=>editor.updateConditions(node.id,conditions.filter(c=>c.id!==condition.id))}><Trash2 size={12}/></button></div>
        <label className="condition-default"><input type="radio" name={`default-condition:${node.id}`} aria-label={`Use condition ${index+1} as default`} checked={defaultCondition(graph,node)?.id===condition.id} onChange={()=>editor.patch(node.id,{defaultConditionId:condition.id})}/>Default</label>
        <details className="inspector-aliases"><summary>Also accept{condition.values.length?` (${condition.values.length})`:''}</summary><textarea aria-label={`Condition ${index+1} alternatives`} placeholder="One alternative per line" rows={2} value={condition.values.join('\n')} onChange={e=>editor.updateConditions(node.id,conditions.map(c=>c.id===condition.id?{...c,values:e.target.value.split('\n').slice(0,100).map(v=>v.slice(0,200))}:c))}/></details>
      </div>)}
      <button className="text-button inspector-add-choice" disabled={conditions.length>=100} onClick={()=>editor.updateConditions(node.id,[...conditions,{id:freshId(),label:`Condition ${conditions.length+1}`,values:[]}])}>+ Add condition</button>
      <p className="hint">Drag each labeled output on the clip to its destination.</p>
    </BehaviorSection>
    {item && <InterstitialEditor key={item.id} projects={editor.projects} compact selected={item} controller={editor.jobs} engine={engine} info={info} status={status} active onPreviewPlay={() => editor.player.pause()}
      generationSettings={<StoryReferences item={item} projects={editor.projects} loop={behavior.loop} labels={{ start: referenceLabel(refs.input), end: referenceLabel(refs.output) }} onChange={settings => editor.jobs.edit(item.id, settings)} />}
      resultDetails={<GeneratedVideoInfo item={item} node={node} nodes={graph.nodes} items={items} />} />}
    {node.source && <div className="inspector-source-range">{(['inFrame', 'outFrame'] as const).map(field => <label className="inspector-property" key={field}><span>{field === 'inFrame' ? 'Source in' : 'Source out'}</span><input type="number" step={1 / TIMELINE_FPS} min={field === 'inFrame' ? 0 : (node.source!.inFrame + 1) / TIMELINE_FPS} max={field === 'inFrame' ? (node.source!.outFrame - 1) / TIMELINE_FPS : node.source!.duration ?? info?.duration}
      value={Number((node.source![field] / TIMELINE_FPS).toFixed(3))} onChange={e => {
        const frame = Math.round(e.target.valueAsNumber * TIMELINE_FPS);
        if (Number.isFinite(frame)) editor.patch(node.id, { source: { ...node.source!, [field]: field === 'inFrame' ? Math.max(0, Math.min(node.source!.outFrame - 1, frame)) : Math.max(node.source!.inFrame + 1, Math.min(Math.floor((node.source!.duration ?? info?.duration ?? Infinity) * TIMELINE_FPS), frame)) } });
      }} /></label>)}</div>}
    {node.trim && <div className="inspector-trim"><span>Trim: {(node.trim.inFrame / TIMELINE_FPS).toFixed(2)}–{(node.trim.outFrame / TIMELINE_FPS).toFixed(2)} s</span><button className="text-button" onClick={() => editor.patch(node.id, { trim: undefined })}>Restore full clip</button></div>}
  </div>;
}
