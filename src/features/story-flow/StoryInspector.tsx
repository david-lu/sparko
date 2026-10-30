import { Copy, Scissors, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppStatus } from '../../../shared/contracts';
import { TIMELINE_FPS } from '../../../shared/constants';
import type { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import InterstitialEditor from '../interstitials/InterstitialEditor';
import { edge, freshId, nodeDuration, type StoryNode } from './model';
import type { StoryEditor } from './useStoryEditor';
import ConnectionInspector from './ConnectionInspector';
import GeneratedVideoInfo from './GeneratedVideoInfo';
import { playableResult } from '../../../shared/interstitials';

function ClipName({value,onSave}:{value:string;onSave:(name:string)=>void}){
  const [name,setName]=useState(value);useEffect(()=>setName(value),[value]);
  return <input id="story-clip-name" className="story-name" value={name} onChange={e=>setName(e.target.value)} onBlur={e=>onSave(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}if(e.key==='Escape'){e.currentTarget.value=value;setName(value);e.currentTarget.blur();}}}/>;
}

export default function StoryInspector({editor,engine,info,status}:{editor:StoryEditor;engine:MediaEngine|null;info:MediaInfo|null;status:AppStatus|null}) {
  const {graph,items}=editor;if(!graph)return null;
  const node=graph.nodes.find(n=>n.id===editor.selectedId),connection=graph.edges.find(e=>e.id===editor.selectedEdge);
  const targets=(self?:string)=>graph.nodes.filter(n=>n.id!==self).map(n=><option key={n.id} value={n.id}>{items.find(i=>i.id===n.interstitialId)?.label??n.name}</option>);
  if(connection)return <ConnectionInspector editor={editor} connection={connection} info={info}/>;
  if(!node)return <div className="story-inspector"><span className="eyebrow">STORY FLOW</span><h2>Connect your clips</h2><p className="hint">Select a filmstrip to scrub and edit. Drag its title to move it. Connect an output to another clip’s input.</p><p className="hint">Drag an interstitial or template from the Library or toolbar menus to a spot on the timeline. Drop onto a wire to insert it into that connection.</p><p className="hint">Split any clip at the playhead with S, or use the scissors tool (C). Right-click for clip actions. Shift-click selects several clips.</p><p className="hint">Clip widths share one duration scale. Zoom in for precise edits.</p></div>;
  const item=items.find(i=>i.id===node.interstitialId),duration=nodeDuration(node,items),outgoing=graph.edges.filter(e=>e.from===node.id);
  const setNext=(event:'next'|'fallback',to:string)=>{const current=outgoing.find(e=>e.event===event);editor.change({...graph,edges:[...graph.edges.filter(e=>e.id!==current?.id),...(to?[current?{...current,to}:edge(node.id,to,event,event==='fallback'?'Otherwise':'Next')]:[])]});};
  return <div className="story-inspector" data-project-edit>
    <span className="eyebrow">{node.kind==='source'?'SOURCE CLIP':'INTERSTITIAL'}{editor.selected.length>1?` · ${editor.selected.length} selected`:''}</span>
    <label className="sr-only" htmlFor="story-clip-name">Clip name</label><ClipName key={node.id} value={item?.label??node.name} onSave={name=>editor.rename(node.id,name)}/>
    <div className="story-inspector-actions"><button className="button small" onClick={editor.duplicate} title="Duplicate (Ctrl/Cmd+D)"><Copy size={13}/>Duplicate</button>
      <button className="button small" onClick={()=>editor.split()}><Scissors size={13}/>Split at playhead</button>
      <button className="icon-button" aria-label="Delete selected clips" disabled={graph.nodes.length<=editor.selected.length} onClick={editor.remove}><Trash2 size={14}/></button></div>
    {node.kind!=='source'&&<label className="field">Type<select aria-label="Interstitial type" value={node.kind} onChange={e=>editor.setKind(node.id,e.target.value as 'simple'|'looped'|'conditional')}><option value="simple">Simple</option><option value="looped">Looped</option><option value="conditional">Conditional</option></select></label>}
    <p className="hint">{duration.toFixed(2)}s {(item&&playableResult(item))?'playable':item?'planned':''} · {graph.entryId===node.id?'Story starts here':node.kind==='source'?'Original footage':(item&&playableResult(item))?'Generated clip':'Draft clip'}</p>
    {graph.entryId!==node.id&&<button className="text-button" onClick={()=>editor.change({...graph,entryId:node.id})}>Start story from this clip</button>}
    {node.trim&&<p className="hint">Uses {(node.trim.inFrame/TIMELINE_FPS).toFixed(2)}–{(node.trim.outFrame/TIMELINE_FPS).toFixed(2)}s of the generated body. <button className="text-button" onClick={()=>editor.patch(node.id,{trim:undefined})}>Restore full clip</button></p>}
    {node.source&&<div className="range-fields">{(['inFrame','outFrame'] as const).map(field=><label className="field" key={field}>{field==='inFrame'?'Source in':'Source out'}<input type="number" step={1/TIMELINE_FPS} min={field==='inFrame'?0:(node.source!.inFrame+1)/TIMELINE_FPS} max={field==='inFrame'?(node.source!.outFrame-1)/TIMELINE_FPS:node.source!.duration??info?.duration} value={Number((node.source![field]/TIMELINE_FPS).toFixed(3))} onChange={e=>{const frame=Math.round(e.target.valueAsNumber*TIMELINE_FPS);if(Number.isFinite(frame))editor.patch(node.id,{source:{...node.source!,[field]:field==='inFrame'?Math.max(0,Math.min(node.source!.outFrame-1,frame)):Math.max(node.source!.inFrame+1,Math.min(Math.floor((node.source!.duration??info?.duration??Infinity)*TIMELINE_FPS),frame))}});}}/></label>)}</div>}
    <section className="story-section"><h3>{node.kind==='conditional'?'Routing rules':'Connection'}</h3>
      {node.kind==='looped'&&<label className="field">Repeat<select aria-label="Loop mode" value={node.loopCount?'count':'manual'} onChange={e=>editor.patch(node.id,{loopCount:e.target.value==='count'?3:0})}><option value="manual">Until Continue is chosen</option><option value="count">A number of times</option></select>{node.loopCount>0&&<input aria-label="Loop count" type="number" min={1} max={10000} value={node.loopCount} onChange={e=>Number.isFinite(e.target.valueAsNumber)&&editor.patch(node.id,{loopCount:Math.max(1,Math.min(10000,Math.round(e.target.valueAsNumber)))})}/>}</label>}
      {node.kind==='conditional'?<>{outgoing.filter(e=>e.event==='answer').map((rule,index)=><div className="story-rule" key={rule.id}><label className="field">Choice {index+1}<input aria-label={`Choice ${index+1} label`} value={rule.label} maxLength={200} onChange={e=>editor.change({...graph,edges:graph.edges.map(c=>c.id===rule.id?{...c,label:e.target.value}:c)})}/></label><label className="field">Leads to<select aria-label={`Choice ${index+1} destination`} value={rule.to} onChange={e=>editor.change({...graph,edges:graph.edges.map(c=>c.id===rule.id?{...c,to:e.target.value}:c)})}>{targets()}</select></label><label className="field">Also accept (one per line)<textarea rows={2} value={rule.values.join('\n')} onChange={e=>editor.change({...graph,edges:graph.edges.map(c=>c.id===rule.id?{...c,values:e.target.value.split('\n').slice(0,100).map(v=>v.slice(0,200))}:c)})}/></label><button className="text-button" onClick={()=>editor.change({...graph,edges:graph.edges.filter(c=>c.id!==rule.id)})}>Remove condition</button></div>)}
        <button className="button small" onClick={()=>editor.change({...graph,edges:[...graph.edges,{id:freshId(),from:node.id,to:graph.nodes.find(n=>n.id!==node.id)?.id??node.id,event:'answer',label:`Choice ${outgoing.filter(e=>e.event==='answer').length+1}`,values:[]}]})}>+ Add condition</button>
        <label className="field">Otherwise<select aria-label="Conditional fallback" value={outgoing.find(e=>e.event==='fallback')?.to??''} onChange={e=>setNext('fallback',e.target.value)}><option value="">End playback</option><option value={node.id}>Repeat this clip</option>{targets(node.id)}</select></label><p className="hint">Choices are queued and evaluated at the clip boundary. The first matching rule wins.</p></>:<label className="field">Next clip<select aria-label="Next clip" value={outgoing.find(e=>e.event==='next')?.to??''} onChange={e=>setNext('next',e.target.value)}><option value="">End playback</option>{targets()}</select></label>}
    </section>
    {item&&<><section className="story-section"><h3>Generation</h3><label className="field">Reference clip<select aria-label="Generation reference" value={node.referenceId??''} onChange={e=>editor.patch(node.id,{referenceId:e.target.value||undefined})}><option value="">Choose a reference</option>{targets(node.id)}</select></label><label className="field">Method<select aria-label="Generation method" value={item.method??'comfy'} onChange={e=>editor.jobs.edit(item.id,{method:e.target.value as 'comfy'|'comfy-extend'|'comfy-loop'})}><option value="comfy-extend">Extend previous clip</option><option value="comfy-loop">Seamless loop</option><option value="comfy">Bridge to next clip</option></select></label></section>
      <InterstitialEditor resultDetails={<GeneratedVideoInfo item={item} node={node} nodes={graph.nodes} items={items}/>} key={item.id} selected={item} controller={editor.jobs} engine={engine} info={info} status={status} active onPreviewPlay={()=>editor.player.pause()}/></>}
  </div>;
}
