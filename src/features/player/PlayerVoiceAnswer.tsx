import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Check, Mic } from 'lucide-react';
import { VOICE_CHOICE } from '../../../shared/constants';
import type { VoiceChoiceContext } from '../../../shared/contracts';
import ChoiceFace from '../call-response/ChoiceFace';
import { answerColorStyle } from '../call-response/model';
import { isMicrophoneEnabled, MicrophoneController } from '../voice-input/MicrophoneController';
import { sendVoiceChoice } from '../voice-input/api';

const pillStyle = answerColorStyle({ color: { hue: 0, saturation: 0, value: 100 } }, 0) as CSSProperties;
/** Whether the microphone is open, and whether it currently hears speech. */
export type ListeningState = 'listening' | 'hearing' | null;

// Two judging errors in a row mean voice cannot work right now, so the buttons take over.
const MAX_FAILURES = 2;

/**
 * Listens hands-free from the moment the scene shows its question and asks the server which condition the answer matches.
 * `onAnswer` receives the matched answer ID (null for the default) and returns false when nothing could be chosen; listening then restarts.
 * `chosen` marks the scene as answered, which stops listening. `onUnavailable` reports that voice cannot be used, so buttons replace it.
 * `onListening` reports while the microphone is open, so the player can show that it is listening.
 */
export default function PlayerVoiceAnswer({ context, chosen, onAnswer, onUnavailable, onListening }: {
  context: VoiceChoiceContext; chosen: boolean; onAnswer: (answerId: string | null) => boolean; onUnavailable: () => void;
  onListening: (state: ListeningState) => void;
}) {
  const [microphone] = useState(() => new MicrophoneController(VOICE_CHOICE.maxSeconds));
  const mic = useSyncExternalStore(microphone.subscribe, microphone.getSnapshot);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const failures = useRef(0);
  const latest = useRef({ context, chosen, onAnswer, onUnavailable, onListening });
  latest.current = { context, chosen, onAnswer, onUnavailable, onListening };

  useEffect(() => {
    // The microphone opens with the scene; nothing needs a tap. The browser asks for permission the first time.
    const listen = () => {
      const state = microphone.getSnapshot();
      if (!document.hidden && !latest.current.chosen && state.phase === 'idle' && !state.audio && !state.error) void microphone.enable();
    };
    const visibility = () => {
      if (!document.hidden) listen();
      else if (isMicrophoneEnabled(microphone.getSnapshot())) microphone.cancel();
    };
    const leave = () => microphone.cancel();
    listen();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', leave);
      microphone.dispose();
    };
  }, [microphone]);

  useEffect(() => {
    if (!mic.audio) return;
    const operation = new AbortController(), { context } = latest.current;
    const listenAgain = (text: string) => { setMessage(text); void microphone.enable(); };
    setSending(true); setMessage('');
    // With only a default condition there is nothing to judge: any answer plays it.
    (context.conditions.length ? sendVoiceChoice(mic.audio, context, operation.signal) : Promise.resolve({ answerId: null }))
      .then(result => {
        if (operation.signal.aborted) return;
        failures.current = 0;
        if (!latest.current.onAnswer(result.answerId)) listenAgain('I didn’t catch that. Say it again.');
      })
      .catch(error => {
        if (operation.signal.aborted) return;
        if (++failures.current >= MAX_FAILURES) latest.current.onUnavailable();
        else listenAgain(error instanceof Error ? error.message : 'Unable to check the answer. Say it again.');
      })
      .finally(() => { if (!operation.signal.aborted) setSending(false); });
    return () => { operation.abort(); setSending(false); };
  }, [mic.audio, microphone]);

  // A denied, missing or unsupported microphone cannot recover inside the scene.
  useEffect(() => { if (mic.error) latest.current.onUnavailable(); }, [mic.error]);
  // An answer chosen any other way, such as during playback seeking, also ends listening.
  useEffect(() => { if (chosen && isMicrophoneEnabled(microphone.getSnapshot())) microphone.cancel(); }, [chosen, microphone]);

  const busy = !chosen && (sending || mic.phase === 'stopping');
  const state = chosen ? 'answered' : busy ? 'thinking' : mic.phase === 'recording' ? 'hearing' : mic.phase === 'listening' ? 'listening' : 'starting';
  const label = { answered: 'Got it!', thinking: 'Thinking…', hearing: 'Hearing you…', listening: 'Listening…', starting: 'Starting mic…' }[state];
  const status = chosen ? '' : state === 'hearing' ? 'Pause when you’re done' : message || (state === 'listening' ? 'Say your answer' : '');
  const listening: ListeningState = state === 'listening' || state === 'hearing' ? state : null;
  useEffect(() => { latest.current.onListening(listening); }, [listening]);
  useEffect(() => () => latest.current.onListening(null), []);
  return <>
    <div className="choice-button voice-answer-indicator" style={pillStyle} data-state={state} role="status" aria-busy={busy}>
      <ChoiceFace>{chosen ? <Check size={18} aria-hidden className="voice-answer-icon" /> : <Mic size={18} aria-hidden className="voice-answer-icon" />}{label}</ChoiceFace>
    </div>
    <p className="player-voice-status" role="status">{status}</p>
  </>;
}
