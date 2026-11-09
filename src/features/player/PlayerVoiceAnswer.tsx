import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Mic } from 'lucide-react';
import { VOICE_CHOICE } from '../../../shared/constants';
import type { VoiceChoiceContext } from '../../../shared/contracts';
import ChoiceFace from '../call-response/ChoiceFace';
import { answerColorStyle } from '../call-response/model';
import { isMicrophoneEnabled, MicrophoneController } from '../voice-input/MicrophoneController';
import { sendVoiceChoice } from '../voice-input/api';

const buttonStyle = answerColorStyle({ color: { hue: 0, saturation: 0, value: 100 } }, 0) as CSSProperties;

/**
 * Listens for one spoken answer and asks the server which condition it matches.
 * `onAnswer` receives the matched answer ID (null when unclear) and returns false when nothing could be chosen.
 * `onUnavailable` reports that this device cannot record, so the caller can offer buttons instead.
 */
export default function PlayerVoiceAnswer({ context, onAnswer, onUnavailable }: {
  context: VoiceChoiceContext; onAnswer: (answerId: string | null) => boolean; onUnavailable: () => void;
}) {
  const [microphone] = useState(() => new MicrophoneController(VOICE_CHOICE.maxSeconds));
  const mic = useSyncExternalStore(microphone.subscribe, microphone.getSnapshot);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const latest = useRef({ context, onAnswer, onUnavailable });
  latest.current = { context, onAnswer, onUnavailable };

  useEffect(() => {
    let live = true;
    // Start hands-free only when access was already granted, so no permission prompt appears mid-scene.
    void navigator.permissions?.query({ name: 'microphone' as PermissionName }).then(permission => {
      if (live && permission.state === 'granted' && microphone.getSnapshot().phase === 'idle' && !microphone.getSnapshot().audio) void microphone.enable();
    }).catch(() => undefined);
    const hide = () => { if (document.hidden) microphone.cancel(); };
    const leave = () => microphone.cancel();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      microphone.dispose();
    };
  }, [microphone]);

  useEffect(() => {
    if (!mic.audio) return;
    const operation = new AbortController();
    setSending(true); setMessage('');
    sendVoiceChoice(mic.audio, latest.current.context, operation.signal)
      .then(result => { if (!operation.signal.aborted && !latest.current.onAnswer(result.answerId)) setMessage('I didn’t catch that. Tap to try again.'); })
      .catch(error => { if (!operation.signal.aborted) setMessage(error instanceof Error ? error.message : 'Unable to check the answer. Tap to try again.'); })
      .finally(() => { if (!operation.signal.aborted) setSending(false); });
    return () => operation.abort();
  }, [mic.audio]);

  // A denied, missing or unsupported microphone cannot recover inside the scene.
  useEffect(() => { if (mic.error) latest.current.onUnavailable(); }, [mic.error]);

  const busy = sending || mic.phase === 'stopping';
  const state = busy ? 'thinking' : mic.phase === 'recording' ? 'hearing' : mic.phase === 'listening' ? 'listening'
    : mic.phase === 'requesting' || mic.phase === 'loading' ? 'starting' : 'idle';
  const label = { thinking: 'Thinking…', hearing: 'Hearing you…', listening: 'Listening…', starting: 'Starting mic…', idle: message ? 'Try again' : 'Tap to talk' }[state];
  const status = message || mic.error || (state === 'listening' ? 'Say your answer' : state === 'hearing' ? 'Pause when you’re done' : '');
  return <>
    <button className="choice-button voice-answer-button" style={buttonStyle} data-state={state}
      aria-label={`Answer out loud: ${label}`} aria-busy={busy} aria-disabled={busy || state === 'starting'}
      onClick={() => {
        if (busy || state === 'starting') return;
        if (mic.phase === 'recording') void microphone.stop();
        else if (isMicrophoneEnabled(mic)) microphone.cancel();
        else { setMessage(''); void microphone.enable(); }
      }} onKeyDown={event => { if (event.key === ' ') event.stopPropagation(); }}>
      <ChoiceFace><Mic size={18} aria-hidden className="voice-answer-icon" />{label}</ChoiceFace>
    </button>
    <p className="player-voice-status" role="status">{status}</p>
  </>;
}
