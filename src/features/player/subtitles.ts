import type { TimelineComposition } from '../../media/TimelineComposition';

/** Shift source subtitles with the footage and leave generated scenes free of source dialogue. */
export function remapSubtitles(track: TextTrack, original: VTTCue[], composition: TimelineComposition | null) {
  for (const cue of Array.from(track.cues || [])) track.removeCue(cue);
  const add = (originalCue: VTTCue, start: number, end: number) => {
    const cue = new VTTCue(start, end, originalCue.text);
    cue.id = originalCue.id; cue.align = originalCue.align; cue.vertical = originalCue.vertical;
    cue.line = originalCue.line; cue.lineAlign = originalCue.lineAlign; cue.snapToLines = originalCue.snapToLines;
    cue.position = originalCue.position; cue.positionAlign = originalCue.positionAlign; cue.size = originalCue.size;
    track.addCue(cue);
  };
  for (const cue of original) {
    if (!composition?.hasInsertions) { add(cue, cue.startTime, cue.endTime); continue; }
    for (const segment of composition.segments) {
      if (segment.kind !== 'source') continue;
      const start = Math.max(cue.startTime, segment.sourceStart);
      const end = Math.min(cue.endTime, segment.sourceStart + (segment.endFrame - segment.startFrame) / composition.fps);
      if (end > start) add(cue, segment.startFrame / composition.fps + start - segment.sourceStart, segment.startFrame / composition.fps + end - segment.sourceStart);
    }
  }
}
