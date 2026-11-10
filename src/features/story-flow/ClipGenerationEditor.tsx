import { generationPrompt, promptSettingsPatch } from '../../../shared/prompt-versions';
import EnhancedPromptField from '../interstitials/EnhancedPromptField';
import GenerationLora from '../project/GenerationLora';
import { useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Sparkles } from 'lucide-react';
import { ASSET_MODELS, assetModel, audioModelSettings, generationBusy, validateAssetSettings, type AssetGeneration, type AssetSettings } from '../../../shared/asset-generation';
import { IMAGE_PROMPT_GUIDES } from '../../../shared/image-prompt-guides';
import { AUDIO_PROMPT_GUIDES } from '../../../shared/audio-prompt-guides';
import { castDialogueVoices } from '../../../shared/dialogue-script';
import type { AppStatus } from '../../../shared/contracts';
import type { StoryEditor } from './useStoryEditor';
import { startLibraryDrag } from './libraryDrag';
import { assets } from '../project/assets';
import { useAssetAvailability } from '../project/useAssetAvailability';
import ContentIssues from '../../shared/ContentIssues';
import AssetInput from '../project/AssetInput';
import EnhancePromptActions from '../interstitials/EnhancePromptActions';
import { useAssetPromptEnhancement } from '../project/useAssetPromptEnhancement';
import { ProjectCharacterDialog } from '../project/ProjectCharacters';
import AudioGenerationOptions, { DialogueCast } from './AudioGenerationOptions';
import '../project/asset-inspector.css';

const placeholders = {
  dialogue: 'Mara: [whispers] Did you hear that?\nTheo: It’s just the wind… right?',
  music: 'Describe the genre, mood, instruments, tempo and any lyrics…',
  'sound-effects': 'Describe the sound, its source and the space, e.g. a heavy wooden door creaks open in a stone hallway…',
};

