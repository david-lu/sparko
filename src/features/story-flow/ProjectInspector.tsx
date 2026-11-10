import ProjectLoras from '../project/ProjectLoras';
import ProjectPromptInstructions from '../project/ProjectPromptInstructions';
import ProjectCharacters from '../project/ProjectCharacters';
import type { AppStatus } from '../../../shared/contracts';
import { Flag, LocateFixed, Video } from 'lucide-react';
import { useState } from 'react';
import { TIMELINE_FPS } from '../../../shared/constants';
import { playableResult } from '../../../shared/interstitials';
import AssetThumbnail from '../project/AssetThumbnail';
import { nodeDuration } from './model';
import { readLibraryDrag, STORY_DRAG_TYPE } from './libraryDrag';
import type { StoryEditor } from './useStoryEditor';
import './project-inspector.css';

export default function ProjectInspector({editor,status}:{editor:StoryEditor;status:AppStatus|null}) {
  const [dragging,setDragging]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const project=editor.projects.getSnapshot().project,graph=editor.graph;
  if(!project||!graph)return null;
  const start=graph.nodes.find(n=>n.id===graph.entryId),item=editor.items.find(i=>i.id===start?.interstitialId),result=item&&playableResult(item);
  const assetId=start?.source?.assetId??result?.assetId??result?.fullAssetId;
  const asset=assetId?{...project.library?.find(a=>a.assetId===assetId),assetId,kind:start?.source?.kind === 'image' ? 'image' as const : 'video' as const,
    ...(start?.source?{inFrame:start.source.inFrame,outFrame:start.source.outFrame}:{})}:undefined;
  return <section className="story-inspector project-inspector" aria-label="Project settings" data-project-edit>
    <h2>Project settings</h2>
    <p className="project-inspector-name" title={project.name}>{project.name}</p>
    <div className="project-entry-heading"><Flag size={13}/><h3>Start video</h3></div>
    <p className="hint">The experience begins with this timeline clip.</p>
    <div className={`project-entry-input${dragging||editor.clipDrag?.overStart?' is-dragging':''}`} role="group" aria-label="Start video" aria-busy={busy}
      data-project-start-drop data-disabled={busy||editor.projects.getSnapshot().busy}
      onDragOver={e=>{e.preventDefault();e.stopPropagation();const accepts=e.dataTransfer.types.includes(STORY_DRAG_TYPE)&&!busy;
        e.dataTransfer.dropEffect=accepts?'copy':'none';setDragging(accepts);}}
      onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setDragging(false);}}
      onDrop={e=>{
        e.preventDefault();e.stopPropagation();setDragging(false);if(busy)return;
        const payload=readLibraryDrag(e.dataTransfer),id=payload&&'assetId' in payload?payload.assetId:undefined;
        if(!id){setError('Drag a timeline clip or a completed Library video here.');return;}
        setError('');setBusy(true);
        void editor.setStartAsset(id).catch(cause=>setError(cause instanceof Error?cause.message:'Unable to change the start video.')).finally(()=>setBusy(false));
      }}>
      <div className="project-entry-preview">
        {start?<><AssetThumbnail asset={asset} kind={asset?.kind ?? 'video'} name={start.name}/><div><strong title={start.name}>{start.name}</strong><span>{nodeDuration(start,editor.items).toFixed(2)} s · {item?(result?'Generated video':'Draft video'):start.source?.kind==='image'?'Still image':'Video'}</span></div></>
          :<><Video size={23}/><div><strong>No start video</strong><span>Add a video or image to begin</span></div></>}
      </div>
      <span className={`project-entry-instruction${error?' has-error':''}`} role="status" aria-atomic="true" title={error||undefined} tabIndex={error?0:undefined}>
        {busy?'Adding video…':dragging||editor.clipDrag?.overStart?'Drop to set the start video':error||'Drag a timeline clip or Library video here'}
      </span>
    </div>
    <button type="button" className="button project-entry-reveal" disabled={!start||busy} onClick={()=>start&&editor.selectNew(start.id)}><LocateFixed size={13}/>Show in timeline</button>
    <ProjectLoras key={`${project.id}:${editor.projects.getSnapshot().activationRevision}`} projects={editor.projects}/>
    <ProjectPromptInstructions projects={editor.projects}/>
    <ProjectCharacters projects={editor.projects} status={status}/>
    <dl className="project-inspector-summary"><div><dt>Videos</dt><dd>{graph.nodes.length}</dd></div><div><dt>Frame rate</dt><dd>{TIMELINE_FPS} fps</dd></div></dl>
  </section>;
}
