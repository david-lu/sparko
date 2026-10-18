import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, CircleHelp } from 'lucide-react';
import { maskInjections, type MaskInjection } from '../../../shared/interstitials';

const options: Record<MaskInjection, { label: string; detail: string; how: string; why: string }> = {
  standard: {
    label: 'Standard generation', detail: '1.00 throughout',
    how: 'H3 generates the whole middle section with a mask of 1.00. There is no interpolated video underneath it; existing reference sections stay frozen.',
    why: 'Use this for maximum freedom to create new action. It does not add guidance to reduce the color, lighting or framing drift that can build up across repeated generations.',
  },
  uniform: {
    label: 'FILM + uniform mask', detail: '0.97 throughout',
    how: 'FILM creates a motion interpolation between the last start-reference frame and the first end-reference frame. H3 uses this video as a weak guide, with a 0.97 mask across the generated section.',
    why: 'Aims to reduce accumulated color, lighting and framing drift while allowing new action. It can also pull movement toward the interpolated poses; it cannot guarantee a seamless match.',
  },
  vignette: {
    label: 'FILM + vignette mask', detail: '1.00 center → 0.95 edges',
    how: 'Uses the same FILM interpolation, with a smooth oval mask: 1.00 in the center, gradually falling through 0.97 to 0.95 toward the edges. Lower values keep more influence from the interpolated video.',
    why: 'Aims to steady background color, lighting and framing near the edges while giving action in the center more freedom. Subjects near the edges may be more constrained. This is experimental, not a guaranteed drift fix.',
  },
};

export default function MaskInjectionField({ value, hasEndReference, onChange }: {
  value: MaskInjection; hasEndReference: boolean; onChange: (value: MaskInjection) => void;
}) {
  const id = useId(), button = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const [help, setHelp] = useState<MaskInjection>(value);
  const close = (focus = false) => { setPosition(null); if (focus) button.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!position) return;
    popup.current?.querySelector<HTMLInputElement>('input:checked')?.focus({ preventScroll: true });
    const outside = (event: Event) => {
      if (!button.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setPosition(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setPosition(null); button.current?.focus({ preventScroll: true }); }
    };
    const resize = () => setPosition(null);
    const scroll = (event: Event) => { if (!popup.current?.contains(event.target as Node)) setPosition(null); };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside); document.addEventListener('keydown', escape);
    window.addEventListener('resize', resize); window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', resize); window.removeEventListener('scroll', scroll, true);
    };
  }, [position]);
  return <div className="mask-injection-field">
    <label id={`${id}-label`} htmlFor={id}>Mask injection</label>
    <button ref={button} id={id} type="button" className="mask-injection-trigger" aria-label={`Mask injection: ${options[value].label}`}
      aria-haspopup="dialog" aria-expanded={!!position} aria-controls={position ? `${id}-options` : undefined} aria-describedby={`${id}-hint`}
      onClick={() => {
        if (position) { close(); return; }
        const rect = button.current!.getBoundingClientRect(), width = Math.min(360, window.innerWidth - 24);
        const below = window.innerHeight - rect.bottom, above = rect.top, upwards = below < 390 && above > below;
        setHelp(value);
        setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
          ...(upwards ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
          maxHeight: Math.max(80, (upwards ? above : below) - 18) });
      }}><span>{options[value].label}</span><ChevronDown size={14} /></button>
    <p className="hint" id={`${id}-hint`}>{hasEndReference ? 'Applies to the next generation. Reference sections stay frozen.'
      : 'FILM modes require an end reference. Call extensions only have a start reference.'}</p>
    {position && createPortal(<div ref={popup} id={`${id}-options`} className="mask-injection-popover" role="dialog" aria-label="Mask injection options"
      data-project-edit style={position} onKeyDown={event => { if (event.key === ' ') event.stopPropagation(); }}>
      <div role="radiogroup" aria-label="Mask injection">
        {maskInjections.map(mode => <div className="mask-injection-choice" key={mode} data-selected={value === mode}>
          <label><input type="radio" name={`${id}-mode`} value={mode} checked={value === mode} disabled={!hasEndReference && mode !== 'standard'}
            onClick={() => { if (value === mode) close(true); }}
            onChange={() => { onChange(mode); close(true); }} />
            <span><strong>{options[mode].label}</strong><small>{options[mode].detail}</small></span></label>
          <button type="button" className="icon-button small" aria-label={`About ${options[mode].label}`} aria-pressed={help === mode}
            aria-controls={`${id}-help`} title={`About ${options[mode].label}`} onClick={() => setHelp(mode)}><CircleHelp size={16} /></button>
        </div>)}
      </div>
      <div id={`${id}-help`} className="mask-injection-help" role="note" aria-live="polite">
        <strong>{options[help].label}</strong><p>{options[help].how}</p><p>{options[help].why}</p>
        {!hasEndReference && help !== 'standard' && <p>Unavailable for this clip because it has no end reference.</p>}
      </div>
    </div>, document.body)}
  </div>;
}
