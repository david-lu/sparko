import { useEffect, useState } from 'react';
import { Image, Music } from 'lucide-react';
import type { AppStatus } from '../../../shared/contracts';
import type { StoryEditor } from '../story-flow/useStoryEditor';
import { assets } from './assets';
import ContentIssues from '../../shared/ContentIssues';
import AssetThumbnail from './AssetThumbnail';
import AssetDownload from './AssetDownload';
import VideoFrameRate from './VideoFrameRate';
import './asset-inspector.css';
import AssetGenerationInfo from './AssetGenerationInfo';
import GeneratedVideoSeed from './GeneratedVideoSeed';
import { assetUsage } from './assetUsage';
import ImageAssetTools from './ImageAssetTools';

export function AssetPreview({ id, kind, name, onPlay }: { id?: string; kind: string; name: string; onPlay: () => void }) {
  const [url, setUrl] = useState<string>(), [error, setError] = useState('');
  useEffect(() => { let active = true; setUrl(undefined); setError(''); if (id) void assets.open(id).then(result => { if (active) setUrl(result.url); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [id]);
  const failed = () => setError(`The ${kind} file cannot be played or decoded. It may be damaged or unsupported by this browser. Reimport a working file${kind === 'image' ? ' (PNG, JPEG or WebP)' : ''}, or select another generated version.`);
  return <div className="asset-preview"><ContentIssues className="asset-preview-issues" label="Preview errors" issues={error ? [{ key: 'preview', title: `${name} is unavailable`, message: error }] : []}/>{url && !error ? kind === 'image' ? <img src={url} alt={name} onError={failed}/> : kind === 'audio' ? <><Music size={28}/><audio src={url} controls aria-label={`Preview ${name}`} onPlay={onPlay} onError={failed}/></> : <video src={url} controls playsInline preload="metadata" aria-label={`Preview ${name}`} onPlay={onPlay} onError={failed}/> : <><Image size={24}/><span>{error ? 'Preview unavailable · click the red icon for details' : id ? 'Loading preview…' : `Your ${kind} will appear here`}</span></>}</div>;
}
export function AssetSelectionInspector({ editor }: { editor: StoryEditor }) {
  const project = editor.projects.getSnapshot().project;
  const entries = editor.librarySelections.flatMap(selection => {
    const generation = selection.type === 'generation' ? project?.clipGenerations?.find(g => g.id === selection.id) : undefined;
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
export default function AssetInspector({ editor }: { editor: StoryEditor; status: AppStatus | null }) {
  const project = editor.projects.getSnapshot().project, selection = editor.librarySelection;
  const asset = project?.library?.find(asset => asset.assetId === selection?.id);
  if (!asset) return <div className="story-inspector"><p className="hint">Select an asset in the Library.</p></div>;
  const kind = asset.kind === 'generated' ? 'video' : asset.kind;
  const uses = project ? assetUsage(project, [asset.assetId]) : [];
  return <div className="story-inspector clip-inspector asset-inspector" data-project-edit>
    <input key={`${asset.assetId}:${asset.name}`} className="story-name" aria-label="Asset name" defaultValue={asset.name} maxLength={1000}
      onBlur={e => { const name = e.currentTarget.value.trim() || 'Untitled'; editor.projects.editAssets(p => ({ ...p, library: p.library?.map(a => a.assetId === asset.assetId ? { ...a, name } : a) })); }}
      onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.blur(); } }}/>
    <div className="inspector-clip-meta"><span>Media asset · {asset.generation ? 'Generated' : 'Imported'}</span></div>
    {kind === 'video' && <VideoFrameRate projects={editor.projects} onConverted={asset => editor.selectLibrary({ type: 'asset', id: asset.assetId })} assetId={asset.assetId}/>}
    {kind === 'image' && <ImageAssetTools key={asset.assetId} projects={editor.projects} assetId={asset.assetId} onSaved={copy => editor.selectLibrary({ type: 'asset', id: copy.assetId })}/>}
    <details key={`output:${asset.assetId}`} className={`inspector-group${asset.generation ? ' inspector-output' : ''}`} open={!asset.generation}><summary>{asset.generation ? `Generated ${kind}` : 'Preview'}</summary>
      {asset.generation?.provider === 'comfy' && <GeneratedVideoSeed result={asset.generation.result} settings={asset.generation.settings}/>}
      <AssetPreview id={asset.assetId} kind={kind} name={asset.name} onPlay={() => editor.player.pause()}/>
      <div className="asset-preview-actions"><AssetDownload asset={asset}/><button className="text-button" onClick={() => void editor.addAsset(asset.assetId)}>Add to timeline</button></div>
      <AssetGenerationInfo asset={asset}/>
    </details>
    {!!asset.duration && kind !== 'image' && <details className="inspector-group" open><summary>Properties</summary><p className="hint">{asset.duration.toFixed(2)} seconds</p></details>}
    <details className="inspector-group" open><summary>Used in project<span>{uses.length}</span></summary>{uses.length ? uses.map((use, i) => <p className="hint" key={i}>{use.owner} · {use.role}</p>) : <p className="hint">Not used on the timeline.</p>}</details>
  </div>;
}
