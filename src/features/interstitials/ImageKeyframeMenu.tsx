import { useLayoutEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { useExclusiveMenu, useMenuScrollDismiss } from '../../shared/DropdownMenu';

export default function ImageKeyframeMenu({ x, y, enabled, deleteLabel, onToggle, onDelete, onClose, restoreFocus }: {
  x: number; y: number; enabled?: boolean; deleteLabel: string; onToggle?: () => void;
  onDelete: () => void; onClose: () => void; restoreFocus: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  useExclusiveMenu(element, true, onClose, restoreFocus);
  useMenuScrollDismiss(element, onClose);
  useLayoutEffect(() => {
    const menu = element.current!;
    menu.showPopover();
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - box.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - box.height - 8))}px`;
    menu.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [x, y]);
  return <div ref={element} popover="manual" className="generation-image-menu" role="menu" aria-label="Image keyframe actions"
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }}>
    {onToggle && <button type="button" role="menuitem" onClick={onToggle}>{enabled ? 'Disable keyframe' : 'Enable keyframe'}</button>}
    <button type="button" role="menuitem" className="generation-image-delete" onClick={onDelete}><Trash2 size={14}/>{deleteLabel}</button>
  </div>;
}
