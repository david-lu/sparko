import { Film, GripVertical, LayoutTemplate, Search } from 'lucide-react';
import { useState } from 'react';
import type { StoryEditor } from './useStoryEditor';
import { builtInTemplates } from './templates';
import { startLibraryDrag } from './libraryDrag';
import './add-clips.css';

export default function StoryAddClips({editor}:{editor:StoryEditor}) {
  const [query,setQuery]=useState('');
  const matches=(name:string)=>name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const showInterstitial=matches('Video');
  const templates=[...builtInTemplates,...(editor.graph?.templates??[])].filter(template=>matches(template.name));
  const hint=()=>editor.setNotice('Drag a video or template onto the timeline to place it. Drop onto a clip or wire to attach it.');
  return <section className="add-clips-panel" aria-label="Videos and templates">
    <label className="library-search"><Search size={13} aria-hidden/><input aria-label="Search videos and templates" placeholder="Search videos & templates" value={query} onChange={event=>setQuery(event.target.value)}/></label>
    <p className="add-clips-hint">Drag to place · Enter adds at the selection.</p>
    {showInterstitial&&<div className="add-clips-section"><h3>Videos</h3>
      <button className="add-clip-card" draggable aria-label="Add video" title="Drag to place a video. Enter adds at the selection."
        onDragStart={event=>startLibraryDrag(event,{kind:'simple'})} onClick={event=>event.detail===0?editor.add('simple',editor.selectedEdge??undefined):hint()}>
        <Film size={16} aria-hidden/><span>Video</span><GripVertical size={13} aria-hidden/>
      </button>
    </div>}
    {templates.length>0&&<div className="add-clips-section"><h3>Templates <span>{templates.length}</span></h3>
      {templates.map(template=><button className="add-clip-card" key={template.id} draggable aria-label={`Add template ${template.name}`}
        title={`${'description' in template?template.description:'Saved in this project.'} Drag to place. Enter adds at the selection.`} onDragStart={event=>startLibraryDrag(event,{templateId:template.id})}
        onClick={event=>event.detail===0?editor.insertTemplate(editor.graph?.templates.find(saved=>saved.id===template.id)??template.id,editor.selectedEdge??undefined):hint()}>
        <LayoutTemplate size={16} aria-hidden/><span>{template.name}</span><GripVertical size={13} aria-hidden/>
      </button>)}
    </div>}
    {!showInterstitial&&!templates.length&&<p className="hint">No matching videos or templates.</p>}
  </section>;
}
