import { expect, it } from 'vitest';
import { defaultDockLayout, moveDock, removeDock, validDockLayout, type DockNode } from '../../src/shared/panels/docking';
const group = (node: DockNode, panel: string): string | undefined => node.type === 'group' ? node.tabs.includes(panel as never) ? node.id : undefined : node.children.map(c => group(c, panel)).find(Boolean);
it('moves player and timeline onto any side or tab without losing or duplicating panels', () => {
  for (const side of ['left', 'right', 'top', 'bottom', 'tab'] as const) {
    const layout = defaultDockLayout(), moved = moveDock(layout, 'viewer', group(layout.root!, 'inspector')!, side);
    expect(validDockLayout(moved)).toBe(true);
    expect(group(moved.root!, 'viewer')).toBeDefined();
  }
});
it('supports a floating panel and rejects corrupted saved workspaces', () => {
  const layout = defaultDockLayout(); layout.root = removeDock(layout.root, 'timeline');
  layout.floating = [{ panel: 'timeline', x: 10, y: 20, width: 400, height: 300 }];
  expect(validDockLayout(layout)).toBe(true);
  expect(validDockLayout(moveDock(layout, 'timeline', group(layout.root!, 'library')!, 'bottom'))).toBe(true);
  layout.floating.push({ ...layout.floating[0] }); expect(validDockLayout(layout)).toBe(false);
});
