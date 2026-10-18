import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { AnswerOption } from './model';
import AnswerColorPicker from './AnswerColorPicker';

function AnswerField({ label, value, multiline = false, onCommit }: {
  label: string; value: string; multiline?: boolean; onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value), cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  const props = { 'aria-label': label, value: draft,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onBlur: () => {
      if (cancelled.current) { cancelled.current = false; return; }
      const next = multiline ? [...new Set(draft.split('\n').map(value => value.trim().slice(0, 200)).filter(Boolean))].slice(0, 100).join('\n') : draft.trim() || value;
      setDraft(next); if (next !== value) onCommit(next);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !multiline) { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; setDraft(value); event.currentTarget.blur(); }
    },
  };
  return <label className="field">{label}{multiline ? <textarea {...props} rows={2} maxLength={20100} placeholder="Optional alternatives, one per line" /> : <input {...props} maxLength={200} />}</label>;
}

export function ResponseButtonText({ answer, label = 'Response button text', onChange }: {
  answer: AnswerOption; label?: string; onChange: (text: string) => void;
}) {
  return <AnswerField label={label} value={answer.label} onCommit={onChange} />;
}

export default function AnswerEditor({ answer, index, onChange, onRemove, removable }: {
  answer: AnswerOption; index: number; onChange: (patch: Partial<Pick<AnswerOption, 'label' | 'values' | 'color'>>) => void; onRemove: () => void; removable: boolean;
}) {
  return <div className="answer-editor">
    <ResponseButtonText answer={answer} label={`Button ${index + 1} text`} onChange={label => onChange({ label })} />
    <AnswerColorPicker answer={answer} index={index} onChange={color => onChange({ color })} />
    <details className="answer-alternatives"><summary>Alternative answers</summary><AnswerField label={`Button ${index + 1} also accepts`} value={answer.values.join('\n')} multiline onCommit={value => onChange({ values: value.split('\n') })} /></details>
    <button className="text-button remove-answer" disabled={!removable} onClick={onRemove} title={removable ? 'Remove this answer and its response clip' : 'Keep at least one answer'}><Trash2 size={13} /> Remove answer</button>
  </div>;
}
