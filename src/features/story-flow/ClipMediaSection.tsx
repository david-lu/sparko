import VideoFrameRate from '../project/VideoFrameRate';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import ImageDimensions from '../project/ImageDimensions';
import { FileVideo, Image, Music } from 'lucide-react';
import { playableResult } from '../../../shared/interstitials';
import GeneratedAssetOutput from '../project/GeneratedAssetOutput';
import type { StoryNode } from './model';
import type { StoryEditor } from './useStoryEditor';
import LibraryAssetPicker from '../project/LibraryAssetPicker';
import { assets } from '../project/assets';

export default function ClipMediaSection({ node, editor, children }: { node: StoryNode; editor: StoryEditor; children?: ReactNode }) {
  const choose = useRef<HTMLButtonElement>(null), operation = useRef<AbortController | null>(null), current = useRef(editor); current.current = editor;
  const [picking, setPicking] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => () => { operation.current?.abort(); }, []);
  const project = editor.projects.getSnapshot().project;
  const item = editor.items.find(item => item.id === node.interstitialId), result = item && playableResult(item);
  const id = node.source?.assetId ?? result?.assetId, asset = project?.library?.find(asset => asset.assetId === id);
  const kind = node.source?.kind ?? node.mediaKind ?? 'video', Icon = kind === 'image' ? Image : kind === 'audio' ? Music : FileVideo;
  const replace = async (assetId: string) => {
    if (operation.current) return;
    const task = new AbortController(); operation.current = task; setBusy(true); setError('');
    try {
      await assets.open(assetId); task.signal.throwIfAborted();
      if (current.current.projects.getSnapshot().project?.id !== project?.id) return;
      current.current.replaceAsset(node.id, assetId); setPicking(false);
    } catch (error) { if (!task.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to use this asset.'); }
    finally { if (!task.signal.aborted) { operation.current = null; setBusy(false); } }
  };
  return <>
    <details className="inspector-group inspector-media" open><summary>Media assets</summary>
      {kind==='video'&&<VideoFrameRate assetId={id} projects={editor.projects} onConverted={asset=>editor.selectLibrary({type:'asset',id:asset.assetId})}/>}
      {kind==='image'&&<ImageDimensions assetId={id}/>}
      <div className="clip-media-asset"><Icon size={14} aria-hidden/><span>{asset?.name ?? 'Draft · no media yet'}</span></div>
      <div className="clip-media-actions"><button type="button" className="text-button" disabled={!asset} onClick={() => asset && editor.selectLibrary({ type: 'asset', id: asset.assetId })}>Reveal in Library</button>{!node.generationId&&!node.interstitialId&&<button type="button" className="text-button" onClick={()=>editor.makeGenerative(node.id)}>Generate a new version</button>}</div>
      <button ref={choose} type="button" className="button clip-media-picker" aria-label="Choose clip asset" disabled={busy} onClick={() => { setError(''); setPicking(true); }}>Choose asset…</button>
      {children}
      {!node.interstitialId && (node.generationId || asset?.generation) && <GeneratedAssetOutput asset={asset} kind={kind} onPlay={() => editor.player.pause()}/>}
    </details>
    {picking && <LibraryAssetPicker library={project?.library ?? []} kinds={[kind]} label="clip asset" multiple={false} busy={busy} error={error}
      onChoose={ids => { void replace(ids[0]); }} onClose={() => setPicking(false)} restoreFocus={() => choose.current?.focus()} onPreviewPlay={() => editor.player.pause()}/>}
  </>;
}
