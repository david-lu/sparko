import { useId, useRef, useState } from 'react';
import { generationModel } from '../../../shared/generation-models';
import type { ProjectLora } from '../../../shared/loras';
import LoraDialog from './LoraDialog';

export default function GenerationLora({ model, value, loras, onChange }: {
  model: string; value?: string | null; loras?: ProjectLora[]; onChange: (address: string | null) => void;
}) {
  const id = useId(), select = useRef<HTMLSelectElement>(null), [open, setOpen] = useState(false);
  const assigned = loras?.find(lora => lora.model === model), supported = generationModel(model)?.supportsLora;
  const custom = !!value && value !== assigned?.address;
  return <div className="generation-lora">
    <label className="inspector-property" htmlFor={id}><span>LoRA</span><select id={id} ref={select} aria-label="Generation LoRA" value={value ?? ''}
      disabled={!supported && !value} onChange={event => { if (event.target.value === '__custom__') setOpen(true); else onChange(event.target.value || null); }}>
      <option value="">None</option>
      {assigned && <option value={assigned.address}>Project — {assigned.name}</option>}
      {custom && <option value={value!}>{value!.split('/').at(-1)} · Custom</option>}
      {supported && <option value="__custom__">Use another LoRA…</option>}
    </select></label>
    <p className="hint generation-lora-hint" title={value ?? undefined}>{supported ? 'Applies to this generation only.' : 'LoRAs are unavailable for this model.'}</p>
    {open && <LoraDialog model={model} initial={value ? { model, address: value, name: value } : undefined} onCancel={() => setOpen(false)}
      restoreFocus={() => select.current?.focus()} onSave={entry => { onChange(entry.address); setOpen(false); }}/>}
  </div>;
}
