import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CollapsiblePanelStack, type CollapsiblePanelItem } from './CollapsiblePanelStack';
import { PanelSplit } from './PanelSplit';
import './panels.css';

type Panel = { id: string; lane: number; visible: boolean; collapsed: boolean; size: number };
type Layout = { panels: Panel[]; columns: [number, number] };
const defaults = (): Layout => ({ panels: [
  { id: 'library', lane: 0, visible: true, collapsed: false, size: .46 },
  { id: 'inspector', lane: 0, visible: true, collapsed: false, size: .54 },
], columns: [50, 50] });
const storageKey = 'sparko:panel-layout';
function readLayout(): Layout {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (value?.panels?.length === 2 && new Set(value.panels.map((p: Panel) => p.id)).size === 2 &&
      value.panels.every((p: Panel) => ['library', 'inspector'].includes(p.id) && [0, 1].includes(p.lane) && typeof p.visible === 'boolean' && typeof p.collapsed === 'boolean' && Number.isFinite(p.size) && p.size > 0) &&
      value.columns?.length === 2 && value.columns.every((n: number) => Number.isFinite(n) && n > 0)) return value;
  } catch { /* Use the default workspace when preferences are unavailable. */ }
  return defaults();
}

/** Same stack/adjacent-column docking used by the animation editor. */
export default function WorkspacePanels({ library, inspector, narrow, onColumns, onReset, inspectorRevision = 0 }: {
  library: ReactNode; inspector: ReactNode; inspectorRevision?: number; narrow: boolean; onColumns: (count: number) => void; onReset: () => void;
}) {
  const [layout, setLayout] = useState(readLayout);
  useEffect(() => { if (inspectorRevision) setLayout(old => ({...old,panels:old.panels.map(p=>p.id==='inspector'?{...p,visible:true,collapsed:false}:p)})); }, [inspectorRevision]);
  const [preview, setPreview] = useState<{ lane: number; before: string | null } | null>(null);
  const resolvers = useRef<Record<number, ((y: number) => string | null) | null>>({});
  const menu = useRef<HTMLDetailsElement>(null);
  const items: CollapsiblePanelItem[] = [{ id: 'library', title: 'Library', content: library }, { id: 'inspector', title: 'Inspector', content: inspector }];
  const visible = layout.panels.filter(p => p.visible);
  const lanes = narrow ? [0] : [0, 1].filter(lane => visible.some(p => p.lane === lane));
  const columnCount = lanes.length;
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(layout)); } catch { /* Session layout still works. */ } }, [layout]);
  useEffect(() => onColumns(columnCount), [columnCount, onColumns]);
  const update = (id: string, patch: Partial<Panel>) => setLayout(old => ({ ...old, panels: old.panels.map(p => p.id === id ? { ...p, ...patch } : p) }));
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
    <div className="panel-workspace-bar"><span>Workspace</span><details ref={menu} className="panel-workspace-menu"><summary>Panels</summary><div>
      {items.map(item => <button key={item.id} aria-pressed={layout.panels.find(p => p.id === item.id)?.visible} onClick={() => { update(item.id, { visible: !layout.panels.find(p => p.id === item.id)?.visible }); }}>{item.title}</button>)}
      <button onClick={() => { setLayout(defaults()); setPreview(null); onReset(); if (menu.current) menu.current.open = false; }}>Reset workspace</button>
    </div></details></div>
    {!visible.length ? <div className="panels-empty">Open a panel from the Panels menu.</div> : lanes.length === 2 ?
      <PanelSplit className="sidePanelColumns" direction="row" label="Library and Inspector columns" sizes={layout.columns} minSizes={[200, 200]} onSizesChange={columns => setLayout(old => ({ ...old, columns }))}>
        {renderLane(0)}{renderLane(1)}
      </PanelSplit> : <div className="sidePanelColumns">{lanes.map(renderLane)}</div>}
  </div>;
}
