import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Mic } from 'lucide-react';
import { VOICE_CHOICE } from '../../../shared/constants';
import type { VoiceChoiceContext } from '../../../shared/contracts';
import { isMicrophoneEnabled, MicrophoneController } from '../voice-input/MicrophoneController';
import { sendVoiceChoice } from '../voice-input/api';

// Two judging errors in a row mean voice cannot work right now, so the buttons take over.
const MAX_FAILURES = 2;

/**
 * Listens hands-free from the moment the scene shows its question and asks the server which condition the answer matches.
 * `onAnswer` receives the matched answer ID (null for the default) and returns false when nothing could be chosen; listening then restarts.
 * `chosen` marks the scene as answered, which stops listening. `onUnavailable` reports that voice cannot be used, so buttons replace it.
 * Its only visible part is a small badge in the corner of the video; `leaving` fades it out as the scene ends.
 */
export default function PlayerVoiceAnswer({ context, chosen, leaving = false, onAnswer, onUnavailable }: {
  context: VoiceChoiceContext; chosen: boolean; leaving?: boolean; onAnswer: (answerId: string | null) => boolean; onUnavailable: () => void;
}) {
  const [microphone] = useState(() => new MicrophoneController(VOICE_CHOICE.maxSeconds));
  const mic = useSyncExternalStore(microphone.subscribe, microphone.getSnapshot);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const failures = useRef(0);
  const latest = useRef({ context, chosen, onAnswer, onUnavailable });
  latest.current = { context, chosen, onAnswer, onUnavailable };

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
        if (!latest.current.onAnswer(result.answerId)) listenAgain('Didn’t catch that. Say it again.');
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
  const label = message && (state === 'starting' || state === 'listening') ? message
    : { answered: 'Got it', thinking: 'Thinking…', hearing: 'Hearing you', listening: 'Listening', starting: 'Starting mic…' }[state];
  return <div className="player-voice-cue" data-state={state} data-leaving={leaving || undefined} role="status" aria-busy={busy}>
    {chosen ? <Check size={14} strokeWidth={2.5} aria-hidden /> : <Mic size={14} strokeWidth={2.5} aria-hidden />}
    {(state === 'listening' || state === 'hearing') && <span className="player-voice-bars" aria-hidden><i /><i /><i /></span>}
    <span>{label}</span>
  </div>;
}
