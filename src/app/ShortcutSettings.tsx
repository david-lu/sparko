import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { defaultBindings, formatShortcut, saveBindings, shortcutActions, shortcutConflict, shortcutFromEvent, useShortcuts, type ShortcutId } from '../shared/shortcuts';
import './shortcuts.css';

export default function ShortcutSettings({onClose}:{onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),{bindings}=useShortcuts();
  const [query,setQuery]=useState(''),[recording,setRecording]=useState<{id:ShortcutId;slot:number}|null>(null),[message,setMessage]=useState('Changes save automatically.');
  useEffect(()=>{const element=dialog.current!;element.showModal();return()=>element.close();},[]);
  const assign=(id:ShortcutId,slot:number,value:string)=>{const next=[...bindings[id]];while(next.length<=slot)next.push('');next[slot]=value;saveBindings({...bindings,[id]:next});};
  const rows=shortcutActions.filter(action=>`${action.label} ${action.group}`.toLowerCase().includes(query.toLowerCase()));
  return <dialog ref={dialog} className="shortcut-settings" aria-labelledby="shortcut-title" onCancel={event=>{event.preventDefault();if(recording){setRecording(null);setMessage('Assignment cancelled.');}else onClose();}} onKeyDown={event=>{
    event.stopPropagation();if(!recording||event.key==='Escape'||event.key==='Tab')return;
    event.preventDefault();if(event.repeat||event.nativeEvent.isComposing)return;
    const key=shortcutFromEvent(event.nativeEvent);if(!key)return;
    const conflict=shortcutConflict(bindings,key,recording.id,recording.slot);
    if(conflict){setMessage(`${formatShortcut(key)} is assigned to ${conflict.label}. Choose another key or clear that assignment.`);return;}
    assign(recording.id,recording.slot,key);setMessage(`${shortcutActions.find(a=>a.id===recording.id)!.label}: ${formatShortcut(key)} saved.`);setRecording(null);
  }}>
    <header><h2 id="shortcut-title">Keyboard shortcuts</h2><button className="icon-button" aria-label="Close keyboard shortcuts" onClick={onClose}><X size={18}/></button></header>
    <input autoFocus aria-label="Filter shortcuts" placeholder="Search commands…" value={query} onChange={event=>{setQuery(event.target.value);setRecording(null);}}/>
    <p className="shortcut-help">Click a binding, then press your keys. Escape cancels. Ctrl and Cmd share assignments.</p>
    <p className="shortcut-feedback" role="status">{message}</p>
    <div className="shortcut-list">{rows.map((action,index)=><div key={action.id}>
      {(index===0||rows[index-1].group!==action.group)&&<h3>{action.group}</h3>}
      <div className="shortcut-row"><span title={'description' in action?action.description:undefined}>{action.label}</span><div className="shortcut-bindings">{[0,1].map(slot=><div className="shortcut-slot" key={slot}>
        <button className={`shortcut-binding ${recording?.id===action.id&&recording.slot===slot?'recording':''}`} title={bindings[action.id][slot]?formatShortcut(bindings[action.id][slot]):'Unassigned'} aria-label={`${slot?'Alternate shortcut':'Shortcut'} for ${action.label}`} aria-pressed={recording?.id===action.id&&recording.slot===slot} onBlur={()=>{if(recording?.id===action.id&&recording.slot===slot){setRecording(null);setMessage('Assignment cancelled.');}}} onClick={()=>{setRecording({id:action.id,slot});setMessage(`Press a key combination for ${action.label}. Escape cancels.`);}}>
          {recording?.id===action.id&&recording.slot===slot?'Press keys…':bindings[action.id][slot]?formatShortcut(bindings[action.id][slot]):'Unassigned'}
        </button><button className="icon-button small" aria-label={`Clear ${slot?'alternate shortcut':'shortcut'} for ${action.label}`} disabled={!bindings[action.id][slot]} onClick={()=>{assign(action.id,slot,'');setMessage(`${action.label} assignment cleared.`);}}><X size={12}/></button>
      </div>)}</div></div>
    </div>)}{!rows.length&&<p className="shortcut-empty">No matching commands.</p>}</div>
    <footer><span>Space + drag pans the timeline. F fits the selection by default.</span><button className="button small" onClick={()=>{saveBindings(defaultBindings());setRecording(null);setMessage('Default shortcuts restored.');}}>Reset defaults</button><button className="button primary small" onClick={onClose}>Done</button></footer>
  </dialog>;
}
