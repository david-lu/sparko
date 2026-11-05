import GenerationLora from './GenerationLora';
import { useEffect, useId, useRef, useState } from 'react';
import { Image, Music, Sparkles } from 'lucide-react';
import { ASSET_MODELS, assetModel, generationBusy, newAssetGeneration, validateAssetSettings, type AssetSettings, type MediaKind } from '../../../shared/asset-generation';
import { IMAGE_PROMPT_GUIDES } from '../../../shared/image-prompt-guides';
import type { AppStatus } from '../../../shared/contracts';
import type { StoryEditor } from '../story-flow/useStoryEditor';
import { startLibraryDrag } from '../story-flow/libraryDrag';
import { assets } from './assets';
import { useAssetAvailability } from './useAssetAvailability';
import ContentIssues from '../../shared/ContentIssues';
import AssetInput from './AssetInput';
import AssetThumbnail from './AssetThumbnail';
import AssetVolumeControl from './AssetVolumeControl';
import AssetDownload from './AssetDownload';
import { assetVolume } from './assetVolume';
import VideoFrameRate from './VideoFrameRate';
import EnhancePromptActions from '../interstitials/EnhancePromptActions';
import { useImagePromptEnhancement } from './useImagePromptEnhancement';
import './asset-inspector.css';

export function AssetPreview({ id, kind, name, onPlay }: { id?: string; kind: string; name: string; onPlay: () => void }) {
  const [url, setUrl] = useState<string>(), [error, setError] = useState('');
  useEffect(() => { let active = true; setUrl(undefined); setError(''); if (id) void assets.open(id).then(result => { if (active) setUrl(result.url); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [id]);
  const failed = () => setError(`The ${kind} file cannot be played or decoded. It may be damaged or unsupported by this browser. Reimport a working file${kind === 'image' ? ' (PNG, JPEG or WebP)' : ''}, or select another generated version.`);
  return <div className="asset-preview"><ContentIssues className="asset-preview-issues" label="Preview errors" issues={error ? [{ key: 'preview', title: `${name} is unavailable`, message: error }] : []}/>{url && !error ? kind === 'image' ? <img src={url} alt={name} onError={failed}/> : kind === 'audio' ? <><Music size={28}/><audio src={url} controls aria-label={`Preview ${name}`} onPlay={onPlay} onError={failed}/></> : <video src={url} controls playsInline preload="metadata" aria-label={`Preview ${name}`} onPlay={onPlay} onError={failed}/> : <><Image size={24}/><span>{error ? 'Preview unavailable · click the red icon for details' : id ? 'Loading preview…' : `Your ${kind} will appear here`}</span></>}</div>;
}
export function AssetSelectionInspector({ editor }: { editor: StoryEditor }) {
  const project = editor.projects.getSnapshot().project;
  const entries = editor.librarySelections.flatMap(selection => {
    const generation = selection.type === 'generation' ? project?.assetGenerations?.find(g => g.id === selection.id) : undefined;
    const asset = project?.library?.find(a => a.assetId === (generation ? generation.selectedAssetId : selection.id));
    return generation || asset ? [{ key: `${selection.type}:${selection.id}`, name: generation?.name ?? asset!.name, kind: generation?.kind ?? asset!.kind, asset, generated: !!generation }] : [];
  });
  return <section className="story-inspector asset-selection-inspector" aria-label="Selected assets">
    <h2>{entries.length} assets selected</h2>
    <ul>{entries.map(entry => <li key={entry.key}>
      <AssetThumbnail asset={entry.asset} kind={entry.kind} name={entry.name}/>
      <span className="library-asset-name"><strong title={entry.name}>{entry.name}</strong><small>{entry.kind === 'generated' ? 'video' : entry.kind}{entry.generated ? ' generation' : ''}</small></span>
    </li>)}</ul>
  </section>;
}
export default function AssetInspector({ editor, status }: { editor: StoryEditor; status: AppStatus | null }) {
  const project = editor.projects.getSnapshot().project, selection = editor.librarySelection;
  const generation = selection?.type === 'generation' ? project?.assetGenerations?.find(g => g.id === selection.id) : undefined;
  const asset = selection?.type === 'asset' ? project?.library?.find(a => a.assetId === selection.id) : project?.library?.find(a => a.assetId === generation?.selectedAssetId);
  const [compare, setCompare] = useState(false), heading = useRef<HTMLInputElement>(null);
  const promptId = useId(), enhancement = useImagePromptEnhancement(editor, generation, !!status?.providers.openai);
  useAssetAvailability(generation?.settings.references.map(ref => ref.assetId) ?? []);
  useEffect(() => setCompare(false), [selection?.id]);
  if (!generation && !asset) return <div className="story-inspector"><p className="hint">Select an asset in the Library.</p></div>;
  const kind = generation?.kind ?? (asset?.kind === 'generated' ? 'video' : asset!.kind), name = generation?.name ?? asset!.name;
  const settings = generation?.settings, model = settings && assetModel(settings.model), busy = generation && generationBusy(generation);
  const missingReferences = settings?.references.flatMap(ref => assets.error(ref.assetId) ? [{ key: ref.assetId, title: `${ref.name} reference`, message: assets.error(ref.assetId)! }] : []) ?? [];
  const validation = settings && validateAssetSettings(settings);
  const issues = [...missingReferences, ...(generation?.error ? [{ key: 'generation', title: 'Generation failed', message: generation.error }] : []), ...(validation && settings?.prompt.trim() ? [{ key: 'settings', title: 'Generation settings', message: validation }] : [])];
  const update = (patch: Partial<AssetSettings>) => {
    const current = editor.projects.getSnapshot().project?.assetGenerations?.find(g => g.id === generation?.id);
    if (current) editor.assetJobs.edit(current.id, { settings: { ...current.settings, ...patch } });
  };
  const editImage = () => {
    if (!asset) return;
    if (generation) { update({ prompt: '', references: [{ assetId: asset.assetId, name: asset.name, kind: 'image' }] }); return; }
    const draft = newAssetGeneration('image', asset.folderId, project?.loras);
    draft.name = `${asset.name} edit`.slice(0, 1000); draft.settings.references = [{ assetId: asset.assetId, name: asset.name, kind: 'image' }];
    editor.projects.editAssets(p => ({ ...p, assetGenerations: [...p.assetGenerations ?? [], draft] })); editor.selectLibrary({ type: 'generation', id: draft.id });
  };
  const message = generation?.error || missingReferences[0]?.message || (busy ? generation.phase === 'queued' ? 'Queued on fal' : generation.phase === 'loading' ? 'Saving output…' : 'Generating…' : !status?.providers.fal && generation ? 'Connect fal with FAL_KEY in .env.' : generation?.phase === 'cancelled' ? 'Cancelled' : settings ? validation || 'Ready to generate' : '');
  return <div className="story-inspector clip-inspector asset-inspector" data-project-edit>
    <input key={`${selection?.id}:${name}`} ref={heading} className="story-name" aria-label="Asset name" defaultValue={name} maxLength={1000} onBlur={e => {
      const name = e.currentTarget.value.trim() || 'Untitled';
      if (generation) editor.assetJobs.edit(generation.id, { name }); else editor.projects.editAssets(p => ({ ...p, library: p.library?.map(a => a.assetId === asset!.assetId ? { ...a, name } : a) }));
    }} onKeyDown={e => {
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); }
    }}/>
    <div className="inspector-clip-meta">{kind}{generation ? ` generation · ${generation.phase}` : ' · Imported'}</div>
    {kind === 'video' && <VideoFrameRate projects={editor.projects} onConverted={asset => editor.selectLibrary({ type: 'asset', id: asset.assetId })} assetId={asset?.assetId}/>}
    <details className="inspector-group" open><summary>Preview</summary><AssetPreview id={compare ? settings?.references.find(r => r.kind === 'image')?.assetId : generation?.selectedAssetId ?? asset?.assetId} kind={kind} name={name} onPlay={() => editor.player.pause()}/>
      <div className="asset-preview-actions">{asset && (kind === 'image' ? <a className="text-button" href={assets.url(asset.assetId)} download={asset.name}>Download</a> : <AssetDownload asset={{ ...asset, volume: assetVolume(project?.library, asset.assetId) }}/>)}{asset && (kind === 'video' || kind === 'image') && <button className="text-button" onClick={() => void editor.addAsset(asset.assetId)}>Add to timeline</button>}{asset && kind === 'image' && <button className="text-button" onClick={editImage}>Edit image</button>}{asset && settings?.references.some(r => r.kind === 'image') && <button className="text-button" aria-pressed={compare} onClick={() => setCompare(!compare)}>{compare ? 'Show result' : 'Compare original'}</button>}</div>
    </details>
    {(kind === 'audio' || kind === 'video') && <AssetVolumeControl projects={editor.projects} assetId={asset?.assetId}/>}
    {generation && settings && model && <form onSubmit={e => { e.preventDefault(); if (!enhancement.enhancing && !missingReferences.length) void editor.assetJobs.generate(generation.id); }}>
      <details className="inspector-group" open><summary>Generation<span>fal</span></summary>
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
          <div className="asset-secondary-action">{busy ? <button className="text-button" type="button" onClick={() => void editor.assetJobs.cancel(generation.id)}>Cancel</button> : generation.requestId && ['error', 'cancelled'].includes(generation.phase) ? <button className="text-button" type="button" onClick={() => void editor.assetJobs.resume(generation.id)}>Check result</button> : null}</div>
          <div className="asset-generation-feedback"><ContentIssues issues={issues} label="Generation errors"/><span role="status" title={message}>{message}</span></div>
        </div>
      </details>
      <details className="inspector-group"><summary>Versions<span>{generation.versions.length}</span></summary><div className="asset-versions">{generation.versions.map((v, i) => <button type="button" key={v.assetId} aria-pressed={generation.selectedAssetId === v.assetId} draggable onDragStart={e => startLibraryDrag(e, { assetId: v.assetId })} onClick={() => editor.assetJobs.edit(generation.id, { selectedAssetId: v.assetId }, false)}>v{i + 1} · {assetModel(v.settings.model)?.name}</button>)}</div></details>
    </form>}
    {!generation && asset && <details className="inspector-group" open><summary>Properties</summary><p className="hint">{asset.width && asset.height ? `${asset.width} × ${asset.height}` : ''}{asset.duration ? `${asset.duration.toFixed(2)} seconds` : ''}</p></details>}
  </div>;
}
