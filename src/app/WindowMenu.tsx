import { useRef } from 'react';
import DropdownMenu from '../shared/DropdownMenu';
import { Check, Lock, RotateCcw } from 'lucide-react';
import type { WorkspaceLayoutController } from '../shared/panels/workspaceLayout';

export default function WindowMenu({workspace,timelineVisible,onTimeline,onReset,panelsAvailable}:{
  workspace:WorkspaceLayoutController;timelineVisible:boolean;onTimeline:()=>void;onReset:()=>void;panelsAvailable:boolean;
}) {
  const menu=useRef<HTMLDetailsElement>(null);
  const close=()=>{if(menu.current)menu.current.open=false;};
  const disabled=workspace.locked||!panelsAvailable;
  return <DropdownMenu ref={menu} className="file-menu window-menu" onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();menu.current?.querySelector('summary')?.focus();return;}
    if(event.key===' '){event.stopPropagation();return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    if(event.target===event.currentTarget.querySelector('summary')){event.currentTarget.open=true;buttons[event.key==='ArrowUp'||event.key==='End'?buttons.length-1:0]?.focus();return;}
    const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
  }}>
    <summary aria-haspopup="menu" title={workspace.locked?'Window — workspace locked':'Window'}>Window<Lock size={11} aria-hidden="true" style={{visibility:workspace.locked?'visible':'hidden'}}/></summary>
    <div className="menu-items" role="menu" aria-label="Window">
      {workspace.layout.panels.map(panel=><button key={panel.id} role="menuitemcheckbox" aria-checked={panel.visible} disabled={disabled} onClick={()=>workspace.togglePanel(panel.id)}>
        <Check size={14} aria-hidden="true" style={{visibility:panel.visible?'visible':'hidden'}}/>{panel.id==='library'?'Library':'Inspector'}
      </button>)}
      <button role="menuitemcheckbox" aria-checked={timelineVisible} disabled={disabled} onClick={onTimeline}><Check size={14} aria-hidden="true" style={{visibility:timelineVisible?'visible':'hidden'}}/>Timeline</button>
      <div role="separator"/>
      <button role="menuitemcheckbox" aria-checked={workspace.locked} title="Keep panel positions, sizes and visibility fixed" onClick={()=>workspace.setLocked(!workspace.locked)}><Check size={14} aria-hidden="true" style={{visibility:workspace.locked?'visible':'hidden'}}/>Lock workspace</button>
      <button role="menuitem" disabled={workspace.locked} onClick={()=>{onReset();close();menu.current?.querySelector('summary')?.focus();}}><RotateCcw size={14} aria-hidden="true"/>Reset workspace</button>
    </div>
  </DropdownMenu>;
}
