import { z } from 'zod';
import { COMFY } from './constants.js';
import type { TimelineInputRange } from './generation-inputs.js';

export const AUDIO_TRACKS = { maxTracks: 8, maxClips: 64 } as const;
const id = z.string().min(1).max(200);
export const audioTrackClipSchema = z.object({
  id, assetId: z.uuid(), name: z.string().min(1).max(1000),
  /** First frame, relative to the generated section like image keyframes and videos. Negative frames start in the start reference. */
  frame: z.number().int().min(-COMFY.maxFrames).max(COMFY.maxFrames),
  /** Source trim on the 24 fps timeline clock. */
  inFrame: z.number().int().nonnegative().max(1e8), outFrame: z.number().int().positive().max(1e8),
  volume: z.number().finite().min(0).max(1),
}).refine(clip => clip.outFrame > clip.inFrame, 'A sound must end after it starts.');
export const audioTrackSchema = z.object({ id, name: z.string().min(1).max(200), muted: z.boolean(),
  /** Level applied to every sound on the track. Absent is full volume. */
  volume: z.number().finite().min(0).max(1).optional(),
  clips: z.array(audioTrackClipSchema).max(AUDIO_TRACKS.maxClips) });
export const audioTracksSchema = z.array(audioTrackSchema).max(AUDIO_TRACKS.maxTracks).refine(tracks => {
  const ids = tracks.flatMap(track => [track.id, ...track.clips.map(clip => clip.id)]);
  return new Set(ids).size === ids.length;
}, 'Audio track and sound IDs must be unique.');
export type AudioTrack = z.infer<typeof audioTrackSchema>;
export type AudioTrackClip = z.infer<typeof audioTrackClipSchema>;
export const audioClipFrames = (clip: Pick<AudioTrackClip, 'inFrame' | 'outFrame'>) => clip.outFrame - clip.inFrame;
export const audioLevel = (value?: number) => value === undefined || !Number.isFinite(value) ? 1 : Math.max(0, Math.min(1, value));
/** Full volume is stored as absent, so restoring a level never leaves a stale value behind. */
export const storedVolume = (value: number) => audioLevel(value) < 1 ? audioLevel(value) : undefined;
/** A sound's level after its track's level and mute. */
export const soundLevel = (track: Pick<AudioTrack, 'muted' | 'volume'>, clip: Pick<AudioTrackClip, 'volume'>) => track.muted ? 0 : audioLevel(track.volume) * audioLevel(clip.volume);
export const audioTrackAssetIds = (tracks: AudioTrack[] | undefined) => (tracks ?? []).flatMap(track => track.clips.map(clip => clip.assetId));

/** Audible sounds on a clock whose generated section starts at `body`, cut to [0, frames). */
export function audibleClips(tracks: AudioTrack[] | undefined, body: number, frames: number) {
  return (tracks ?? []).flatMap(track => track.clips.flatMap(clip => {
    const start = body + clip.frame, from = Math.max(0, start), to = Math.min(frames, start + audioClipFrames(clip)), volume = soundLevel(track, clip);
    return volume > 0 && to > from ? [{ track, clip, startFrame: from, endFrame: to, inFrame: clip.inFrame + from - start, volume }] : [];
  }));
}

/** Merged spans of added input sound in the generated section, relative to its first frame. */
export function audioInputRanges(tracks: AudioTrack[] | undefined, prefix: number, middle: number): TimelineInputRange[] {
  const spans = audibleClips(tracks, prefix, prefix + middle).flatMap(({ startFrame, endFrame }) => {
    const from = Math.max(0, startFrame - prefix), to = endFrame - prefix;
    return to > from ? [[from, to]] : [];
  }).sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]); else merged.push([...span]);
  }
  return merged.map(([frame, end]) => ({ frame, frames: end - frame }));
}

/** First start at or after `frame` where `frames` fit between the track's other sounds. */
export function freeAudioFrame(track: AudioTrack, frame: number, frames: number, ignoreId?: string) {
  let start = frame;
  for (const clip of track.clips.filter(clip => clip.id !== ignoreId).sort((a, b) => a.frame - b.frame)) {
    if (start < clip.frame + audioClipFrames(clip) && start + frames > clip.frame) start = clip.frame + audioClipFrames(clip);
  }
  return start;
}

/** Move a sound within [min, max]. It may land in any gap that fits; otherwise it stops at its current neighbours. */
export function placeAudioClip(track: AudioTrack, clip: AudioTrackClip, frame: number, min: number, max: number) {
  const others = track.clips.filter(other => other.id !== clip.id), frames = audioClipFrames(clip);
  const target = Math.max(min, Math.min(max, Math.round(frame)));
  if (!others.some(other => target < other.frame + audioClipFrames(other) && target + frames > other.frame)) return target;
  const lower = Math.max(min, ...others.filter(other => other.frame <= clip.frame).map(other => other.frame + audioClipFrames(other)));
  const upper = Math.min(max, ...others.filter(other => other.frame > clip.frame).map(other => other.frame - frames));
  return upper < lower ? clip.frame : Math.max(lower, Math.min(upper, target));
}
/** Longest a sound may become without reaching the next sound on its track. */
export function audioClipRoom(track: AudioTrack, clip: AudioTrackClip) {
  return Math.min(Infinity, ...track.clips.filter(other => other.id !== clip.id && other.frame > clip.frame).map(other => other.frame - clip.frame));
}

export const nextAudioTrackName = (tracks: AudioTrack[]) => {
  let index = tracks.length + 1;
  while (tracks.some(track => track.name === `Audio ${index}`)) index++;
  return `Audio ${index}`;
};
