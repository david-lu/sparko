import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp } from 'lucide-react';
import './styles.css';

export default function InterstitialHelp() {
  const id = useId(), button = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ right: number; bottom: number } | null>(null);
  useEffect(() => {
    if (!position) return;
    const dismiss = (event: PointerEvent) => { if (!button.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setPosition(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPosition(null); button.current?.focus(); } };
    const close = () => setPosition(null);
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape);
    window.addEventListener('resize', close); window.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [position]);
  return <>
    <button ref={button} className="icon-button small" aria-label="What is an interstitial?" title="What is an interstitial?"
      aria-expanded={!!position} aria-controls={position ? id : undefined} aria-describedby={position ? id : undefined} onKeyDown={event => { if (event.key === ' ') event.stopPropagation(); }}
      onClick={() => {
        if (position) { setPosition(null); return; }
        const rect = button.current!.getBoundingClientRect();
        setPosition({ right: Math.max(12, window.innerWidth - rect.right), bottom: window.innerHeight - rect.top + 8 });
      }}><CircleHelp size={14} /></button>
    {position && createPortal(<div ref={popup} id={id} className="interstitial-help-popover" role="note" style={position}>
      <strong>What is an interstitial?</strong>
      <p>Add a regular scene or a call-response sequence at the playhead. Draft call-response clips stay in the editor until their videos are generated.</p>
    </div>, document.body)}
  </>;
}
