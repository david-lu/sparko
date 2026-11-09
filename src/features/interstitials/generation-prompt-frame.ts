import { TIMELINE_FPS } from '../../../shared/constants';
import { imagePreview } from '../../media/imagePreview';
import { sampleFrame, type MediaSource } from '../../media/media';
import { assets } from '../project/assets';
import type { GenerationPreviewState, InputPreview } from './generation-preview';

/** Decode the preview's exact source/frame without touching either player's transport. */
export async function captureGenerationPromptFrame(preview: GenerationPreviewState, input: InputPreview | undefined, signal: AbortSignal): Promise<string | undefined> {
  signal.throwIfAborted();
  let source: MediaSource, frame: number;
  if (preview.mode === 'generated') {
    if (!preview.generated) return undefined;
    source = { id: 'generated-preview', name: 'Generated preview', url: preview.generated.url };
    frame = preview.frame;
  } else {
    // A gap or audio-only input has no visual frame. References still accompany
    // the prompt; do not substitute a hidden story frame or switch preview mode.
    if (!input || input.kind === 'audio') return undefined;
    const { asset, url } = await assets.open(input.assetId);
    signal.throwIfAborted();
    if (input.kind === 'image') return imagePreview(asset.blob, signal);
    source = { id: input.assetId, name: input.label, url };
    frame = input.sourceFrame;
  }
  const thumbnail = await sampleFrame(source, frame / TIMELINE_FPS, 512, signal);
  const blob = await (await fetch(thumbnail.url, { signal })).blob();
  return imagePreview(blob, signal);
}
