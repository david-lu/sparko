export type DockId = 'viewer' | 'timeline' | 'library' | 'create' | 'inspector';
export const dockTitles: Record<DockId, string> = { viewer: 'Player', timeline: 'Timeline', library: 'Library', create: 'Add clips', inspector: 'Inspector' };
export type DockGroup = { type: 'group'; id: string; tabs: DockId[]; active: DockId };
export type DockNode = DockGroup | { type: 'split'; id: string; direction: 'row' | 'column'; sizes: [number, number]; children: [DockNode, DockNode] };
export type DockSide = 'left' | 'right' | 'top' | 'bottom' | 'tab';
export type FloatingPanel = { panel: DockId; x: number; y: number; width: number; height: number };
export type DockLayout = { root: DockNode | null; floating: FloatingPanel[] };
export const dockGroup = (panel: DockId): DockGroup => ({ type: 'group', id: crypto.randomUUID(), tabs: [panel], active: panel });
export const defaultDockLayout = (): DockLayout => ({ root: { type: 'split', id: 'root', direction: 'row', sizes: [72, 28], children: [
  { type: 'split', id: 'main', direction: 'column', sizes: [65, 35], children: [dockGroup('viewer'), dockGroup('timeline')] },
  { type: 'split', id: 'side', direction: 'column', sizes: [40, 60], children: [{ ...dockGroup('library'), tabs: ['library', 'create'] }, dockGroup('inspector')] },
] }, floating: [] });
export function mapDock(node: DockNode | null, id: string, update: (node: DockNode) => DockNode): DockNode | null {
  if (!node) return null;
  if (node.id === id) return update(node);
  return node.type === 'group' ? node : { ...node, children: node.children.map(child => mapDock(child, id, update)!) as [DockNode, DockNode] };
}
export function removeDock(node: DockNode | null, panel: DockId): DockNode | null {
  if (!node) return null;
  if (node.type === 'group') { const tabs = node.tabs.filter(t => t !== panel); return tabs.length ? { ...node, tabs, active: tabs.includes(node.active) ? node.active : tabs[0] } : null; }
  const [a, b] = node.children.map(n => removeDock(n, panel));
  return a && b ? { ...node, children: [a, b] } : a ?? b;
}
export function moveDock(layout: DockLayout, panel: DockId, target: string, side: DockSide): DockLayout {
  const root = removeDock(layout.root, panel), floating = layout.floating.filter(f => f.panel !== panel);
  let found = false;
  const next = mapDock(root, target, node => {
    found = true;
    if (side === 'tab' && node.type === 'group') return { ...node, tabs: [...node.tabs, panel], active: panel };
    const first = side === 'left' || side === 'top';
    return { type: 'split', id: crypto.randomUUID(), direction: side === 'left' || side === 'right' ? 'row' : 'column', sizes: [50, 50], children: first ? [dockGroup(panel), node] : [node, dockGroup(panel)] };
  });
  if (!root) return { root: dockGroup(panel), floating };
  return found ? { root: next, floating } : layout;
}
export function validDockLayout(value: unknown): value is DockLayout {
  if (!value || typeof value !== 'object') return false;
  const v = value as DockLayout, panels: string[] = [], ids = new Set<string>();
  function valid(node: DockNode | null, depth: number): boolean {
    if (!node) return depth === 0;
    if (depth > 12 || typeof node.id !== 'string' || ids.has(node.id)) return false;
    ids.add(node.id);
    if (node.type === 'group') { if (!Array.isArray(node.tabs) || !node.tabs.length || !node.tabs.includes(node.active)) return false; panels.push(...node.tabs); return true; }
    return node.type === 'split' && ['row', 'column'].includes(node.direction) && Array.isArray(node.sizes) && node.sizes.length === 2 && node.sizes.every(n => Number.isFinite(n) && n > 0) && Array.isArray(node.children) && node.children.length === 2 && node.children.every(c => valid(c, depth + 1));
  }
  if (!valid(v.root, 0) || !Array.isArray(v.floating) || !v.floating.every(f => { panels.push(f.panel); return [f.x, f.y, f.width, f.height].every(Number.isFinite) && f.width >= 150 && f.height >= 100; })) return false;
  return panels.length === 5 && new Set(panels).size === 5 && panels.every(p => Object.hasOwn(dockTitles, p));
}
