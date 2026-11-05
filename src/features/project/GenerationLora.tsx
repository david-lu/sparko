import { useId, useRef, useState } from 'react';
import { generationModel } from '../../../shared/generation-models';
import { generationLoraInstructions, H3_MODEL_ID, LORA_STRENGTH, type ProjectLora } from '../../../shared/loras';
import LoraDialog from './LoraDialog';
import LoraStrength from './LoraStrength';

export default function GenerationLora({ model, value, instructions, strength, loras, onChange, onStrengthChange, turbo, onTurboChange }: {
  model: string; value?: string | null; instructions?: string; strength?: number; loras?: ProjectLora[];
  onChange: (address: string | null, instructions?: string, strength?: number) => void; onStrengthChange: (strength: number) => void;
  turbo?: boolean; onTurboChange?: (enabled: boolean) => void;
}) {
  const id = useId(), select = useRef<HTMLSelectElement>(null), [open, setOpen] = useState(false);
  const assigned = loras?.find(lora => lora.model === model), supported = generationModel(model)?.supportsLora;
  const custom = !!value && value !== assigned?.address;
  const choose = (address: string) => {
    if (address === '__custom__') { setOpen(true); return; }
    const selectedStrength = address === assigned?.address ? assigned.strength : strength;
    onChange(address || null, undefined, address ? selectedStrength ?? LORA_STRENGTH.default : undefined);
  };
  return <div className="generation-lora">
    <label className="inspector-property" htmlFor={id}><span>LoRA</span><select id={id} ref={select} aria-label="Generation LoRA" value={value ?? ''}
      disabled={!supported && !value} onChange={event => choose(event.target.value)}>
      <option value="">None</option>
      {assigned && <option value={assigned.address}>Project — {assigned.name}</option>}
      {custom && <option value={value!}>{value!.split('/').at(-1)} · Custom</option>}
      {supported && <option value="__custom__">Use another LoRA…</option>}
    </select></label>
    <p className="hint generation-lora-hint" title={value ?? undefined}>{supported ? 'Applies to this generation only.' : 'LoRAs are unavailable for this model.'}</p>
    {supported && !!value && <LoraStrength value={strength} onChange={onStrengthChange}/>}
    {model === H3_MODEL_ID && onTurboChange && <label className="inspector-property generation-turbo" title="Use the H3 Turbo LoRA for faster video generation.">
      <span>Turbo</span><input type="checkbox" role="switch" checked={!!turbo} onChange={event => onTurboChange(event.target.checked)}/>
    </label>}
    {open && <LoraDialog model={model} initial={value ? { model, address: value, name: value, strength, instructions: generationLoraInstructions({ lora: value, loraInstructions: instructions }, loras, model) } : undefined} onCancel={() => setOpen(false)}
      restoreFocus={() => select.current?.focus()} onSave={entry => { onChange(entry.address, entry.instructions ?? '', entry.strength ?? LORA_STRENGTH.default); setOpen(false); }}/>}
  </div>;
}
