import ClipMediaSection from './ClipMediaSection';
import ClipGenerationEditor from './ClipGenerationEditor';
import { Copy, Flag, Mic, MousePointerClick, Scissors, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppStatus } from '../../../shared/contracts';
import { LOOP_CROSSFADE_SECONDS, TIMELINE_FPS, VOICE_CHOICE } from '../../../shared/constants';
import { playableResult } from '../../../shared/interstitials';
import type { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import InterstitialEditor from '../interstitials/InterstitialEditor';
import InterstitialOutput from '../interstitials/InterstitialOutput';
import { freshId, nodeDuration } from './model';
import { behaviors, conditionsFor, defaultCondition } from './behaviors';
import BehaviorSection from './BehaviorSection';
import type { StoryEditor } from './useStoryEditor';
import ConnectionInspector from './ConnectionInspector';
import GeneratedVideoInfo from './GeneratedVideoInfo';
import GroupInspector from './GroupInspector';
import { storyGenerationItem } from './referenceInputs';
import './inspector.css';
import { useShortcuts } from '../../shared/shortcuts';
import LoopReferenceHelp from './LoopReferenceHelp';
import AssetInspector, { AssetSelectionInspector } from '../project/AssetInspector';
import ClipVolumeControl from './ClipVolumeControl';
import ProjectInspector from './ProjectInspector';
import ContentIssues from '../../shared/ContentIssues';
import { assets } from '../project/assets';
import { useAssetAvailability } from '../project/useAssetAvailability';
import VideoFrameRate from '../project/VideoFrameRate';
import ClipColorPicker from './ClipColorPicker';
import CrossfadeCurveField from './CrossfadeCurveField';

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
  useAssetAvailability([]);
  if(editor.clipDrag)return <ProjectInspector key={editor.projects.getSnapshot().project?.id} editor={editor} status={status}/>;
  if (editor.librarySelections.length > 1) return <AssetSelectionInspector editor={editor}/>;
  if (editor.librarySelection?.type === 'asset' || editor.librarySelection?.type === 'generation') return <AssetInspector editor={editor} status={status}/>;
  if (editor.librarySelection?.type === 'job') {
    const job = items.find(i => i.id === editor.librarySelection!.id);
    if (job) return <div className="story-inspector clip-inspector" data-project-edit><h2>{job.label}</h2>
      <InterstitialEditor player={editor.player} projects={editor.projects} compact showOutput={false} selected={job} controller={editor.jobs} engine={engine} info={info} status={status} active onPreviewPlay={() => editor.player.pause()}/>
      <details className="inspector-group inspector-media" open><summary>Media assets</summary>
        <VideoFrameRate projects={editor.projects} onConverted={asset => editor.selectLibrary({ type: 'asset', id: asset.assetId })} assetId={playableResult(job)?.assetId}/>
        <InterstitialOutput item={job} projects={editor.projects} compact active onPlay={() => editor.player.pause()}/>
      </details>
    </div>;
  }
  if (!graph) return null;
  const node = graph.nodes.find(n => n.id === editor.selectedId), connection = graph.edges.find(e => e.id === editor.selectedEdge);
  if (connection) return <ConnectionInspector editor={editor} connection={connection} info={info} />;
  if (editor.selectedGroup) return <GroupInspector key={editor.selectedGroup.id} editor={editor} group={editor.selectedGroup} />;
  if (!node) return <ProjectInspector key={editor.projects.getSnapshot().project?.id} editor={editor} status={status}/>;
  const savedItem = items.find(i => i.id === node.interstitialId), item = savedItem && storyGenerationItem(savedItem, node);
  const duration = nodeDuration(node, items), behavior=behaviors(node), conditions=conditionsFor(graph,node), voice=node.conditionInput==='voice';
  const maxLoopFade = Math.floor(duration * TIMELINE_FPS / 2) / TIMELINE_FPS;
  return <div className="story-inspector clip-inspector" data-project-edit>
    <div className="inspector-clip-heading">
      <label className="sr-only" htmlFor="story-clip-name">Clip name</label>
      <ClipName key={node.id} value={item?.label ?? node.name} onSave={name => editor.rename(node.id, name)} />
      <div className="inspector-clip-tools" role="group" aria-label="Clip actions">
        <button className="icon-button small" aria-label="Duplicate clip" title={shortcuts.title('duplicate')} onClick={editor.duplicate}><Copy size={13} /></button>
        <button className="icon-button small" aria-label="Split at playhead" title={shortcuts.title('split')} onClick={() => editor.split()}><Scissors size={13} /></button>
        <button className="icon-button small" aria-label="Delete selected clips" disabled={editor.removingClips} aria-busy={editor.removingClips} title={shortcuts.title('delete')} onClick={editor.remove}><Trash2 size={13} /></button>
      </div>
    </div>
    <div className="inspector-clip-meta">
      <span>{duration.toFixed(2)} s · {item ? playableResult(item) ? 'Generated' : 'Draft' : node.source?.kind === 'image' ? 'Still image · silent' : 'Source'}{editor.selected.length > 1 ? ` · ${editor.selected.length} selected` : ''}</span>
      {node.source && <ContentIssues label="Source video errors" issues={assets.error(node.source.assetId) ? [{ key: 'source', title: 'Source video unavailable', message: assets.error(node.source.assetId)! }] : []} />}
      {graph.entryId===node.id&&<span className="inspector-entry" title="The experience starts with this video"><Flag size={11}/>Start video</span>}
    </div>
    <ClipColorPicker color={editor.selected.every(id => (graph.nodes.find(n => n.id === id)?.color ?? 'gray') === (node.color ?? 'gray')) ? node.color ?? 'gray' : undefined} onChange={editor.colorClips}/>
    <BehaviorSection key={`loop:${node.id}`} name="Loop" enabled={behavior.loop} onToggle={enabled=>editor.toggleBehavior(node.id,'loop',enabled)} help={!item && <LoopReferenceHelp />}>
      <label className="inspector-property"><span>Loop count</span><input aria-label="Loop count" type="number" min={0} max={10000} value={node.loopCount} title="0 repeats until a condition matches or Continue is pressed." onChange={e=>Number.isFinite(e.target.valueAsNumber)&&editor.patch(node.id,{loopCount:Math.max(0,Math.min(10000,Math.round(e.target.valueAsNumber)))})}/></label>
      <p className="inspector-behavior-hint">{node.loopCount?`Play up to ${node.loopCount} times; a choice can exit sooner.`:behavior.conditional?'Repeat until a condition matches.':'Repeat until Continue is pressed.'}</p>
      {(['Video','Audio'] as const).map(channel=>{
        const field=channel==='Video'?'loopVideoCrossfade':'loopAudioCrossfade',shape=channel==='Video'?'loopVideoCrossfadeCurve':'loopAudioCrossfadeCurve';
        const fade=Math.min(maxLoopFade,Math.round((node[field]??LOOP_CROSSFADE_SECONDS)*TIMELINE_FPS)/TIMELINE_FPS);
        return <CrossfadeCurveField key={`${node.id}:${channel}`} name={`Loop ${channel.toLowerCase()} crossfade`} label={`${channel} fade`} duration={fade} max={maxLoopFade} step={1/TIMELINE_FPS}
          curve={node[shape]} onCurve={curve=>editor.patch(node.id,{[shape]:curve})} onBoundary={()=>editor.projects.endHistoryGroup()}
          onDuration={value=>editor.patch(node.id,{[field]:Math.min(maxLoopFade,Math.max(0,Math.round(value*TIMELINE_FPS)/TIMELINE_FPS))})}/>;
      })}
      <p className="inspector-behavior-hint">Blend the ending into the beginning. Drag each end point to change its length; 0 makes a cut. Each is limited to half the clip; repeats are shorter by the longer overlap.</p>
    </BehaviorSection>
    <BehaviorSection key={`conditional:${node.id}`} name="Conditional" enabled={behavior.conditional} onToggle={enabled=>editor.toggleBehavior(node.id,'conditional',enabled)}>
      <div className="inspector-property condition-input" role="radiogroup" aria-label="Condition input"><span aria-hidden>Input</span>
        <div className="segmented-control">{(['button','voice'] as const).map(input=><label key={input} title={input==='voice'?'Viewers say their answer out loud':'Viewers press a button'}>
          <input type="radio" name={`condition-input:${node.id}`} value={input} checked={(node.conditionInput??'button')===input} onChange={()=>editor.patch(node.id,{conditionInput:input==='button'?undefined:input})}/>
          {input==='voice'?<Mic size={12} aria-hidden/>:<MousePointerClick size={12} aria-hidden/>}{input==='voice'?'Voice':'Button'}
        </label>)}</div>
      </div>
      {voice&&<p className="inspector-behavior-hint condition-input-hint">{status&&!status.providers.hume?<strong>HUME_API_KEY is missing, so voice answers can't be judged. </strong>:null}
        {conditions.length-1>VOICE_CHOICE.maxConditions?<strong>Voice judges up to {VOICE_CHOICE.maxConditions} conditions besides the default. </strong>:null}
        Viewers answer out loud. Describe each condition as something Hume can decide from what it hears, such as: the viewer says something similar to "trees breathe air", or: the viewer sounds excited. The strongest match plays, and Default plays when nothing matches.</p>}
      {conditions.map((condition,index)=>{
        const isDefault=defaultCondition(graph,node)?.id===condition.id,name=`Condition ${index+1} label`;
        // Descriptions are one line on the clip's output socket, so line breaks become spaces.
        const rename=(label:string)=>editor.updateConditions(node.id,conditions.map(c=>c.id===condition.id?{...c,label:label.replace(/\s*\n\s*/g,' ')}:c));
        return <div className="inspector-rule" key={condition.id}>
        <div className="inspector-rule-heading">{voice&&!isDefault
          ?<textarea className="condition-description" aria-label={name} rows={2} maxLength={200} placeholder={'e.g. The viewer says something similar to "trees breathe air"'} value={condition.label} onChange={e=>rename(e.target.value)}/>
          :<input aria-label={name} maxLength={200} value={condition.label} onChange={e=>rename(e.target.value)}/>}
          <button className="icon-button small" aria-label={`Remove condition ${index+1}`} onClick={()=>editor.updateConditions(node.id,conditions.filter(c=>c.id!==condition.id))}><Trash2 size={12}/></button></div>
        <label className="condition-default"><input type="radio" name={`default-condition:${node.id}`} aria-label={`Use condition ${index+1} as default`} checked={isDefault} onChange={()=>editor.patch(node.id,{defaultConditionId:condition.id})}/>{voice&&isDefault?'Default · plays when nothing matches':'Default'}</label>
        {!voice&&<details className="inspector-aliases"><summary>Also accept{condition.values.length?` (${condition.values.length})`:''}</summary><textarea aria-label={`Condition ${index+1} alternatives`} placeholder="One alternative per line" rows={2} value={condition.values.join('\n')} onChange={e=>editor.updateConditions(node.id,conditions.map(c=>c.id===condition.id?{...c,values:e.target.value.split('\n').slice(0,100).map(v=>v.slice(0,200))}:c))}/></details>}
      </div>;})}
      <button className="text-button inspector-add-choice" disabled={conditions.length>=100} onClick={()=>editor.updateConditions(node.id,[...conditions,{id:freshId(),label:`Condition ${conditions.length+1}`,values:[]}])}>+ Add condition</button>
      <p className="hint">Drag each labeled output on the clip to its destination.</p>
    </BehaviorSection>
    {node.generationId && editor.projects.getSnapshot().project?.clipGenerations?.filter(g=>g.id===node.generationId).map(generation=><ClipGenerationEditor key={generation.id} editor={editor} generation={generation} status={status}/>)}
    {item && <InterstitialEditor player={editor.player} key={item.id} projects={editor.projects} compact showOutput={false} selected={item} controller={editor.jobs} engine={engine} info={info} status={status} active onPreviewPlay={() => editor.player.pause()}/>}
    {(node.source?.kind??node.mediaKind) === 'image' && <label className="inspector-property"><span>Duration (s)</span><input aria-label="Image duration" title={`Minimum: 1 frame (1/${TIMELINE_FPS} second). Arrow keys adjust one frame.`} type="number" min={1 / TIMELINE_FPS} step={1 / TIMELINE_FPS} value={duration} onChange={e => {
      const frames = Math.max(1, Math.round(e.target.valueAsNumber * TIMELINE_FPS));
      if (Number.isSafeInteger(frames)) editor.patch(node.id, { duration:frames/TIMELINE_FPS, ...(node.source?{source: { ...node.source, outFrame: node.source.inFrame + frames }}:{}) });
    }}/></label>}
    {node.source && node.source.kind !== 'image' && <div className="inspector-source-range">{(['inFrame', 'outFrame'] as const).map(field => <label className="inspector-property" key={field}><span>{field === 'inFrame' ? 'Source in' : 'Source out'}</span><input type="number" step={1 / TIMELINE_FPS} min={field === 'inFrame' ? 0 : (node.source!.inFrame + 1) / TIMELINE_FPS} max={field === 'inFrame' ? (node.source!.outFrame - 1) / TIMELINE_FPS : node.source!.duration ?? info?.duration}
      value={Number((node.source![field] / TIMELINE_FPS).toFixed(3))} onChange={e => {
        const frame = Math.round(e.target.valueAsNumber * TIMELINE_FPS);
        if (Number.isFinite(frame)) editor.patch(node.id, { source: { ...node.source!, [field]: field === 'inFrame' ? Math.max(0, Math.min(node.source!.outFrame - 1, frame)) : Math.max(node.source!.inFrame + 1, Math.min(Math.floor((node.source!.duration ?? info?.duration ?? Infinity) * TIMELINE_FPS), frame)) } });
      }} /></label>)}</div>}
    {node.trim && <div className="inspector-trim"><span>Trim: {(node.trim.inFrame / TIMELINE_FPS).toFixed(2)}–{(node.trim.outFrame / TIMELINE_FPS).toFixed(2)} s</span><button className="text-button" onClick={() => editor.patch(node.id, { trim: undefined })}>Restore full clip</button></div>}
    {(node.source?.kind??node.mediaKind) !== 'image' && <ClipVolumeControl node={node} editor={editor}/>}
    <ClipMediaSection key={node.id} node={node} editor={editor}>
      {item && <InterstitialOutput item={item} projects={editor.projects} compact active onPlay={() => editor.player.pause()}
        details={<GeneratedVideoInfo item={item} node={node} nodes={graph.nodes} items={items} assetAliases={editor.projects.getSnapshot().project?.assetAliases} onSelectReference={editor.revealClip}/>}/>}
    </ClipMediaSection>
  </div>;
}
