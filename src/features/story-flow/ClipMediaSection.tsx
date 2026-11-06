import VideoFrameRate from '../project/VideoFrameRate';
import { FileVideo, Image, Music } from 'lucide-react';
import { playableResult } from '../../../shared/interstitials';
import AssetGenerationInfo from '../project/AssetGenerationInfo';
import type { StoryNode } from './model';
import type { StoryEditor } from './useStoryEditor';

export default function ClipMediaSection({ node, editor }: { node: StoryNode; editor: StoryEditor }) {
  const project = editor.projects.getSnapshot().project;
  const item = editor.items.find(item => item.id === node.interstitialId), result = item && playableResult(item);
  const id = node.source?.assetId ?? result?.assetId, asset = project?.library?.find(asset => asset.assetId === id);
  const kind = node.source?.kind ?? node.mediaKind ?? 'video', Icon = kind === 'image' ? Image : kind === 'audio' ? Music : FileVideo;
  const candidates = project?.library?.filter(asset => kind === 'image' ? asset.kind === 'image' : kind === 'audio' ? asset.kind === 'audio' : ['video', 'generated'].includes(asset.kind)) ?? [];
  return <>
    <details className="inspector-group" open><summary>Media asset</summary>
      {kind==='video'&&<VideoFrameRate assetId={id} projects={editor.projects} onConverted={asset=>editor.selectLibrary({type:'asset',id:asset.assetId})}/>}
      <div className="clip-media-asset"><Icon size={14} aria-hidden/><span>{asset?.name ?? 'Draft · no media yet'}</span></div>
      <div className="clip-media-actions"><button type="button" className="text-button" disabled={!asset} onClick={() => asset && editor.selectLibrary({ type: 'asset', id: asset.assetId })}>Reveal in Library</button>{!node.generationId&&!node.interstitialId&&<button type="button" className="text-button" onClick={()=>editor.makeGenerative(node.id)}>Generate a new version</button>}</div>
      <select className="clip-media-picker" aria-label="Replace clip asset" value="" onChange={event => { if (event.target.value) editor.replaceAsset(node.id, event.target.value); }}>
        <option value="">{asset ? 'Replace asset…' : 'Choose an existing asset…'}</option>{candidates.filter(asset => asset.assetId !== id).map(asset => <option key={asset.assetId} value={asset.assetId}>{asset.name}</option>)}
      </select>
    </details>
    <AssetGenerationInfo asset={asset}/>
  </>;
}
