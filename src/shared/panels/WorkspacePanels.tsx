import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CollapsiblePanelStack, type CollapsiblePanelItem } from './CollapsiblePanelStack';
import { PanelSplit } from './PanelSplit';
import type { WorkspaceLayoutController } from './workspaceLayout';
import './panels.css';
import DropdownMenu from '../DropdownMenu';

/** Same stack/adjacent-column docking used by the animation editor. */
export default function WorkspacePanels({ library, inspector, narrow, onColumns, onReset, inspectorRevision = 0,workspace }: {
  library: ReactNode; inspector: ReactNode; inspectorRevision?: number; narrow: boolean; onColumns: (count: number) => void; onReset: () => void;
  workspace:WorkspaceLayoutController;
}) {
  const {layout,updateLayout:setLayout,locked}=workspace;
  const lastInspectorRevision=useRef(inspectorRevision);
  useEffect(() => { if(lastInspectorRevision.current===inspectorRevision)return;lastInspectorRevision.current=inspectorRevision;
    if(!locked)setLayout(old => ({...old,panels:old.panels.map(p=>p.id==='inspector'?{...p,visible:true,collapsed:false}:p)})); }, [inspectorRevision,locked,setLayout]);
  const [preview, setPreview] = useState<{ lane: number; before: string | null } | null>(null);
  const resolvers = useRef<Record<number, ((y: number) => string | null) | null>>({});
  const menu = useRef<HTMLDetailsElement>(null);
  const items: CollapsiblePanelItem[] = [{ id: 'library', title: 'Library', content: library }, { id: 'inspector', title: 'Inspector', content: inspector }];
  const visible = layout.panels.filter(p => p.visible);
  const lanes = narrow ? [0] : [0, 1].filter(lane => visible.some(p => p.lane === lane));
  const columnCount = lanes.length;
  useEffect(() => onColumns(columnCount), [columnCount, onColumns]);
  const update = (id: string, patch: {visible:boolean}) => setLayout(old => ({ ...old, panels: old.panels.map(p => p.id === id ? { ...p, ...patch } : p) }));
  const move = (id: string, lane: number, before: string | null) => {
    setPreview(null);
    setLayout(old => {
      const item = old.panels.find(p => p.id === id)!;
      const panels = old.panels.filter(p => p.id !== id);
      const index = before ? panels.findIndex(p => p.id === before) : -1;
      panels.splice(index < 0 ? panels.length : index, 0, { ...item, lane });
      return { ...old, panels };
    });
  };
  const renderLane = (lane: number) => {
    const panels = visible.filter(p => narrow || p.lane === lane);
    return <div className="sidePanelLane" data-lane={lane} key={lane}>
      <CollapsiblePanelStack items={panels.map(p => items.find(item => item.id === p.id)!)} orderedIds={panels.map(p => p.id)}
        collapsedById={Object.fromEntries(panels.map(p => [p.id, p.collapsed]))} sizesById={Object.fromEntries(panels.map(p => [p.id, p.size]))}
        onOrderedIdsChange={ids => setLayout(old => ({ ...old, panels: [...ids.map(id => old.panels.find(p => p.id === id)!), ...old.panels.filter(p => !ids.includes(p.id))] }))}
        onCollapsedByIdChange={values => setLayout(old => ({ ...old, panels: old.panels.map(p => ({ ...p, collapsed: values[p.id] ?? p.collapsed })) }))}
        onSizesByIdChange={values => setLayout(old => ({ ...old, panels: old.panels.map(p => ({ ...p, size: values[p.id] ?? p.size })) }))}
        onItemDismiss={id => update(id, { visible: false })}
        onItemMoveToAdjacentLane={(id, direction, y) => {
          const target = lane + (direction === 'left' ? -1 : 1);
          if (narrow || target < 0 || target > 1) { setPreview(null); return; }
          move(id, target, resolvers.current[target]?.(y) ?? null);
        }}
        onItemPreviewAdjacentLane={(_, direction, y) => {
          const target = lane + (direction === 'left' ? -1 : 1);
          if (narrow || !lanes.includes(target)) { setPreview(null); return false; }
          setPreview({ lane: target, before: resolvers.current[target]?.(y) ?? null }); return true;
        }}
        onItemCancelAdjacentLanePreview={() => setPreview(null)} externalInsertionBeforeId={preview?.lane === lane ? preview.before : undefined}
        onInsertionResolverChange={resolver => { resolvers.current[lane] = resolver; }} />
    </div>;
  };
  return <div className="workspace-panels">
    <div className="panel-workspace-bar"><span>Workspace</span><DropdownMenu ref={menu} className="panel-workspace-menu"><summary>Panels</summary><div>
      {items.map(item => <button key={item.id} disabled={locked} aria-pressed={layout.panels.find(p => p.id === item.id)?.visible} onClick={() => { update(item.id, { visible: !layout.panels.find(p => p.id === item.id)?.visible }); }}>{item.title}</button>)}
      <button disabled={locked} onClick={() => { setPreview(null); onReset(); if (menu.current) menu.current.open = false; }}>Reset workspace</button>
    </div></DropdownMenu></div>
    {!visible.length ? <div className="panels-empty">Open a panel from the Panels menu.</div> : lanes.length === 2 ?
      <PanelSplit className="sidePanelColumns" direction="row" label="Library and Inspector columns" sizes={layout.columns} minSizes={[200, 200]} onSizesChange={columns => setLayout(old => ({ ...old, columns }))}>
        {renderLane(0)}{renderLane(1)}
      </PanelSplit> : <div className="sidePanelColumns">{lanes.map(renderLane)}</div>}
  </div>;
}
