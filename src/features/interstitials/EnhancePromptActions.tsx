import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Sparkles, X } from 'lucide-react';
import { PROMPT_EDIT_MAX_LENGTH } from '../../../shared/constants';
import ModalBackdrop from '../../shared/ModalBackdrop';

export type PromptEditResult = { applied: boolean; error?: string };

export default function EnhancePromptActions({ promptId, enhancing, enabled, connected, onEnhance, onEdit, onCancel, description, unavailableReason }: {
  promptId: string; enhancing: boolean; enabled: boolean; connected: boolean; onEnhance: () => void; onEdit: (instructions: string) => Promise<PromptEditResult>; onCancel: () => void; description?: string; unavailableReason?: string;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), attempt = useRef(0);
  const [editing, setEditing] = useState(false), [instructions, setInstructions] = useState(''), [error, setError] = useState('');
  useEffect(() => () => { attempt.current++; }, []);
  const enhancingHere = enhancing && !editing;
  const close = () => { attempt.current++; if (enhancing && editing) onCancel(); setEditing(false); };
  const reason = enhancing ? 'Updating this prompt…' : !connected ? 'OpenAI is not connected. Configure OPENAI_API_KEY on the server to edit prompts.' : !enabled ? unavailableReason ?? 'Enter a draft prompt first.' : undefined;
  const apply = async () => {
    if (enhancing || !enabled || !connected || !instructions.trim()) return;
    const current = ++attempt.current; setError('');
    try {
      const result = await onEdit(instructions.trim());
      if (current !== attempt.current) return;
      if (result.applied) setEditing(false);
      else setError(result.error ?? 'The edit was not applied. Try again.');
    } catch (reason) { if (current === attempt.current) setError(reason instanceof Error ? reason.message : 'Unable to edit this prompt. Try again.'); }
  };
  return <div className="enhance-prompt-actions">
    <button type="button" className="text-button enhance-prompt" disabled={enhancing || !connected || !enabled} aria-busy={enhancingHere} aria-controls={promptId}
      aria-description={reason} title={reason ?? description ?? 'Enhance with OpenAI using reference frames to preserve the shot, composition and continuous positions'} onClick={onEnhance}>
      {enhancingHere ? <span className="spinner" /> : <Sparkles size={12} />}
      <span className="button-labels"><span aria-hidden={enhancingHere}>Enhance prompt</span><span aria-hidden={!enhancingHere}>Enhancing…</span></span>
    </button>
    <button ref={trigger} type="button" className="text-button enhance-prompt" disabled={enhancing || !connected || !enabled} aria-controls={promptId} aria-haspopup="dialog"
      title={reason ?? 'Describe a specific change to this prompt'} onClick={() => { setInstructions(''); setError(''); setEditing(true); }}><Pencil size={12}/>Edit with AI</button>
    <button type="button" className="icon-button small enhance-prompt-cancel" aria-label="Cancel prompt enhancement" aria-controls={promptId} aria-hidden={!enhancingHere} disabled={!enhancingHere}
      onClick={onCancel}><X size={13} /></button>
    {editing && createPortal(<ModalBackdrop labelledBy={`${id}-title`} onCancel={close} restoreFocus={() => trigger.current?.focus({preventScroll:true})}>
      <form className="project-card prompt-edit-dialog" onSubmit={event => { event.preventDefault(); event.stopPropagation(); void apply(); }}>
        <h2 id={`${id}-title`}>Edit prompt with AI</h2>
        <div className="field">
        <label htmlFor={`${id}-instructions`}>What should change?</label>
        <textarea id={`${id}-instructions`} autoFocus rows={4} required maxLength={PROMPT_EDIT_MAX_LENGTH} value={instructions} readOnly={enhancing}
          placeholder={'For example: add “Or this sock?” while she holds the sock. Keep the other lines.'}
          onChange={event => setInstructions(event.target.value)} onKeyDown={event => { if (event.key==='Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/>
        </div>
        <p className="prompt-edit-feedback" role="status">{error}</p>
        <div className="prompt-edit-footer"><button type="button" className="button" onClick={close}>Cancel</button>
          <button type="submit" className="button primary" disabled={enhancing || !connected || !enabled || !instructions.trim()} aria-busy={enhancing}>
            <span className="button-labels"><span aria-hidden={enhancing}>Apply edit</span><span aria-hidden={!enhancing}>Editing…</span></span>
          </button>
        </div>
      </form>
    </ModalBackdrop>, document.body)}
  </div>;
}
