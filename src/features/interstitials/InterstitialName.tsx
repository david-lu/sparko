import { useEffect, useRef, useState } from 'react';

export default function InterstitialName({ name, onChange }: { name: string; onChange: (name: string) => void }) {
  const [draft, setDraft] = useState(name);
  const cancelled = useRef(false);
  useEffect(() => setDraft(name), [name]);
  return <input className="interstitial-name" aria-label="Interstitial name" placeholder="Untitled" maxLength={1000}
    value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => {
      if (cancelled.current) { cancelled.current = false; return; }
      const next = draft.trim() || 'Untitled'; setDraft(next);
      if (next !== name) onChange(next);
    }} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); cancelled.current = true; setDraft(name); event.currentTarget.blur();
      }
    }} />;
}