export default function ClipGenerationEditor({ editor, generation, status }: { editor: StoryEditor; generation: AssetGeneration; status: AppStatus | null }) {
  const project = editor.projects.getSnapshot().project, settings = generation.settings, model = assetModel(settings.model), kind = generation.kind;
  const promptId = useId(), enhancement = useAssetPromptEnhancement(editor, generation, !!status?.providers.openai), busy = generationBusy(generation);
  const promptField = useRef<HTMLTextAreaElement>(null), castTrigger = useRef<HTMLElement | null>(null), [addingCharacter, setAddingCharacter] = useState(false);
  useAssetAvailability(settings.references.map(ref => ref.assetId));
  const audioType = model?.audioType, elevenlabs = model?.provider === 'elevenlabs' || kind === 'audio';
  const connected = elevenlabs ? !!status?.providers.elevenlabs : !!status?.providers.fal;
  const guide = model && (kind === 'image' ? IMAGE_PROMPT_GUIDES[model.id] : AUDIO_PROMPT_GUIDES[model.id]);
  const missingReferences = settings.references.flatMap(ref => assets.error(ref.assetId) ? [{ key: ref.assetId, title: `${ref.name} reference`, message: assets.error(ref.assetId)! }] : []);
  // Dialogue voices come from the project's characters and are checked before generation.
  const validation = validateAssetSettings(settings) ?? (audioType === 'dialogue' ? castDialogueVoices(generationPrompt(settings), project?.characters).error : undefined);
  const issues = [...missingReferences, ...(generation.error ? [{ key: 'generation', title: 'Generation failed', message: generation.error }] : []), ...(validation && settings.prompt.trim() ? [{ key: 'settings', title: 'Generation settings', message: validation }] : [])];
  const update = (patch: Partial<AssetSettings>) => editor.clipJobs.edit(generation.id, { settings: { ...generation.settings, ...promptSettingsPatch(generation.settings, patch) } });
  const message = generation.error || missingReferences[0]?.message || (busy ? generation.phase === 'queued' ? 'Queued' : generation.phase === 'loading' ? 'Saving output…' : 'Generating…'
    : !connected ? elevenlabs ? 'Connect ElevenLabs with ELEVENLABS_API_KEY in .env.' : 'Connect fal with FAL_KEY in .env.' : generation.phase === 'cancelled' ? 'Cancelled' : validation || 'Ready to generate');
  /** Start a new turn at the end of the script and put the caret after the name, so typing continues the line. */
  const insertSpeaker = (name: string) => {
    const value = settings.prompt.replace(/[ \t]+$/, ''), next = `${value}${value && !value.endsWith('\n') ? '\n' : ''}${name}: `;
    // Render the new text before focusing, so keys typed right after the click land after the name.
    flushSync(() => update({ prompt: next }));
    const field = promptField.current; if (!field) return;
    field.focus(); field.setSelectionRange(next.length, next.length);
  };
  if (kind === 'video') return <div className="clip-generation-editor">
    <p className="hint">Video generation uses Comfy H3. Previous outputs remain in the Library.</p>
    <button type="button" className="button" disabled={busy} onClick={() => {
      const node = project?.storyFlow?.nodes.find(node => node.generationId === generation.id);
      if (node) editor.makeGenerative(node.id);
    }}>Use H3</button>
  </div>;
  const models = ASSET_MODELS.filter(m => m.kind === generation.kind);
  return <div className="clip-generation-editor">
    {model && <form onSubmit={e => { e.preventDefault(); if (!enhancement.enhancing && !missingReferences.length) void editor.clipJobs.generate(generation.id); }}>
      <details className="inspector-group" open><summary>Generation settings<span>{elevenlabs ? 'ElevenLabs' : 'fal'}</span></summary>
        <label className="inspector-property"><span>Model</span><select aria-label="Generation model" value={model.id} onChange={e => {
          const next = assetModel(e.target.value)!;
          if (next.kind === 'audio') { const { model, duration } = audioModelSettings(settings, next.id); update({ model, duration, count: 1 }); }
          else update({ model: next.id, resolution: (next.resolutions.includes(settings.resolution) ? settings.resolution : next.resolutions[0] || '1K') as AssetSettings['resolution'], count: 1 });
        }}>{!models.includes(model) && <option value={model.id} disabled>{model.name} (retired)</option>}{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        {(kind === 'image' || settings.lora) && <GenerationLora key={`${generation.id}:${model.id}`} model={model.id} value={settings.lora} instructions={settings.loraInstructions} strength={settings.loraStrength} loras={project?.loras} onChange={(lora, loraInstructions, loraStrength) => update({ lora, loraInstructions, loraStrength })} onStrengthChange={loraStrength => update({ loraStrength })}/>}
        <div className="field inspector-prompt"><div className="prompt-field-heading"><label htmlFor={promptId}>{audioType === 'dialogue' ? 'Original script' : 'Original prompt'}</label>
          {guide && <EnhancePromptActions key={generation.id} promptId={promptId} enhancing={enhancement.enhancing} enabled={!busy && !!settings.prompt.trim() && !missingReferences.length} connected={!!status?.providers.openai}
            unavailableReason={busy ? 'Wait for generation to finish before enhancing this prompt.' : missingReferences.length ? 'Restore or remove the missing reference images before enhancing.' : undefined}
            editsBoth={!!settings.enhancedPrompt?.trim()} description={`Enhance with OpenAI following ${guide.title}`} onEnhance={() => void enhancement.enhance()} onEdit={enhancement.enhance} onCancel={enhancement.cancel}/>}
        </div><textarea ref={promptField} id={promptId} aria-label="Generation prompt" rows={audioType === 'dialogue' ? 5 : 4} value={settings.prompt} maxLength={8000}
          placeholder={audioType ? placeholders[audioType] : settings.references.length ? 'Describe the result or the changes to make…' : `Describe the ${kind} to create…`} onChange={e => update({ prompt: e.target.value })}/>
          {audioType === 'dialogue' && <DialogueCast characters={project?.characters ?? []} disabled={busy} onInsert={insertSpeaker} onAdd={element => { castTrigger.current = element; setAddingCharacter(true); }}/>}
          {guide && <EnhancedPromptField value={settings} onChange={update}/>}
          {guide && <a className="asset-prompt-guide" href={guide.url} target="_blank" rel="noreferrer">{model.name} prompt guide ↗</a>}
        </div>
        {(model.inputs.length > 0 || settings.references.length > 0) && <details className="inspector-group" open><summary>Reference assets<span>Optional</span></summary><AssetInput key={`${generation.id}:${model.id}`} projects={editor.projects} value={settings.references} kinds={model.inputs} onChange={references => update({ references })} onPreviewPlay={() => editor.player.pause()}/><p className="hint asset-capabilities">Accepts {model.inputs.join(', ') || 'no references'}{model.kind === 'video' ? ' · First image sets the start frame.' : ''}</p></details>}
        {kind !== 'audio' && <label className="inspector-property"><span>Aspect ratio</span><select aria-label="Generation aspect ratio" value={settings.aspectRatio} onChange={e => update({ aspectRatio: e.target.value as AssetSettings['aspectRatio'] })}>{['16:9', '9:16', '1:1', '4:3', '3:4'].map(r => <option key={r}>{r}</option>)}</select></label>}
        {model.resolutions.length > 0 && <label className="inspector-property"><span>Resolution</span><select aria-label="Generation resolution" value={settings.resolution} onChange={e => update({ resolution: e.target.value as AssetSettings['resolution'] })}>{model.resolutions.map(r => <option key={r}>{r}</option>)}</select></label>}
        {audioType && <AudioGenerationOptions model={model} settings={settings} update={update}/>}
        <div className="asset-generate-actions"><button className="button primary full-width" type="submit" disabled={busy || enhancement.enhancing || !connected || !!validation || !!missingReferences.length}><span className="status-icon">{busy ? <span className="spinner"/> : <Sparkles size={14}/>}</span>{busy ? 'Generating…' : `Generate ${kind}`}</button>
          <div className="asset-secondary-action">{busy ? <button className="text-button" type="button" onClick={() => void editor.clipJobs.cancel(generation.id)}>Cancel</button> : generation.requestId && ['error', 'cancelled'].includes(generation.phase) ? <button className="text-button" type="button" onClick={() => void editor.clipJobs.resume(generation.id)}>Check result</button> : null}</div>
          <div className="asset-generation-feedback"><ContentIssues issues={issues} label="Generation errors"/><span role="status" title={message}>{message}</span></div>
        </div>
      </details>
      <details className="inspector-group"><summary>Versions<span>{generation.versions.length}</span></summary><div className="asset-versions">{generation.versions.map((v, i) => <button type="button" key={v.assetId} aria-pressed={project?.storyFlow?.nodes.find(n=>n.generationId===generation.id)?.source?.assetId === v.assetId} draggable onDragStart={e => startLibraryDrag(e, { assetId: v.assetId })} onClick={() => editor.clipJobs.selectVersion(generation.id, v.assetId)}>v{i + 1} · {assetModel(v.settings.model)?.name}</button>)}</div></details>
    </form>}
    {addingCharacter && <ProjectCharacterDialog projects={editor.projects} status={status} onClose={() => setAddingCharacter(false)}
      restoreFocus={() => { if (castTrigger.current?.isConnected) castTrigger.current.focus(); else promptField.current?.focus(); }}/>}
  </div>;
}
