import GenerationLora from '../project/GenerationLora';
import { useId } from 'react';
import { Sparkles } from 'lucide-react';
import { ASSET_MODELS, assetModel, generationBusy, validateAssetSettings, type AssetGeneration, type AssetSettings } from '../../../shared/asset-generation';
import { IMAGE_PROMPT_GUIDES } from '../../../shared/image-prompt-guides';
import type { AppStatus } from '../../../shared/contracts';
import type { StoryEditor } from './useStoryEditor';
import { startLibraryDrag } from './libraryDrag';
import { assets } from '../project/assets';
import { useAssetAvailability } from '../project/useAssetAvailability';
import ContentIssues from '../../shared/ContentIssues';
import AssetInput from '../project/AssetInput';
import EnhancePromptActions from '../interstitials/EnhancePromptActions';
import { useImagePromptEnhancement } from '../project/useImagePromptEnhancement';
import '../project/asset-inspector.css';

export default function ClipGenerationEditor({ editor, generation, status }: { editor: StoryEditor; generation: AssetGeneration; status: AppStatus | null }) {
  const project = editor.projects.getSnapshot().project, settings = generation.settings, model = assetModel(settings.model), kind = generation.kind;
  const promptId = useId(), enhancement = useImagePromptEnhancement(editor, generation, !!status?.providers.openai), busy = generationBusy(generation);
  useAssetAvailability(settings.references.map(ref => ref.assetId));
  const missingReferences = settings.references.flatMap(ref => assets.error(ref.assetId) ? [{ key: ref.assetId, title: `${ref.name} reference`, message: assets.error(ref.assetId)! }] : []);
  const validation = validateAssetSettings(settings);
  const issues = [...missingReferences, ...(generation.error ? [{ key: 'generation', title: 'Generation failed', message: generation.error }] : []), ...(validation && settings.prompt.trim() ? [{ key: 'settings', title: 'Generation settings', message: validation }] : [])];
  const update = (patch: Partial<AssetSettings>) => editor.clipJobs.edit(generation.id, { settings: { ...generation.settings, ...patch } });
  const message = generation.error || missingReferences[0]?.message || (busy ? generation.phase === 'queued' ? 'Queued' : generation.phase === 'loading' ? 'Saving output…' : 'Generating…' : !status?.providers.fal ? 'Connect fal with FAL_KEY in .env.' : generation.phase === 'cancelled' ? 'Cancelled' : validation || 'Ready to generate');
  return <div className="clip-generation-editor">
    {model && <form onSubmit={e => { e.preventDefault(); if (!enhancement.enhancing && !missingReferences.length) void editor.clipJobs.generate(generation.id); }}>
      <details className="inspector-group" open><summary>Generation settings<span>fal</span></summary>
        <label className="inspector-property"><span>Model</span><select aria-label="Generation model" value={model.id} onChange={e => { const next = assetModel(e.target.value)!; update({ model: next.id, resolution: (next.resolutions.includes(settings.resolution) ? settings.resolution : next.resolutions[0] || '1K') as AssetSettings['resolution'], count: 1 }); }}>{ASSET_MODELS.filter(m => m.kind === generation.kind).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <GenerationLora key={`${generation.id}:${model.id}`} model={model.id} value={settings.lora} instructions={settings.loraInstructions} strength={settings.loraStrength} loras={project?.loras} onChange={(lora, loraInstructions, loraStrength) => update({ lora, loraInstructions, loraStrength })} onStrengthChange={loraStrength => update({ loraStrength })}/>
        <div className="field inspector-prompt"><div className="prompt-field-heading"><label htmlFor={promptId}>Prompt</label>
          {kind === 'image' && <EnhancePromptActions promptId={promptId} enhancing={enhancement.enhancing} enabled={!busy && !validation && !missingReferences.length} connected={!!status?.providers.openai}
            description={`Enhance with OpenAI following ${IMAGE_PROMPT_GUIDES[model.id]?.title}`} onEnhance={() => void enhancement.enhance()} onCancel={enhancement.cancel}/>}
        </div><textarea id={promptId} aria-label="Generation prompt" rows={4} value={settings.prompt} maxLength={8000} placeholder={settings.references.length ? 'Describe the result or the changes to make…' : `Describe the ${kind} to create…`} onChange={e => update({ prompt: e.target.value })}/>
          {kind === 'image' && <a className="asset-prompt-guide" href={IMAGE_PROMPT_GUIDES[model.id]?.url} target="_blank" rel="noreferrer">{model.name} prompt guide ↗</a>}
        </div>
        {(model.inputs.length > 0 || settings.references.length > 0) && <details className="inspector-group" open><summary>Reference assets<span>Optional</span></summary><AssetInput key={`${generation.id}:${model.id}`} projects={editor.projects} value={settings.references} kinds={model.inputs} onChange={references => update({ references })}/><p className="hint asset-capabilities">Accepts {model.inputs.join(', ')}{model.kind === 'video' ? ' · First image sets the start frame.' : ''}</p></details>}
        {kind !== 'audio' && <label className="inspector-property"><span>Aspect ratio</span><select aria-label="Generation aspect ratio" value={settings.aspectRatio} onChange={e => update({ aspectRatio: e.target.value as AssetSettings['aspectRatio'] })}>{(kind === 'video' ? ['16:9', '9:16', '1:1'] : ['16:9', '9:16', '1:1', '4:3', '3:4']).map(r => <option key={r}>{r}</option>)}</select></label>}
        {model.resolutions.length > 0 && <label className="inspector-property"><span>Resolution</span><select aria-label="Generation resolution" value={settings.resolution} onChange={e => update({ resolution: e.target.value as AssetSettings['resolution'] })}>{model.resolutions.map(r => <option key={r}>{r}</option>)}</select></label>}
        {kind === 'video' && <label className="inspector-property"><span>Duration</span><select aria-label="Generation duration" value={settings.duration} onChange={e => update({ duration: Number(e.target.value) })}><option value={5}>5 seconds</option><option value={10}>10 seconds</option></select></label>}
        {kind === 'audio' && <label className="inspector-property"><span>Duration (s)</span><input aria-label="Generation duration" type="number" min={model.id === 'stable-audio-2.5' ? 1 : .5} max={model.id === 'stable-audio-2.5' ? 190 : 22} step={model.id === 'stable-audio-2.5' ? 1 : .5} value={settings.duration} onChange={e => { if (Number.isFinite(e.target.valueAsNumber)) update({ duration: Math.min(model.id === 'stable-audio-2.5' ? 190 : 22, Math.max(model.id === 'stable-audio-2.5' ? 1 : .5, e.target.valueAsNumber)) }); }}/></label>}
        <div className="asset-generate-actions"><button className="button primary full-width" type="submit" disabled={busy || enhancement.enhancing || !status?.providers.fal || !!validation || !!missingReferences.length}><span className="status-icon">{busy ? <span className="spinner"/> : <Sparkles size={14}/>}</span>{busy ? 'Generating…' : `Generate ${kind}`}</button>
          <div className="asset-secondary-action">{busy ? <button className="text-button" type="button" onClick={() => void editor.clipJobs.cancel(generation.id)}>Cancel</button> : generation.requestId && ['error', 'cancelled'].includes(generation.phase) ? <button className="text-button" type="button" onClick={() => void editor.clipJobs.resume(generation.id)}>Check result</button> : null}</div>
          <div className="asset-generation-feedback"><ContentIssues issues={issues} label="Generation errors"/><span role="status" title={message}>{message}</span></div>
        </div>
      </details>
      <details className="inspector-group"><summary>Versions<span>{generation.versions.length}</span></summary><div className="asset-versions">{generation.versions.map((v, i) => <button type="button" key={v.assetId} aria-pressed={project?.storyFlow?.nodes.find(n=>n.generationId===generation.id)?.source?.assetId === v.assetId} draggable onDragStart={e => startLibraryDrag(e, { assetId: v.assetId })} onClick={() => editor.clipJobs.selectVersion(generation.id, v.assetId)}>v{i + 1} · {assetModel(v.settings.model)?.name}</button>)}</div></details>
    </form>}
  </div>;
}
