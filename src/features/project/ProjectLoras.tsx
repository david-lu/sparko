import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { GENERATION_MODELS, generationModel } from '../../../shared/generation-models';
import type { ProjectLora } from '../../../shared/loras';
import LoraDialog, { ModelTypeIcon } from './LoraDialog';
import type { ProjectController } from './ProjectController';

const LORA_MODEL = GENERATION_MODELS.find(model => model.supportsLora);

export default function ProjectLoras({ projects }: { projects: ProjectController }) {
  const project = projects.getSnapshot().project, loras = project?.loras ?? [];
  const [dialog, setDialog] = useState<ProjectLora | 'add' | null>(null);
  const trigger = useRef<HTMLElement | null>(null), addButton = useRef<HTMLButtonElement>(null), hintId = useId();
  const open = (value: ProjectLora | 'add', element: HTMLElement) => { trigger.current = element; setDialog(value); };
  const available = GENERATION_MODELS.some(model => model.supportsLora && !loras.some(lora => lora.model === model.id));
  // Projects allow one LoRA per model. Once every LoRA model has one, Add LoRA edits that assignment instead of doing nothing.
  const assigned = available ? undefined : loras.find(lora => generationModel(lora.model)?.supportsLora);
  const assignedName = (assigned ? generationModel(assigned.model) : LORA_MODEL)?.name;
  return <section className="project-loras" aria-label="Project LoRAs">
    <div className="project-loras-heading"><h3>LoRAs</h3><button ref={addButton} className="button" type="button" aria-describedby={available ? undefined : hintId}
      title={available ? 'Add a LoRA for a model' : `Edit the ${assignedName} LoRA`} onClick={event => open(assigned ?? 'add', event.currentTarget)}><Plus size={12}/>Add LoRA</button></div>
    {/* Both hints share one grid cell, so switching between them never moves the list below. */}
    <div className="project-loras-hints">
      <p className="hint" aria-hidden={!available || undefined}>New generations use their model’s project LoRA. Each model can have one.</p>
      <p className="hint" id={hintId} aria-hidden={available || undefined}>{assignedName} already has a LoRA. Edit or remove it to use another. Image and audio models don’t use LoRAs.</p>
    </div>
    {loras.length ? <ul>{loras.map(lora => {
      const model = generationModel(lora.model);
      return <li key={lora.model}><ModelTypeIcon kind={model?.kind ?? 'video'}/><div className="project-lora-label"><strong>{model?.name ?? lora.model}</strong><span title={lora.address}>{lora.name}</span></div>
        <div className="project-lora-actions">
          <button className="icon-button small" type="button" aria-label={`Edit ${model?.name ?? lora.model} LoRA`} title="Edit LoRA" onClick={event => open(lora, event.currentTarget)}><Pencil size={12}/></button>
          <button className="icon-button small" type="button" aria-label={`Remove ${model?.name ?? lora.model} LoRA`} title="Remove LoRA" onClick={() => { projects.removeLora(lora.model); addButton.current?.focus(); }}><Trash2 size={12}/></button>
        </div>
      </li>;
    })}</ul> : <p className="project-loras-empty">No LoRAs yet.</p>}
    {dialog && <LoraDialog key={`${project?.id}:${dialog === 'add' ? 'new' : dialog.model}`} initial={dialog === 'add' ? undefined : dialog}
      excluded={loras.filter(lora => dialog === 'add' || lora.model !== dialog.model).map(lora => lora.model)}
      onCancel={() => setDialog(null)} restoreFocus={() => { if (trigger.current?.isConnected) trigger.current.focus(); else addButton.current?.focus(); }}
      onSave={entry => { projects.setLora(entry, dialog === 'add' ? undefined : dialog.model); setDialog(null); }}/>}
  </section>;
}
