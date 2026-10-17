import { AudioSample, AudioSampleSink, AudioSampleSource, CanvasSink, CanvasSource, Output, Quality, type Input } from 'mediabunny';
import { ensureAac, openInput } from './media';
import type { TimelineComposition, TimelineSegment } from './TimelineComposition';
import { AudioNormalizer, COMPOSITION_AUDIO_CHANNELS, COMPOSITION_AUDIO_RATE } from './AudioNormalizer';

export const COMPOSITION_MIME = 'video/mp4; codecs="avc1.42002a, mp4a.40.2"';
type Options = { start: number; end: number; signal: AbortSignal; preview?: boolean; beforeFrame?: (time: number) => Promise<void>; onProgress?: (progress: number) => void };

/** Encodes one continuous frame/sample clock, including across different source assets. */
export async function renderComposition(composition: Pick<TimelineComposition, 'info' | 'fps' | 'segments'>, output: Output, options: Options) {
  await ensureAac();
  options.signal.throwIfAborted();
  const scale = options.preview ? Math.min(1, 720 / composition.info.height) : 1;
  const canvas = new OffscreenCanvas(Math.max(2, Math.round(composition.info.width * scale / 2) * 2), Math.max(2, Math.round(composition.info.height * scale / 2) * 2));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Unable to create the timeline renderer.');
  const video = new CanvasSource(canvas, { codec: 'avc', ...(options.preview ? { fullCodecString: 'avc1.42002a' } : {}), quality: new Quality('medium'), keyFrameInterval: 1, latencyMode: 'quality' });
  const audio = new AudioSampleSource({ codec: 'aac', quality: new Quality('medium') });
  const normalizedAudio = new AudioNormalizer(async sample => { options.signal.throwIfAborted(); await audio.add(sample); });
  output.addVideoTrack(video, { frameRate: composition.fps });
  output.addAudioTrack(audio);
  const inputs = new Map<string, Input>();
  const inputFor = (segment: TimelineSegment) => {
    let input = inputs.get(segment.source.url);
    if (!input) { input = openInput(segment.source); inputs.set(segment.source.url, input); }
    return input;
  };
  const cancel = () => {
    for (const input of inputs.values()) input.dispose();
    void normalizedAudio.cancel().catch(() => undefined); void output.cancel().catch(() => undefined);
  };
  options.signal.addEventListener('abort', cancel, { once: true });
  const firstFrame = Math.round(options.start * composition.fps);
  const lastFrame = Math.round(options.end * composition.fps);
  const origin = firstFrame / composition.fps;
  try {
    await output.start();
    const writeVideo = async () => {
      for (const segment of composition.segments) {
        const first = Math.max(firstFrame, segment.startFrame), last = Math.min(lastFrame, segment.endFrame);
        if (first >= last) continue;
        const track = await inputFor(segment).getPrimaryVideoTrack();
        if (!track || !await track.canDecode()) throw new Error(`Unable to decode ${segment.label}.`);
        const sink = new CanvasSink(track, { width: canvas.width, height: canvas.height, fit: 'contain', poolSize: 2 });
        const timestamps = function* () { for (let frame = first; frame < last; frame++) yield segment.sourceStart + (segment.still ? 0 : (frame - segment.startFrame) / composition.fps) + 1e-7; };
        let frame = first;
        for await (const sample of sink.canvasesAtTimestamps(timestamps())) {
          options.signal.throwIfAborted();
          await options.beforeFrame?.(frame / composition.fps);
          if (!sample) throw new Error(`A frame is missing from ${segment.label}.`);
          context.drawImage(sample.canvas, 0, 0);
          await video.add((frame - firstFrame) / composition.fps, 1 / composition.fps, { keyFrame: frame === first || (frame - firstFrame) % Math.max(1, Math.round(composition.fps)) === 0 });
          frame++;
          options.onProgress?.((frame - firstFrame) / (lastFrame - firstFrame));
        }
      }
      video.close();
    };
    const silence = async (from: number, to: number) => {
      let position = Math.round(from * COMPOSITION_AUDIO_RATE);
      const end = Math.round(to * COMPOSITION_AUDIO_RATE);
      while (position < end) {
        options.signal.throwIfAborted();
        await options.beforeFrame?.(origin + position / COMPOSITION_AUDIO_RATE);
        const frames = Math.min(COMPOSITION_AUDIO_RATE / 10, end - position);
        const sample = new AudioSample({ data: new Float32Array(frames * COMPOSITION_AUDIO_CHANNELS), format: 'f32-planar',
          sampleRate: COMPOSITION_AUDIO_RATE, numberOfChannels: COMPOSITION_AUDIO_CHANNELS, timestamp: position / COMPOSITION_AUDIO_RATE });
        try { await normalizedAudio.add(sample); } finally { sample.close(); }
        position += frames;
      }
    };
    const writeAudio = async () => {
      for (const segment of composition.segments) {
        const from = Math.max(firstFrame, segment.startFrame) / composition.fps;
        const to = Math.min(lastFrame, segment.endFrame) / composition.fps;
        if (from >= to) continue;
        const sourceStart = segment.sourceStart + from - segment.startFrame / composition.fps;
        const sourceEnd = sourceStart + to - from;
        const track = segment.still ? null : await inputFor(segment).getPrimaryAudioTrack();
        let cursor = from - origin;
        if (track) {
          if (!await track.canDecode()) throw new Error(`Unable to decode audio in ${segment.label}.`);
          for await (const raw of new AudioSampleSink(track).samples(sourceStart, sourceEnd)) {
            try {
              options.signal.throwIfAborted();
              await options.beforeFrame?.(origin + cursor);
              const first = Math.max(0, Math.round((sourceStart - raw.timestamp) * raw.sampleRate));
              const last = Math.min(raw.numberOfFrames, Math.round((sourceEnd - raw.timestamp) * raw.sampleRate));
              if (last <= first) continue;
              const sample = raw.trim(first, last);
              try {
                const timestamp = from - origin + sample.timestamp - sourceStart;
                if (timestamp > cursor + 1 / raw.sampleRate) await silence(cursor, timestamp);
                sample.setTimestamp(Math.max(cursor, timestamp));
                await normalizedAudio.add(sample);
                cursor = sample.timestamp + sample.duration;
              } finally { sample.close(); }
            } finally { raw.close(); }
          }
        }
        await silence(cursor, to - origin);
      }
      await normalizedAudio.flush();
      audio.close();
    };
    await Promise.all([writeVideo(), writeAudio()]);
    options.signal.throwIfAborted();
    await output.finalize();
  } catch (error) {
    cancel();
    throw error;
  } finally {
    options.signal.removeEventListener('abort', cancel);
    for (const input of inputs.values()) input.dispose();
  }
}
