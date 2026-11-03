import { INTERSTITIAL } from '../../../shared/constants';
import { referenceTypes, type Interstitial, type InterstitialSettings, type ReferenceType } from '../../../shared/interstitials';
import InterstitialTimeField from '../interstitials/InterstitialTimeField';
import LoopReferenceHelp from './LoopReferenceHelp';
import { referenceType } from './referenceInputs';
import AssetInput from '../project/AssetInput';
import type { ProjectController } from '../project/ProjectController';
import { TIMELINE_FPS } from '../../../shared/constants';
import { IMAGE_REFERENCE } from '../../../shared/image-references';

export default function StoryReferences({ item, loop, labels, onChange, projects }: {
  item: Interstitial; loop: boolean; labels: { start: string; end: string }; onChange: (settings: Partial<InterstitialSettings>) => void; projects: ProjectController;
}) {
  return <div className="inspector-references">
    {(loop ? ['start'] as const : ['start', 'end'] as const).map(side => {
      const label = loop ? 'Loop' : side === 'start' ? 'Start' : 'End';
      const typeField = side === 'start' ? 'startReferenceType' : 'endReferenceType';
      const videoField = side === 'start' ? 'useInputReference' : 'useOutputReference';
      const imageField = side === 'start' ? 'startImageIndex' : 'endImageIndex';
      const range = side === 'start' ? 'start_range' : 'end_range';
      const arbitraryField = side === 'start' ? 'useStartVideoAsset' : 'useEndVideoAsset', assetField = side === 'start' ? 'startVideoAsset' : 'endVideoAsset';
      const arbitrary = item[arbitraryField], asset = item[assetField];
      const type = referenceType(item, side), index = item[imageField] ?? 0;
      const choose = (value: ReferenceType) => onChange({ [typeField]: value, [videoField]: value === 'video', [imageField]: value === 'image' ? index : undefined });
      return <div className="inspector-reference" role="group" aria-label={`${label} reference`} key={side}>
        <div className="inspector-reference-heading"><span>{label}{loop ? ' · both ends' : ''}</span>{loop && <LoopReferenceHelp />}
          <div className="inspector-options" role="group" aria-label={`${label} reference type`}>
            {referenceTypes.map(value => <button key={value} type="button" aria-pressed={type === value} onClick={() => choose(value)}>{value === 'none' ? 'None' : value === 'video' ? 'Video' : 'Image'}</button>)}
          </div>
        </div>
        {type === 'video' && projects && <label className="reference-video-toggle"><input type="checkbox" aria-label={`Use arbitrary ${label.toLowerCase()} video`} checked={!!arbitrary} onChange={e => onChange({ [arbitraryField]: e.target.checked })}/>Choose another video <small>{arbitrary ? 'Library video' : side === 'start' ? 'Previous video' : 'Next video'}</small></label>}
        {type === 'video' && arbitrary && projects && <><AssetInput key={`${item.id}:${side}:video`} projects={projects} value={asset ? [{ assetId: asset.assetId, name: asset.name, kind: 'video' }] : []} kinds={['video']} multiple={false} label={`${label} video`} onChange={refs => {
          const ref = refs[0], media = projects.getSnapshot().project?.library?.find(a => a.assetId === ref?.assetId);
          onChange({ [assetField]: ref && media ? { assetId: ref.assetId, name: ref.name, inFrame: media.inFrame ?? 0, outFrame: media.outFrame ?? Math.max(1, Math.floor((media.duration ?? 1) * TIMELINE_FPS)) } : undefined });
        }}/>{asset && <div className="range-fields">{(['inFrame', 'outFrame'] as const).map(field => <label className="inspector-property" key={field}><span>{field === 'inFrame' ? 'In (s)' : 'Out (s)'}</span><input aria-label={`${label} video ${field === 'inFrame' ? 'in' : 'out'}`} type="number" min={0} step={1 / TIMELINE_FPS} value={asset[field] / TIMELINE_FPS} onChange={e => {
          const frame = Math.round(e.target.valueAsNumber * TIMELINE_FPS), media = projects.getSnapshot().project?.library?.find(a => a.assetId === asset.assetId);
          if (Number.isFinite(frame)) onChange({ [assetField]: { ...asset, [field]: field === 'inFrame' ? Math.max(0, Math.min(asset.outFrame - 1, frame)) : Math.max(asset.inFrame + 1, Math.min(Math.floor((media?.duration ?? asset.outFrame / TIMELINE_FPS) * TIMELINE_FPS), frame)) } });
        }}/></label>)}</div>}</>}
        {type === 'image' && <AssetInput key={`${item.id}:${side}:image`} projects={projects} kinds={['image']} multiple={false} label={`${label} reference image`} imageFormats={['image/png', 'image/jpeg', 'image/webp']}
          value={item.imageReferences?.[index] ? [{ ...item.imageReferences[index], kind: 'image' }] : []}
          validate={ref => {
            const images = projects.getSnapshot().project?.interstitials.find(i => i.id === item.id)?.imageReferences ?? [];
            return !images.some(image => image.assetId === ref.assetId) && images.length >= IMAGE_REFERENCE.maxCount ? 'Use up to 9 image references. Remove a picture before adding another.' : undefined;
          }}
          onChange={refs => {
            const ref = refs[0];
            if (!ref) { onChange({ [typeField]: 'none', [imageField]: undefined }); return; }
            const images = projects.getSnapshot().project?.interstitials.find(i => i.id === item.id)?.imageReferences ?? [], existing = images.findIndex(image => image.assetId === ref.assetId);
            onChange({ imageReferences: existing >= 0 ? images : [...images, { assetId: ref.assetId, name: ref.name }], [imageField]: existing >= 0 ? existing : images.length, [typeField]: 'image', [videoField]: false });
          }}/>}
        {type !== 'image' && <div className="inspector-reference-source">
          {type === 'video' ? <>
            <span className="inspector-reference-name" title={arbitrary ? asset?.name : labels[side]}>{arbitrary ? asset?.name ?? 'Choose a video above' : labels[side]}</span>
            <InterstitialTimeField name={loop ? 'Loop footage' : range} label={`${label} footage`} value={item[range]} min={INTERSTITIAL.minStartRange} max={INTERSTITIAL.maxRange} step={0.025} onChange={value => onChange({ [range]: value })} />
          </> : <span className="hint">{loop ? 'Generate the loop from your prompt.' : `Let the prompt guide the ${side === 'start' ? 'first' : 'last'} frame.`}</span>}
        </div>}
      </div>;
    })}
  </div>;
}
