import { AudioSample } from 'mediabunny';

export const audioVolume = (value?: number) => value === undefined || !Number.isFinite(value) ? 1 : Math.max(0, Math.min(1, value));

/** The caller owns the returned sample; the source sample is left untouched. */
export function scaleAudioSample(sample: AudioSample, volume: number) {
  const data = new Float32Array(sample.numberOfFrames * sample.numberOfChannels), gain = audioVolume(volume);
  for (let channel = 0; channel < sample.numberOfChannels; channel++) {
    sample.copyTo(data.subarray(channel * sample.numberOfFrames, (channel + 1) * sample.numberOfFrames), { planeIndex: channel, format: 'f32-planar' });
  }
  for (let index = 0; index < data.length; index++) data[index] *= gain;
  return new AudioSample({ data, format: 'f32-planar', sampleRate: sample.sampleRate, numberOfChannels: sample.numberOfChannels, timestamp: sample.timestamp });
}
