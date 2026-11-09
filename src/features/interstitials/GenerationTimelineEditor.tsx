import { INTERSTITIAL, MASK_TRANSITION, TIMELINE_FPS } from '../../../shared/constants';
import { comfyReferenceRange } from '../../../shared/comfy';
import { normalizeGenerationMethod, playableResult, type Interstitial } from '../../../shared/interstitials';
import type { MediaInfo } from '../../media/media';
import type { InterstitialController } from './InterstitialController';
import type { ProjectController } from '../project/ProjectController';
import { assets } from '../project/assets';
import { useAssetAvailability } from '../project/useAssetAvailability';
import { referenceTiming } from '../call-response/generation';
import GenerationTimeline from './GenerationTimeline';
import ImageReferences from './ImageReferences';
import InterstitialTimeField from './InterstitialTimeField';

const ignoreBusy = () => {};
/** Generation inputs and transport have no dependency on the story player or prompt editor. */
export default function GenerationTimelineEditor({ selected, controller, info, projects, minDuration, workspace = false, onPreviewPlay, onImagesBusyChange = ignoreBusy }: {
  selected: Interstitial; controller: InterstitialController; info: MediaInfo | null; projects?: ProjectController;
  minDuration: number; workspace?: boolean; onPreviewPlay: () => void; onImagesBusyChange?: (busy: boolean) => void;
}) {
  const dependency = controller.dependency(selected.id), method = normalizeGenerationMethod(selected.method), currentResult = playableResult(selected);
  const resultId = currentResult?.fullAssetId ?? currentResult?.assetId;
  useAssetAvailability([resultId, dependency?.reference?.before?.assetId, dependency?.reference?.after?.assetId]);
  const fullVideoUrl = resultId ? assets.url(resultId) : undefined;
  let comfyPlan: ReturnType<typeof comfyReferenceRange>['plan'] | undefined;
  try {
    const timing = dependency?.reference && referenceTiming(selected, dependency.reference);
    comfyPlan = comfyReferenceRange(timing ? { ...selected, time: timing.time } : selected, timing?.duration || info?.duration || selected.duration).plan;
  } catch { /* Keep invalid drafts editable; the inspector reports validation errors. */ }
  const durationField = <InterstitialTimeField name="Duration" label={method === 'comfy-loop' ? 'Loop duration' : 'Duration'} value={selected.duration} min={minDuration} max={INTERSTITIAL.maxDuration} step={0.25} onChange={value => controller.edit(selected.id, { duration: value })} />;
  const imageControls = <ImageReferences key={`images:${selected.id}`} projects={projects} value={selected.imageReferences} onBusyChange={onImagesBusyChange} onChange={imageReferences => {
    const saved = controller.getSnapshot().items.find(item => item.id === selected.id) ?? selected;
    const remap = (index: number | undefined) => {
      if (index === undefined) return undefined;
      const previous = saved.imageReferences?.[index];
      if (!previous) return index;
      const next = imageReferences.findIndex(image => image.assetId === previous.assetId);
      return next < 0 ? undefined : next;
    };
    const startImageIndex = remap(saved.startImageIndex), endImageIndex = remap(saved.endImageIndex);
    controller.edit(selected.id, { imageReferences, startImageIndex, endImageIndex,
      ...(saved.startImageIndex !== undefined && startImageIndex === undefined ? { startReferenceType: 'none' } : {}),
      ...(saved.endImageIndex !== undefined && endImageIndex === undefined ? { endReferenceType: 'none' } : {}) });
  }} />;

  return <GenerationTimeline key={selected.id} itemId={selected.id} workspace={workspace} generatedUrl={fullVideoUrl} generatedFrames={currentResult ? Math.round((currentResult.fullRange?.totalDuration ?? currentResult.totalDuration) * TIMELINE_FPS) : undefined} item={selected} projects={projects} reference={dependency?.reference}
        prefixFrames={comfyPlan?.prefixFrames ?? (selected.useInputReference === false ? 0 : Math.round(selected.start_range * TIMELINE_FPS))}
        middleFrames={comfyPlan?.middleFrames ?? Math.round(selected.duration * TIMELINE_FPS)}
        suffixFrames={comfyPlan?.suffixFrames ?? (method === 'comfy-extend' || selected.useOutputReference === false ? 0 : Math.round(selected.end_range * TIMELINE_FPS))}
        videoMs={selected.videoMaskTransitionMs ?? selected.maskTransitionMs ?? MASK_TRANSITION.defaultMs}
        audioMs={selected.audioMaskTransitionMs ?? selected.maskTransitionMs ?? MASK_TRANSITION.defaultMs}
        imageControls={imageControls} durationControl={<div className="interstitial-time-fields">{durationField}</div>}
        onPreviewPlay={onPreviewPlay} onChange={patch => controller.edit(selected.id, patch)} onKeyframesChange={update => {
          const current = controller.getSnapshot().items.find(item => item.id === selected.id);
          if (current) controller.edit(selected.id, { keyframes: update(current.keyframes ?? []) });
        }}/>;
}
