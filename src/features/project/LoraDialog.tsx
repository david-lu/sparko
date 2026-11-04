import { ChevronDown, Image, Music, Video } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GENERATION_MODELS, generationModel, type GenerationModel } from '../../../shared/generation-models';
import { loraAddressSchema, projectLoraSchema, type ProjectLora } from '../../../shared/loras';
import { request } from '../../shared/api';
import { useExclusiveMenu } from '../../shared/DropdownMenu';
import ModalBackdrop from '../../shared/ModalBackdrop';
import './loras.css';

export function ModelTypeIcon({ kind }: { kind: GenerationModel['kind'] }) {
  const Icon = kind === 'video' ? Video : kind === 'audio' ? Music : Image;
  return <Icon size={14} aria-hidden="true"/>;
}

function ModelPicker({ value, excluded, onChange }: { value: string; excluded: string[]; onChange: (value: string) => void }) {
  const id = useId(), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false), model = generationModel(value);
  const choices = GENERATION_MODELS.filter(option => !excluded.includes(option.id));
  useExclusiveMenu(root, open, () => setOpen(false), () => trigger.current?.focus());
  useEffect(() => { if (open) root.current?.querySelector<HTMLButtonElement>('[role=option][aria-selected=true]:not(:disabled), [role=option]:not(:disabled)')?.focus(); }, [open]);
  return <div className="lora-model-picker" ref={root}>
    <label id={`${id}-label`}>Model</label>
    <button type="button" className="lora-model-trigger" ref={trigger} role="combobox" aria-labelledby={`${id}-label`} aria-controls={`${id}-options`} aria-expanded={open} aria-haspopup="listbox"
      onClick={() => setOpen(!open)} onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true); } }}>
      {model && <ModelTypeIcon kind={model.kind}/>}<span>{model?.name ?? 'Select a model'}</span><ChevronDown size={13} aria-hidden="true"/>
    </button>
    {open && <div id={`${id}-options`} className="lora-model-options" role="listbox" aria-labelledby={`${id}-label`} onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }}>
      {choices.map(option => <button key={option.id} type="button" role="option" aria-selected={option.id === value} disabled={!option.supportsLora}
        onClick={() => { onChange(option.id); setOpen(false); trigger.current?.focus(); }}>
        <ModelTypeIcon kind={option.kind}/><span>{option.name}<small>{option.supportsLora ? option.kind : `${option.kind} · LoRA unavailable`}</small></span>
      </button>)}
    </div>}
  </div>;
}

export default function LoraDialog({ initial, model, excluded = [], onSave, onCancel, restoreFocus }: {
  initial?: ProjectLora; model?: string; excluded?: string[]; onSave: (entry: ProjectLora) => void; onCancel: () => void; restoreFocus: () => void;
}) {
  const id = useId(), operation = useRef<AbortController | null>(null);
  const [selected, setSelected] = useState(model ?? initial?.model ?? ''), [address, setAddress] = useState(initial?.address ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => () => { operation.current?.abort(); }, []);
  const cancel = () => { operation.current?.abort(); onCancel(); };
  const submit = async () => {
    if (operation.current) return;
    if (!generationModel(selected)?.supportsLora) { setError('Choose a model that supports LoRAs.'); return; }
    if (excluded.includes(selected)) { setError('This model already has a LoRA. Edit its existing assignment.'); return; }
    const parsed = loraAddressSchema.safeParse(address);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    const task = new AbortController(); operation.current = task; setBusy(true); setError('');
    try {
      const entry = projectLoraSchema.parse(await request('/api/comfy/loras/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selected, address: parsed.data }), signal: task.signal }));
      if (!task.signal.aborted) onSave(entry);
    } catch (cause) { if (!task.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to check this LoRA. Try again.'); }
    finally { if (!task.signal.aborted) { operation.current = null; setBusy(false); } }
  };
  // Generation controls live in a form; keep this dialog's form outside it.
  return createPortal(<ModalBackdrop labelledBy={`${id}-title`} onCancel={cancel} restoreFocus={restoreFocus}>
    <form className="project-card lora-dialog" onSubmit={event => { event.preventDefault(); event.stopPropagation(); void submit(); }} aria-busy={busy}>
      <h2 id={`${id}-title`}>{model ? 'Choose LoRA' : initial ? 'Edit LoRA' : 'Add LoRA'}</h2>
      <fieldset disabled={busy}>
        {model ? <p className="lora-dialog-model"><ModelTypeIcon kind={generationModel(model)!.kind}/>{generationModel(model)?.name}</p>
          : <ModelPicker value={selected} excluded={excluded} onChange={value => { setSelected(value); setError(''); }}/>}
        <label className="field" htmlFor={`${id}-address`}>Comfy Cloud model address</label>
        <input id={`${id}-address`} autoFocus={!!model} required maxLength={2000} value={address} autoComplete="off" spellCheck={false}
          aria-describedby={`${id}-help ${id}-feedback`} aria-invalid={!!error} placeholder="model.safetensors or Comfy asset link"
          onChange={event => { setAddress(event.target.value); setError(''); }}/>
        <p id={`${id}-help`} className="hint">Use the exact imported LoRA filename or its Comfy Cloud asset link. The LoRA must match the selected model.</p>
      </fieldset>
      <div id={`${id}-feedback`} className="lora-dialog-feedback" role="status">{error}</div>
      <div className="close-project-actions">
        <button className="button" type="button" onClick={cancel}>Cancel</button>
        <button className="button primary lora-save" type="submit" disabled={busy || !selected || !address.trim()}>
          <span className="status-icon">{busy && <span className="spinner"/>}</span>{busy ? 'Checking…' : model ? 'Use LoRA' : initial ? 'Save LoRA' : 'Add LoRA'}
        </button>
      </div>
    </form>
  </ModalBackdrop>, document.body);
}
