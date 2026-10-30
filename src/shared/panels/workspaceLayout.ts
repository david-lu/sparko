import { useCallback, useEffect, useState, type SetStateAction } from 'react';

export type WorkspacePanelId = 'library' | 'inspector';
type Panel = { id: WorkspacePanelId; lane: number; visible: boolean; collapsed: boolean; size: number };
export type WorkspaceLayout = { panels: Panel[]; columns: [number, number] };
const defaults = (): WorkspaceLayout => ({ panels: [
  { id: 'library', lane: 0, visible: true, collapsed: false, size: .46 },
  { id: 'inspector', lane: 0, visible: true, collapsed: false, size: .54 },
], columns: [50, 50] });
const storageKey = 'sparko:panel-layout', lockKey = 'sparko:workspace-locked';
function readLayout(): WorkspaceLayout {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (value?.panels?.length === 2 && new Set(value.panels.map((p: Panel) => p.id)).size === 2 &&
      value.panels.every((p: Panel) => ['library', 'inspector'].includes(p.id) && [0, 1].includes(p.lane) && typeof p.visible === 'boolean' && typeof p.collapsed === 'boolean' && Number.isFinite(p.size) && p.size > 0) &&
      value.columns?.length === 2 && value.columns.every((n: number) => Number.isFinite(n) && n > 0)) return value;
  } catch { /* Use defaults when saved preferences are unavailable. */ }
  return defaults();
}

/** Window and the panel controls share one persisted workspace layout. */
export function useWorkspaceLayout() {
  const [layout,setLayout]=useState(readLayout);
  const [locked,setLocked]=useState(()=>{try{return localStorage.getItem(lockKey)==='true';}catch{return false;}});
  useEffect(()=>{try{localStorage.setItem(storageKey,JSON.stringify(layout));}catch{/* Keep session preferences. */}},[layout]);
  useEffect(()=>{try{localStorage.setItem(lockKey,String(locked));}catch{/* Keep session preferences. */}},[locked]);
  const updateLayout=useCallback((next:SetStateAction<WorkspaceLayout>)=>{if(!locked)setLayout(next);},[locked]);
  const togglePanel=(id:WorkspacePanelId)=>updateLayout(old=>({...old,panels:old.panels.map(p=>p.id===id?{...p,visible:!p.visible,collapsed:p.visible?p.collapsed:false}:p)}));
  return {layout,locked,setLocked,updateLayout,togglePanel,reset:()=>updateLayout(defaults())};
}
export type WorkspaceLayoutController=ReturnType<typeof useWorkspaceLayout>;
