import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export default function BehaviorSection({name,enabled,onToggle,children}:{name:'Loop'|'Conditional';enabled:boolean;onToggle:(enabled:boolean)=>void;children:ReactNode}){
  const id=useId(),[expanded,setExpanded]=useState(enabled);
  useEffect(()=>{if(enabled)setExpanded(true);},[enabled]);
  const open=enabled&&expanded;
  return <section className="inspector-behavior" aria-label={`${name} behavior`} data-enabled={enabled}>
    <div className="inspector-behavior-heading">
      <button type="button" className="behavior-disclosure" aria-label={`${open?'Collapse':'Expand'} ${name} settings`} aria-expanded={open} aria-controls={id} disabled={!enabled} onClick={()=>setExpanded(!expanded)}><ChevronRight size={12}/></button>
      <label><input type="checkbox" checked={enabled} onChange={e=>onToggle(e.target.checked)}/><span>{name}</span></label><small aria-hidden>{enabled?'On':'Off'}</small>
    </div>
    <div id={id} className="inspector-behavior-body" role="region" aria-label={`${name} settings`} hidden={!open}>{children}</div>
  </section>;
}
