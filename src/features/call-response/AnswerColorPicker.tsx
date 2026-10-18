import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { answerColor, answerColorStyle, clampColor, hexToHsv, hsvToHex, type HSVColor } from './colors';
import type { AnswerOption } from './model';
import ChoiceFace from './ChoiceFace';
import './color-picker.css';

function ColorNumber({ label, value, max, unit, onChange }: {
  label: string; value: number; max: number; unit: string; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(value))), input = useRef<HTMLInputElement>(null);
  const typedValue = useRef<number | null>(null);
  useEffect(() => {
    if (document.activeElement !== input.current || value !== typedValue.current) setDraft(String(Math.round(value)));
  }, [value]);
  return <label className="color-number"><span>{label.split(' ').at(-1)}</span><div>
    <input ref={input} type="number" min={0} max={max} step="any" aria-label={label} value={draft}
      onChange={event => {
        setDraft(event.target.value);
        if (event.target.value !== '' && Number.isFinite(event.target.valueAsNumber)) {
          typedValue.current = clampColor(event.target.valueAsNumber, max); onChange(typedValue.current);
        }
      }} onBlur={() => { typedValue.current = null; setDraft(String(Math.round(value))); }} onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
      }} /><span>{unit}</span>
  </div></label>;
}

function HexField({ color, label, onChange }: { color: HSVColor; label: string; onChange: (color: HSVColor) => void }) {
  const hex = hsvToHex(color), [draft, setDraft] = useState(hex), input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(hex), [hex]);
  const commit = () => {
    const next = hexToHsv(draft.trim(), color.hue);
    if (next && hsvToHex(next) !== hex) onChange(next);
    setDraft(next ? hsvToHex(next) : hex);
  };
  return <label className="color-hex"><span>Hex</span><input ref={input} aria-label={`${label} hex`} value={draft}
    maxLength={7} spellCheck={false} autoComplete="off" onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} /></label>;
}

function ColorWheel({ color, label, onChange }: { color: HSVColor; label: string; onChange: (color: HSVColor) => void }) {
  const huePosition = { left: `${50 + Math.sin(color.hue * Math.PI / 180) * 44.5}%`, top: `${50 - Math.cos(color.hue * Math.PI / 180) * 44.5}%` };
  const point = (event: PointerEvent<HTMLDivElement>, hue: boolean) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
    onChange(hue ? { ...color, hue: (Math.atan2(x - .5, .5 - y) * 180 / Math.PI + 360) % 360 }
      : { ...color, saturation: clampColor(x * 100), value: clampColor((1 - y) * 100) });
  };
  const pointer = (hue: boolean) => ({
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId); point(event, hue);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) point(event, hue); },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) { point(event, hue); event.currentTarget.releasePointerCapture(event.pointerId); }
    },
  });
  return <div className="hsv-wheel" style={{ '--picker-hue': color.hue } as CSSProperties}>
    <div className="hsv-hue-ring" role="slider" tabIndex={0} aria-label={`${label} hue wheel`}
      aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(color.hue)} aria-valuetext={`${Math.round(color.hue)} degrees`}
      {...pointer(true)} onKeyDown={event => {
        const step = event.shiftKey ? 10 : 1;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 360
          : ['ArrowRight', 'ArrowUp'].includes(event.key) ? (color.hue + step) % 360
          : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? (color.hue - step + 360) % 360 : null;
        if (next !== null) { event.preventDefault(); onChange({ ...color, hue: next }); }
      }}><span className="hsv-thumb" style={{ ...huePosition, background: `hsl(${color.hue} 100% 50%)` }} /></div>
    <div className="hsv-sv-plane" role="group" tabIndex={0} aria-label={`${label} saturation and value`}
      aria-description="Drag to choose saturation and brightness. Left and right change saturation; up and down change brightness. Hold Shift for larger steps."
      {...pointer(false)} onKeyDown={event => {
        const step = event.shiftKey ? 10 : 1;
        const patch = event.key === 'ArrowRight' ? { saturation: clampColor(color.saturation + step) }
          : event.key === 'ArrowLeft' ? { saturation: clampColor(color.saturation - step) }
          : event.key === 'ArrowUp' ? { value: clampColor(color.value + step) }
          : event.key === 'ArrowDown' ? { value: clampColor(color.value - step) } : null;
        if (patch) { event.preventDefault(); onChange({ ...color, ...patch }); }
      }}><span className="hsv-thumb" style={{ left: `${color.saturation}%`, top: `${100 - color.value}%`, background: hsvToHex(color) }} /></div>
  </div>;
}

export default function AnswerColorPicker({ answer, index, onChange }: {
  answer: AnswerOption; index: number; onChange: (color: HSVColor) => void;
}) {
  const label = `Button ${index + 1}`, id = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [position, setPosition] = useState<CSSProperties>({ left: 12, top: 12 });
  const color = answerColor(answer, index), style = answerColorStyle(answer, index) as CSSProperties;
  const close = (focus = false) => { setOpen(false); if (focus) trigger.current?.focus({ preventScroll: true }); };
  useLayoutEffect(() => {
    if (!open || !popup.current || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect(), { width, height } = popup.current.getBoundingClientRect();
    setPosition({ left: Math.max(12, Math.min(rect.left - width - 10, window.innerWidth - width - 12)),
      top: Math.max(12, Math.min(rect.top - 12, window.innerHeight - height - 12)) });
    popup.current.querySelector<HTMLElement>('[role="slider"]')?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const resize = () => setOpen(false);
    const scroll = (event: Event) => { if (!popup.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    window.addEventListener('resize', resize); window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside);
      window.removeEventListener('resize', resize); window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);
  return <div className="answer-color-editor">
    <span>Button color</span>
    <button ref={trigger} type="button" className="answer-color-trigger" aria-label={`${label} color`} aria-haspopup="dialog"
      aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
      <span className="choice-button answer-color-swatch" style={style} aria-hidden="true"><ChoiceFace>Aa</ChoiceFace></span>
      <span>{hsvToHex(color).toUpperCase()}</span><ChevronDown size={13} />
    </button>
    {open && createPortal(<div ref={popup} id={id} className="answer-color-popover" role="dialog" aria-label={`${label} color`}
      data-project-edit style={position} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
        if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
      }}>
      <header><strong>Button color</strong><button className="icon-button small" aria-label="Close color picker" onClick={() => close(true)}><X size={14} /></button></header>
      <div className="color-button-preview"><span className="choice-button" style={style}><ChoiceFace>{answer.label}</ChoiceFace></span></div>
      <ColorWheel color={color} label={label} onChange={onChange} />
      <div className="color-numbers">
        <ColorNumber label={`${label} hue`} value={color.hue} max={360} unit="°" onChange={hue => onChange({ ...color, hue })} />
        <ColorNumber label={`${label} saturation`} value={color.saturation} max={100} unit="%" onChange={saturation => onChange({ ...color, saturation })} />
        <ColorNumber label={`${label} value`} value={color.value} max={100} unit="%" onChange={value => onChange({ ...color, value })} />
      </div>
      <HexField color={color} label={label} onChange={onChange} />
      <p className="color-picker-hint">Bevels and text contrast adjust automatically.</p>
    </div>, document.body)}
  </div>;
}
