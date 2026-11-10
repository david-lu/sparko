import { z } from 'zod';
import { TIMELINE_FPS } from '../../../shared/constants';

const frame = z.number().int().min(0).max(1e8);
export const audioLayerSchema = z.object({
  id: z.uuid(), assetId: z.uuid(), name: z.string().min(1).max(1000),
  /** Project playback time; independent of the clip currently on screen. */
  startFrame: frame,
  inFrame: frame, outFrame: frame.positive(),
  volume: z.number().finite().min(0).max(1), muted: z.boolean(),
}).refine(layer => layer.outFrame > layer.inFrame, 'Choose an audio out point after its in point.');
export const audioLayersSchema = z.array(audioLayerSchema).max(1000)
  .refine(layers => new Set(layers.map(layer => layer.id)).size === layers.length, 'Duplicate audio layers.');
export type AudioLayer = z.infer<typeof audioLayerSchema>;
export const audioLayerEnd = (layer: AudioLayer) => layer.startFrame + layer.outFrame - layer.inFrame;

/** Frame-based placement, with a sample-accurate source position between frames. */
export function activeAudioLayers(layers: readonly AudioLayer[] | undefined, time: number) {
  const frame = time * TIMELINE_FPS;
  return (layers ?? []).filter(layer => !layer.muted && layer.volume > 0 && frame >= layer.startFrame && frame < audioLayerEnd(layer))
    .map(layer => ({ layer, time: (layer.inFrame + frame - layer.startFrame) / TIMELINE_FPS, end: layer.outFrame / TIMELINE_FPS }));
}
