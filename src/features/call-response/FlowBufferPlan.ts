import { advanceSession, sceneFrames, getScene, type CallResponseFlow, type PlaybackSession } from './model';

export type BufferedVisit = { state: PlaybackSession; startFrame: number; endFrame: number };

/** Maps the continuous media clock onto graph visits, including speculative idle loops. */
export class FlowBufferPlan {
  readonly visits: BufferedVisit[];
  constructor(readonly flow: CallResponseFlow, state: PlaybackSession) {
    this.visits = [{ state, startFrame: 0, endFrame: sceneFrames(getScene(flow, state.sceneId)) - state.frame }];
  }
  append() {
    const previous = this.visits.at(-1)!;
    const state = advanceSession(this.flow, { ...previous.state, playing: true }, previous.endFrame - previous.startFrame);
    if (state.finished) return undefined;
    const visit = { state, startFrame: previous.endFrame, endFrame: previous.endFrame + sceneFrames(getScene(this.flow, state.sceneId)) };
    this.visits.push(visit); return visit;
  }
  visitAt(frame: number) { return this.visits.find(visit => frame < visit.endFrame) ?? this.visits.at(-1)!; }
  at(frame: number, playing: boolean): PlaybackSession {
    const visit = this.visitAt(frame), offset = Math.max(0, Math.min(visit.endFrame - visit.startFrame, Math.floor(frame) - visit.startFrame));
    if (frame >= visit.endFrame) return advanceSession(this.flow, { ...visit.state, playing: true }, visit.endFrame - visit.startFrame);
    return { ...visit.state, playing, frame: visit.state.frame + offset, elapsedFrames: visit.state.elapsedFrames + offset };
  }
  /** Retire speculative visits only after the current loop, leaving its frames untouched. */
  choose(frame: number, state: PlaybackSession, committedFrame = frame) {
    const current = this.visits.indexOf(this.visitAt(frame));
    const index = Math.max(current, this.visits.indexOf(this.visitAt(Math.max(frame, committedFrame - 1))));
    for (const visit of this.visits.slice(current, index + 1)) {
      visit.state = { ...visit.state, outcome: state.outcome, answer: state.answer, attempts: state.attempts };
    }
    this.visits.splice(index + 1);
    return this.visits[index].endFrame;
  }
  prune(beforeFrame: number) {
    while (this.visits.length > 1 && this.visits[1].startFrame <= beforeFrame) this.visits.shift();
  }
}
