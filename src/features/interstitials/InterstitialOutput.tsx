import type { ReactNode } from 'react';
import { playableResult, type Interstitial } from '../../../shared/interstitials';
import AssetGenerationInfo from '../project/AssetGenerationInfo';
import GeneratedVideoSeed from '../project/GeneratedVideoSeed';
import type { ProjectController } from '../project/ProjectController';
import { assets } from '../project/assets';
import InterstitialPreview from './InterstitialPreview';

export default function InterstitialOutput({ item, projects, details, compact = false, loop = false, active, onPlay }: {
  item: Interstitial; projects?: ProjectController; details?: ReactNode; compact?: boolean; loop?: boolean; active: boolean; onPlay: () => void;
}) {
  const result = playableResult(item);
  const asset = projects?.getSnapshot().project?.library?.find(asset => asset.assetId === result?.assetId);
  const url = result?.fullAssetId ? assets.url(result.fullAssetId) : result?.assetId ? assets.url(result.assetId) : undefined;
  const trimmedLoop = (result?.reference?.mode === 'loop' || loop) && !result?.fullAssetId;
  const downloadName = `${item.label.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'video'}-${trimmedLoop ? 'loop' : 'full'}.mp4`;
  const prompt = result?.prompt ?? (item.phase === 'ready' ? item.requestPrompt : undefined);
  const output = <>
    <GeneratedVideoSeed result={result} settings={asset?.generation?.provider === 'comfy' ? asset.generation.settings : undefined}/>
    {details}
    {result && <details className="interstitial-prompt-details"><summary>Submitted prompt</summary>
      {prompt ? <pre>{prompt}</pre> : <p>The prompt was not saved with this older video.</p>}
      <p>Prompt instructions apply to the generated section. Reference footage keeps its original video and audio.</p>
    </details>}
    <AssetGenerationInfo asset={asset} showPrompt={false} showBreakdown={!details}/>
    {url && <InterstitialPreview url={url} label={item.label} downloadName={downloadName}
      downloadAsset={asset && { ...asset, assetId: result?.fullAssetId ?? asset.assetId }}
      heading={result?.fullAssetId ? 'Full generated video, including references' : trimmedLoop ? 'Loop video' : 'Generated video'}
      active={active} onPlay={onPlay}/>}
  </>;
  return compact ? <details className="inspector-group inspector-output">
    <summary>Generated video<span>{result ? `${(result.fullRange?.totalDuration ?? result.totalDuration).toFixed(2)} s` : 'Not generated'}</span></summary>
    <div className="inspector-group-body">{result ? output : <p className="hint">Generate this clip to see its video and reference breakdown.</p>}</div>
  </details> : output;
}
