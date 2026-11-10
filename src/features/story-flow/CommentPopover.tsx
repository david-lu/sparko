import { Check, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StoryComment } from './model';
import { COMMENT_TEXT_LIMIT } from './comments';
import { clipColors, clipColorName, type ClipColor } from './clipColors';

const colors = [undefined, ...Object.keys(clipColors) as ClipColor[]];

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * A non-modal editor beside its pin. Clicking elsewhere keeps typed text, as
 * clip and group names do on blur; Escape discards it.
 */
export default function CommentPopover({ comment, pin, location, color, onColor, onSeek, onSave, onResolve, onDelete, onClose }: {
  comment?: StoryComment;
  pin: () => HTMLElement | null;
  location: string;
  /** Missing means the default light pin. */
  color?: ClipColor;
  onColor: (color: ClipColor | undefined) => void;
  onSeek?: () => void;
  onSave: (text: string) => void;
  onResolve?: (resolved: boolean) => void;
  onDelete?: () => void;
  onClose: (restoreFocus: boolean) => void;
}) {
  const titleId = useId(), surface = useRef<HTMLElement>(null), input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(comment?.text ?? '');
  const changed = !!text.trim() && text.trim() !== comment?.text;
  const finish = useRef<(save: boolean, restoreFocus: boolean) => void>(() => {}), finished = useRef(false);
  // One outside click can report both pointerdown and focusin; save only once.
  finish.current = (save, restoreFocus) => { if (finished.current) return; finished.current = true; if (save && changed) onSave(text); onClose(restoreFocus); };
  // Follow the pin as the timeline pans, zooms and resizes.
  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    const place = () => {
      const anchor = pin()?.getBoundingClientRect(), bounds = element.getBoundingClientRect();
      if (!anchor) return;
      // Beside the pin when there is room, otherwise below (or above) it, never over it.
      let left = anchor.right + 8, top = anchor.top - 6;
      if (left + bounds.width > window.innerWidth - 8) left = anchor.left - 8 - bounds.width;
      if (left < 8) {
        left = anchor.left; top = anchor.bottom + 8;
        if (top + bounds.height > window.innerHeight - 8) top = anchor.top - 8 - bounds.height;
      }
      element.style.left = `${Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8))}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  });
  useEffect(() => {
    const field = input.current;
    field?.focus({ preventScroll: true });
    field?.setSelectionRange(field.value.length, field.value.length);
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (!target || surface.current?.contains(target) || pin()?.contains(target)) return;
      finish.current(true, false);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside, true); };
  }, []);
  const created = comment && new Date(comment.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return createPortal(<section ref={surface} className="story-comment-popover" role="dialog" aria-labelledby={titleId} data-resolved={!!comment?.resolved}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish.current(false, true); }
      else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); finish.current(true, true); }
    }}>
    <header>
      <div className="story-comment-heading">
        <h3 id={titleId}>{comment ? comment.resolved ? 'Resolved comment' : 'Comment' : 'New comment'}</h3>
        {onSeek ? <button type="button" className="story-comment-location" title="Move the playhead to this moment" onClick={onSeek}>{location}</button>
          : <span className="story-comment-location">{location}</span>}
      </div>
      {comment && onResolve && <button type="button" className="icon-button small" aria-label={comment.resolved ? 'Reopen comment' : 'Resolve comment'} title={comment.resolved ? 'Reopen comment' : 'Resolve comment'}
        onClick={() => onResolve(!comment.resolved)}>{comment.resolved ? <RotateCcw size={13} aria-hidden /> : <Check size={13} aria-hidden />}</button>}
      {comment && onDelete && <button type="button" className="icon-button small" aria-label="Delete comment" title="Delete comment · Undo restores it" onClick={onDelete}><Trash2 size={13} aria-hidden /></button>}
    </header>
    <textarea ref={input} aria-label="Comment text" rows={3} maxLength={COMMENT_TEXT_LIMIT} placeholder="Add a comment" value={text} onChange={event => setText(event.target.value)} />
    <div className="clip-colors story-comment-colors" role="group" aria-label="Comment color">
      {colors.map(value => <button key={value ?? 'default'} type="button" aria-label={`${value ? clipColorName(value) : 'Default'} comment color`} title={value ? clipColorName(value) : 'Default'}
        aria-pressed={color === value} style={{ background: value ? clipColors[value] : 'var(--text)' }} onClick={() => onColor(value)}>
        {color === value && <Check size={12} aria-hidden />}
      </button>)}
    </div>
    <footer>
      <small>{created ? `Added ${created}` : `${mac ? '⌘' : 'Ctrl'}+Enter to save`}</small>
      <button type="button" className="button small" onClick={() => finish.current(false, true)}>Cancel</button>
      <button type="button" className="button small primary" disabled={!changed} onClick={() => finish.current(true, true)}>{comment ? 'Save' : 'Comment'}</button>
    </footer>
  </section>, document.fullscreenElement ?? document.body);
}
