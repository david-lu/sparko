import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useExclusiveMenu } from '../../shared/DropdownMenu';

export default function LibraryContextMenu({ x, y, label, onClose, restoreFocus, children }: {
  x: number; y: number; label: string; onClose: () => void; restoreFocus: () => void; children: ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  useExclusiveMenu(element, true, onClose, restoreFocus);
  useLayoutEffect(() => {
    const menu = element.current!;
    const position = () => { const r = menu.getBoundingClientRect(); menu.style.left = `${Math.max(8, Math.min(x || 8, window.innerWidth - r.width - 8))}px`; menu.style.top = `${Math.max(8, Math.min(y || 8, window.innerHeight - r.height - 8))}px`; };
    position(); const observer = new ResizeObserver(position); observer.observe(menu);
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    window.addEventListener('resize', position);
    return () => { observer.disconnect(); window.removeEventListener('resize', position); };
  }, [x, y]);
  return createPortal(<div ref={element} className="library-context-menu" role="menu" aria-label={label} style={{ left: x || 8, top: y || 8 }}
    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
    onKeyDown={e => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>{children}</div>, document.fullscreenElement ?? document.body);
}
