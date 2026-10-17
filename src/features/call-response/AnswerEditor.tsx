import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { AnswerOption } from './model';

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

export default function AnswerEditor({ answer, onChange, onRemove, removable }: {
  answer: AnswerOption; onChange: (patch: Partial<Pick<AnswerOption, 'label' | 'values'>>) => void; onRemove: () => void; removable: boolean;
}) {
  return <div className="answer-editor">
    <AnswerField label="Answer label" value={answer.label} onCommit={label => onChange({ label })} />
    <AnswerField label="Also accept" value={answer.values.join('\n')} multiline onCommit={value => onChange({ values: value.split('\n') })} />
    <button className="text-button remove-answer" disabled={!removable} onClick={onRemove} title={removable ? 'Remove this answer and its response clip' : 'Keep at least one answer'}><Trash2 size={13} /> Remove answer</button>
  </div>;
}
