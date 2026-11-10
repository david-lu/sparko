import { activeAudioLayers, type AudioLayer } from '../project/audioLayers';
import { assets } from '../project/assets';
import type { PlaybackAudioLayer } from './CanvasMediaDecks';

export function playbackAudioLayers(layers: AudioLayer[] | undefined, time: number): PlaybackAudioLayer[] {
  return activeAudioLayers(layers, time).map(({ layer, time, end }) => {
    const url = assets.url(layer.assetId);
    if (!url) throw new Error(`Audio layer “${layer.name}” is unavailable. Restore its file or mute the layer.`);
    return { key: `audio-layer:${layer.id}:${layer.startFrame}:${layer.inFrame}:${layer.outFrame}`, time, end,
      source: { id: layer.assetId, assetId: layer.assetId, name: layer.name, url, kind: 'audio', volume: layer.volume } };
  });
}
