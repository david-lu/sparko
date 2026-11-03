import { INTERSTITIAL } from '../../../shared/constants';
import { referenceTypes, type Interstitial, type InterstitialSettings, type ReferenceType } from '../../../shared/interstitials';
import InterstitialTimeField from '../interstitials/InterstitialTimeField';
import LoopReferenceHelp from './LoopReferenceHelp';
import { referenceType } from './referenceInputs';

export default function StoryReferences({ item, loop, labels, onChange }: {
  item: Interstitial; loop: boolean; labels: { start: string; end: string }; onChange: (settings: Partial<InterstitialSettings>) => void;
}) {
  return <div className="inspector-references">
    {(loop ? ['start'] as const : ['start', 'end'] as const).map(side => {
      const label = loop ? 'Loop' : side === 'start' ? 'Start' : 'End';
      const typeField = side === 'start' ? 'startReferenceType' : 'endReferenceType';
      const videoField = side === 'start' ? 'useInputReference' : 'useOutputReference';
      const imageField = side === 'start' ? 'startImageIndex' : 'endImageIndex';
      const range = side === 'start' ? 'start_range' : 'end_range';
      const type = referenceType(item, side), index = item[imageField] ?? 0;
      const choose = (value: ReferenceType) => onChange({ [typeField]: value, [videoField]: value === 'video', [imageField]: value === 'image' ? index : undefined });
      return <div className="inspector-reference" role="group" aria-label={`${label} reference`} key={side}>
        <div className="inspector-reference-heading"><span>{label}{loop ? ' · both ends' : ''}</span>{loop && <LoopReferenceHelp />}
          <div className="inspector-options" role="group" aria-label={`${label} reference type`}>
            {referenceTypes.map(value => <button key={value} type="button" aria-pressed={type === value} onClick={() => choose(value)}>{value === 'none' ? 'None' : value === 'video' ? 'Video' : 'Image'}</button>)}
          </div>
        </div>
        <div className="inspector-reference-source">
          {type === 'video' ? <>
            <span className="inspector-reference-name" title={labels[side]}>{labels[side]}</span>
            <InterstitialTimeField name={loop ? 'Loop footage' : range} label={`${label} footage`} value={item[range]} min={INTERSTITIAL.minStartRange} max={INTERSTITIAL.maxRange} step={0.025} onChange={value => onChange({ [range]: value })} />
          </> : type === 'image' ? <select aria-label={`${label} reference image`} value={item.imageReferences?.[index] ? String(index) : ''} onChange={event => onChange({ [imageField]: Number(event.target.value) })}>
            <option value="" disabled>Add an image below</option>
            {item.imageReferences?.map((image, i) => <option key={`${image.assetId}:${i}`} value={i}>{`Picture ${i + 1} · ${image.name}`}</option>)}
          </select> : <span className="hint">{loop ? 'Generate the loop from your prompt.' : `Let the prompt guide the ${side === 'start' ? 'first' : 'last'} frame.`}</span>}
        </div>
      </div>;
    })}
  </div>;
}
