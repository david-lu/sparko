import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { GENERATION_MODELS, generationModel } from '../../../shared/generation-models';
import type { ProjectLora } from '../../../shared/loras';
import LoraDialog, { ModelTypeIcon } from './LoraDialog';
import type { ProjectController } from './ProjectController';

export default function ProjectLoras({ projects }: { projects: ProjectController }) {
  const project = projects.getSnapshot().project, loras = project?.loras ?? [];
  const [dialog, setDialog] = useState<ProjectLora | 'add' | null>(null);
  const trigger = useRef<HTMLElement | null>(null), addButton = useRef<HTMLButtonElement>(null);
  const open = (value: ProjectLora | 'add', element: HTMLElement) => { trigger.current = element; setDialog(value); };
  const available = GENERATION_MODELS.some(model => model.supportsLora && !loras.some(lora => lora.model === model.id));
  return <section className="project-loras" aria-label="Project LoRAs">
    <div className="project-loras-heading"><h3>LoRAs</h3><button ref={addButton} className="button" type="button" disabled={!available} title={available ? 'Add a LoRA for a model' : 'Every supported model already has a LoRA. Edit an existing assignment.'}
      onClick={event => open('add', event.currentTarget)}><Plus size={12}/>Add LoRA</button></div>
    <p className="hint">New generations use their model’s project LoRA.</p>
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
