import { INTERSTITIAL } from '../../../shared/constants';
import { referenceTypes, type Interstitial, type InterstitialSettings, type ReferenceType } from '../../../shared/interstitials';
import InterstitialTimeField from '../interstitials/InterstitialTimeField';
import LoopReferenceHelp from './LoopReferenceHelp';
import { referenceType } from './referenceInputs';
import AssetInput from '../project/AssetInput';
import type { ProjectController } from '../project/ProjectController';
import { videoAssets } from '../../../shared/video-references';
import VideoReferenceSequence from './VideoReferenceSequence';
import { IMAGE_REFERENCE } from '../../../shared/image-references';
import ContentIssues, { type ContentIssue } from '../../shared/ContentIssues';

export default function StoryReferences({ item, loop, labels, onChange, projects, issues = [] }: {
  item: Interstitial; loop: boolean; labels: { start: string; end: string }; onChange: (settings: Partial<InterstitialSettings>) => void; projects: ProjectController;
  issues?: ContentIssue[];
}) {
  return <div className="inspector-references">
    {(loop ? ['start'] as const : ['start', 'end'] as const).map(side => {
      const label = loop ? 'Loop' : side === 'start' ? 'Start' : 'End';
      const typeField = side === 'start' ? 'startReferenceType' : 'endReferenceType';
      const videoField = side === 'start' ? 'useInputReference' : 'useOutputReference';
      const imageField = side === 'start' ? 'startImageIndex' : 'endImageIndex';
      const range = side === 'start' ? 'start_range' : 'end_range';
      const arbitraryField = side === 'start' ? 'useStartVideoAsset' : 'useEndVideoAsset', assetField = side === 'start' ? 'startVideoAsset' : 'endVideoAsset';
      const arbitrary = item[arbitraryField], clips = videoAssets(item, side);
      const sequenceField = side === 'start' ? 'startVideoAssets' : 'endVideoAssets';
      const sequenceLabel = clips.map(clip => clip.name).join(' → ');
      const type = referenceType(item, side), index = item[imageField] ?? 0;
      const choose = (value: ReferenceType) => onChange({ [typeField]: value, [videoField]: value === 'video', [imageField]: value === 'image' ? index : undefined });
      return <div className="inspector-reference" role="group" aria-label={`${label} reference`} key={side}>
        <div className="inspector-reference-heading"><span>{label}{loop ? ' · both ends' : ''}</span><ContentIssues issues={issues.filter(issue => issue.side === side)} label={`${label} reference errors`} />{loop && <LoopReferenceHelp />}
          <div className="inspector-options" role="group" aria-label={`${label} reference type`}>
            {referenceTypes.map(value => <button key={value} type="button" aria-pressed={type === value} onClick={() => choose(value)}>{value === 'none' ? 'None' : value === 'video' ? 'Video' : 'Image'}</button>)}
          </div>
        </div>
        {type === 'video' && projects && <label className="reference-video-toggle"><input type="checkbox" aria-label={`Use arbitrary ${label.toLowerCase()} video`} checked={!!arbitrary} onChange={e => onChange({ [arbitraryField]: e.target.checked })}/>Choose other videos / images <small>{arbitrary ? 'Library sequence' : side === 'start' ? 'Previous clips' : 'Next clips'}</small></label>}
        {type === 'video' && arbitrary && <VideoReferenceSequence key={`${item.id}:${side}:video`} projects={projects} label={label} clips={clips} onChange={next => onChange({
          [sequenceField]: next, [assetField]: side === 'start' ? next.at(-1) : next[0],
        })}/>}
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
            <span className="inspector-reference-name" title={arbitrary ? sequenceLabel : labels[side]}>{arbitrary ? sequenceLabel || 'Choose videos or images above' : labels[side]}</span>
            <InterstitialTimeField name={loop ? 'Loop footage' : range} label={`${label} footage`} value={item[range]} min={INTERSTITIAL.minStartRange} max={INTERSTITIAL.maxRange} step={0.025} onChange={value => onChange({ [range]: value })} />
          </> : <span className="hint">{loop ? 'Generate the loop from your prompt.' : `Let the prompt guide the ${side === 'start' ? 'first' : 'last'} frame.`}</span>}
        </div>}
      </div>;
    })}
  </div>;
}
