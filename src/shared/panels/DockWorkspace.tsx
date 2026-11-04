import { useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { GripHorizontal, Maximize, PanelsTopLeft } from 'lucide-react';
import { PanelSplit } from './PanelSplit';
import { defaultDockLayout, dockGroup, dockTitles, mapDock, moveDock, removeDock, validDockLayout, type DockGroup, type DockId, type DockLayout, type DockNode, type DockSide } from './docking';
import './docking.css';
const key = 'sparko:free-panel-layout', dragType = 'application/x-sparko-panel';
export default function DockWorkspace({ items, locked }: { items: Record<DockId, ReactNode>; locked: boolean }) {
  const [layout, setLayout] = useState<DockLayout>(() => { try { const value = JSON.parse(localStorage.getItem(key) ?? 'null'); if (validDockLayout(value)) return value; } catch {} return defaultDockLayout(); });
  const [dragged, setDragged] = useState<DockId>(), [target, setTarget] = useState<{ id: string; side: DockSide }>(), [maximized, setMaximized] = useState<DockId>();
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(layout)); } catch {} }, [layout]);
  useEffect(() => { const cancel = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDragged(undefined); setTarget(undefined); setMaximized(undefined); } }; window.addEventListener('keydown', cancel); return () => window.removeEventListener('keydown', cancel); }, []);
  const change = (next: DockLayout | ((old: DockLayout) => DockLayout)) => { if (!locked) setLayout(next); };
  const float = (panel: DockId) => change(old => ({ root: removeDock(old.root, panel), floating: [...old.floating.filter(f => f.panel !== panel), { panel, x: 40, y: 70, width: Math.min(420, window.innerWidth - 24), height: Math.min(540, window.innerHeight - 94) }] }));
  const group = (node: DockGroup, floating = false) => <section key={node.id} className={`dock-group ${maximized === node.active ? 'dock-group-maximized' : ''} ${target?.id === node.id ? `dock-target-${target.side}` : ''}`} data-dock-group={node.id}
    onDragOver={e => { if (!dragged || locked || floating) return; e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      setTarget({ id: node.id, side: x < .2 ? 'left' : x > .8 ? 'right' : y < .2 ? 'top' : y > .8 ? 'bottom' : 'tab' }); }}
    onDrop={e => { if (!dragged || !target || locked || floating) return; e.preventDefault(); e.stopPropagation(); change(old => moveDock(old, dragged, target.id, target.side)); setDragged(undefined); setTarget(undefined); }}>
    <header className="dock-header"><div role="tablist" aria-label="Workspace panels">{node.tabs.map(tab => <button role="tab" aria-selected={node.active === tab} key={tab} draggable={!locked}
      onDragStart={(e: DragEvent) => { e.dataTransfer.setData(dragType, tab); setDragged(tab); }} onDragEnd={() => { setDragged(undefined); setTarget(undefined); }}
      onClick={() => setLayout(old => ({ ...old, root: mapDock(old.root, node.id, n => ({ ...n, active: tab } as DockNode)) }))}>{dockTitles[tab]}</button>)}</div>
      <button className="icon-button small" aria-label={`Maximize ${dockTitles[node.active]} panel`} onClick={() => setMaximized(maximized === node.active ? undefined : node.active)}><Maximize size={12}/></button>
      <button className="icon-button small" disabled={locked} aria-label={`${floating ? 'Dock' : 'Float'} ${dockTitles[node.active]} panel`} onClick={() => floating ? change(old => ({ root: old.root ? { type: 'split', id: crypto.randomUUID(), direction: 'row', sizes: [70, 30], children: [old.root, dockGroup(node.active)] } : dockGroup(node.active), floating: old.floating.filter(f => f.panel !== node.active) })) : float(node.active)}><PanelsTopLeft size={12}/></button>
    </header><div className="dock-content">{node.tabs.map(tab => <div className="dock-tab-content" key={tab} hidden={node.active !== tab}>{items[tab]}</div>)}</div>
  </section>;
  const render = (node: DockNode | null): ReactNode => !node ? <div className="dock-empty" onDragOver={e => { if (dragged) e.preventDefault(); }} onDrop={e => { if (dragged) { e.preventDefault(); change(old => ({ root: dockGroup(dragged), floating: old.floating.filter(f => f.panel !== dragged) })); setDragged(undefined); } }}>Dock a panel here</div> : node.type === 'group' ? group(node) : <PanelSplit key={node.id} className="dock-split" direction={node.direction} label="Resize docked panels" sizes={node.sizes} minSizes={node.direction === 'row' ? [180, 180] : [100, 100]}
    onSizesChange={sizes => change(old => ({ ...old, root: mapDock(old.root, node.id, n => ({ ...n, sizes } as DockNode)) }))}>{render(node.children[0])}{render(node.children[1])}</PanelSplit>;
  return <div className="dock-workspace"><div className="dock-main">{render(layout.root)}</div>
    {layout.floating.map(f => <div key={f.panel} className="dock-floating" style={{ left: Math.max(0, Math.min(f.x, window.innerWidth - Math.min(f.width, window.innerWidth))), top: Math.max(38, Math.min(f.y, window.innerHeight - 90)), width: Math.min(f.width, window.innerWidth - 16), height: Math.min(f.height, window.innerHeight - 54), resize: locked ? 'none' : 'both' }}
      onPointerUp={e => { if (locked) return; const r = e.currentTarget.getBoundingClientRect(); change(old => ({ ...old, floating: old.floating.map(v => v.panel === f.panel ? { ...v, width: r.width, height: r.height } : v) })); }}>
      <button className="dock-float-grip" aria-label={`Move floating ${dockTitles[f.panel]} panel`} disabled={locked}
        onKeyDown={e => { const delta = ({ ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] } as Record<string, number[]>)[e.key]; if (delta) { e.preventDefault(); change(old => ({ ...old, floating: old.floating.map(v => v.panel === f.panel ? { ...v, x: Math.max(0, v.x + delta[0]), y: Math.max(38, v.y + delta[1]) } : v) })); } }}
        onPointerDown={e => { if (locked) return; e.preventDefault(); const button = e.currentTarget, x = e.clientX, y = e.clientY; button.setPointerCapture(e.pointerId);
          const move = (event: PointerEvent) => change(old => ({ ...old, floating: old.floating.map(v => v.panel === f.panel ? { ...v, x: Math.max(0, Math.min(window.innerWidth - 100, f.x + event.clientX - x)), y: Math.max(38, Math.min(window.innerHeight - 70, f.y + event.clientY - y)) } : v) }));
          const end = () => { button.removeEventListener('pointermove', move); button.removeEventListener('pointerup', end); button.removeEventListener('pointercancel', end); };
          button.addEventListener('pointermove', move); button.addEventListener('pointerup', end); button.addEventListener('pointercancel', end);
        }}><GripHorizontal size={14}/></button>{group({ type: 'group', id: `floating-${f.panel}`, tabs: [f.panel], active: f.panel }, true)}
    </div>)}
  </div>;
}
