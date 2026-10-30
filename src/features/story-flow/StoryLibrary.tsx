import { Film, GitBranch, GripVertical, LayoutTemplate, Repeat2, Upload, Captions, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StoryEditor } from './useStoryEditor';
import { builtInTemplates } from './templates';
import { assets } from '../project/assets';
import VideoFilmstrip from '../timeline/VideoFilmstrip';
import { TIMELINE_FPS } from '../../../shared/constants';
import { startLibraryDrag } from './libraryDrag';
import './library.css';

export default function StoryLibrary({editor}:{editor:StoryEditor}){
  const input=useRef<HTMLInputElement>(null);
  const preview=useRef<HTMLVideoElement>(null);
  useEffect(()=>editor.player.subscribe(()=>{if(editor.player.getSnapshot().playing)preview.current?.pause();}),[editor.player]);
  const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[selection,setSelection]=useState<string|null>(null),[dropping,setDropping]=useState(false);
  const library=editor.projects.getSnapshot().project?.library??[],selected=library.find(item=>item.assetId===selection)??library[0];
  const matches=(name:string)=>name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const media=library.filter(item=>matches(item.name));
  const kinds=(['simple','looped','conditional'] as const).filter(matches);
  const templates=[...builtInTemplates,...(editor.graph?.templates??[])].filter(item=>matches(item.name));
  const showMedia=['all','media'].includes(filter),showTypes=['all','interstitials'].includes(filter),showTemplates=['all','templates'].includes(filter);
  const count=(showMedia?media.length:0)+(showTypes?kinds.length:0)+(showTemplates?templates.length:0);
  const addHint=()=>editor.setNotice('Drag an interstitial or template onto the timeline to place it. Drop onto a clip or wire to attach it.');
  const importFiles=async(files:File[])=>{
    const videos=files.filter(file=>!(/\.vtt$/i.test(file.name)));
    if(videos.length)await editor.importVideos(videos);
    for(const file of files.filter(file=>/\.vtt$/i.test(file.name)))await editor.projects.setSubtitle(file);
  };
  return <section className={`story-library asset-library ${dropping?'is-dropping':''}`} aria-label="Asset library"
    onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.stopPropagation();setDropping(true);}}}
    onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDropping(false);}}
    onDrop={e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();e.stopPropagation();setDropping(false);void importFiles(Array.from(e.dataTransfer.files));}}>
    <div className="library-toolbar"><label className="library-search"><Search size={13}/><input aria-label="Search library" placeholder="Search assets & templates" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <button className="icon-button" title="Import videos or WebVTT subtitles" aria-label="Import assets" onClick={()=>input.current?.click()}><Upload size={15}/></button></div>
    <input ref={input} hidden multiple type="file" accept="video/*,.mkv,.mov,.webm,.mp4,.vtt" aria-label="Import videos as clips" onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';void importFiles(files);}}/>
    <select className="library-filter" aria-label="Library category" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All assets & templates</option><option value="media">Project media</option><option value="interstitials">Interstitials</option><option value="templates">Templates</option></select>
    <div className="library-preview">
      {selected&&selected.kind!=='subtitle'&&assets.url(selected.assetId)?<video ref={preview} key={selected.assetId} src={assets.url(selected.assetId)} controls preload="metadata" aria-label={`Preview ${selected.name}`} onPlay={()=>editor.player.pause()}/>:<div className="library-preview-empty"><Captions size={22}/><span>{selected?.name??'Import media to get started'}</span></div>}
    </div>
    <div className="library-preview-caption"><span title={selected?.name}>{selected?.name??'Project media'}</span>{selected&&selected.kind!=='subtitle'&&<button className="icon-button small" aria-label={`Add ${selected.name} as clip`} title="Add a separate clip" onClick={()=>editor.addAsset(selected.assetId)}><Plus size={14}/></button>}</div>
    <div className="library-items">
      {showMedia&&media.length>0&&<><h3>Project media <span>{media.length}</span></h3><div className="library-media">{media.map(item=>{
        const uses=editor.graph?.nodes.filter(n=>n.source?.assetId===item.assetId||editor.items.find(i=>i.id===n.interstitialId)?.result?.assetId===item.assetId).length??0;
        const seconds=((item.outFrame??(item.duration??0)*TIMELINE_FPS)-(item.inFrame??0))/TIMELINE_FPS;
        return <button key={item.assetId} className={selected?.assetId===item.assetId?'selected':''} data-asset-id={item.assetId} draggable={item.kind!=='subtitle'}
          aria-label={`Library asset ${item.name}`} aria-pressed={selected?.assetId===item.assetId} onClick={()=>setSelection(item.assetId)} onDoubleClick={()=>editor.addAsset(item.assetId)}
          onDragStart={e=>startLibraryDrag(e,{assetId:item.assetId})} title={item.kind==='subtitle'?'Subtitle track':'Drag to the timeline or double-click to add a clip'}>
          <span className="library-thumb">{item.kind==='subtitle'?<Captions size={20}/>:<VideoFilmstrip assetId={item.assetId} url={assets.url(item.assetId)??''} start={(item.inFrame??0)/TIMELINE_FPS} end={(item.outFrame??(item.duration??1)*TIMELINE_FPS)/TIMELINE_FPS}/>}</span>
          <span className="library-asset-name"><strong>{item.name}</strong><small>{item.kind==='generated'?'Generated':item.kind==='subtitle'?'Subtitles':'Video'}{seconds>0?` · ${seconds.toFixed(2)}s`:''} · {uses?`${uses} used`:'Unused'}</small></span><GripVertical size={12}/>
        </button>;
      })}</div></>}
      {showTypes&&kinds.length>0&&<><h3>Interstitials <span>Drag to timeline</span></h3><div className="story-library-types">{kinds.map(kind=><button key={kind} draggable onDragStart={e=>startLibraryDrag(e,{kind})} aria-label={`Add ${kind} interstitial`} title={`Drag ${kind} to a spot on the timeline. Enter adds at the selection.`} onClick={e=>e.detail===0?editor.add(kind,editor.selectedEdge??undefined):addHint()}>{kind==='simple'?<Film size={16}/>:kind==='looped'?<Repeat2 size={16}/>:<GitBranch size={16}/>}<span>{kind[0].toUpperCase()+kind.slice(1)}</span></button>)}</div></>}
      {showTemplates&&templates.length>0&&<><h3>Templates <span>{templates.length}</span></h3><div className="story-library-templates">{templates.map(template=><button key={template.id} draggable onDragStart={e=>startLibraryDrag(e,{templateId:template.id})} aria-label={`Add template ${template.name}`} title="Drag to a spot on the timeline. Enter adds at the selection." onClick={e=>e.detail===0?editor.insertTemplate(editor.graph?.templates.find(t=>t.id===template.id)??template.id,editor.selectedEdge??undefined):addHint()}><LayoutTemplate size={14}/><span>{template.name}</span><GripVertical size={13}/></button>)}</div></>}
      {!count&&<p className="hint">No matching assets or templates.</p>}
    </div>
    <p className="library-footer">{library.length} {library.length===1?'asset':'assets'} · Import or drag media to add separate clips.</p>
  </section>;
}
