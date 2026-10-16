import './styles.css';
import { Plus, Trash2 } from 'lucide-react';
import { formatTime } from '../../../shared/contracts';
import type { Pin } from './pins';

type Props = {
  pins: Pin[];
  time: number;
  duration: number;
  onAdd: () => void;
  onSeek: (time: number) => void;
  onRename: (id: string, label: string) => void;
  onRemove: (id: string) => void;
};

export default function PinsPanel({ pins, time, duration, onAdd, onSeek, onRename, onRemove }: Props) {
  return <div className="panel-content">
    <div className="panel-intro"><h2>Timeline pins</h2></div>
    <button className="button full-width" disabled={!duration} onClick={onAdd}><Plus size={16} /> Pin current time<span className="button-trailing">{formatTime(time)}</span></button>
    {!pins.length ? <div className="empty-state"><h3>No pins yet</h3><p>Press <kbd>P</kbd> to mark the playhead.<br />Pins are saved in this browser.</p></div> : <ol className="pin-list">{pins.map((pin, i) => <li key={pin.id} className={Math.abs(pin.time - time) < 0.2 ? 'current' : ''}>
      <button className="pin-number" aria-label={`Jump to pin ${i + 1}`} onClick={() => onSeek(pin.time)}>{i + 1}</button>
      <div className="pin-details"><input aria-label={`Pin ${i + 1} label`} value={pin.label} maxLength={80} onChange={event => onRename(pin.id, event.target.value)} /><button className="text-button pin-time" onClick={() => onSeek(pin.time)}>{formatTime(pin.time, true)}</button></div>
      <button className="icon-button small delete-pin" aria-label={`Remove pin ${i + 1}`} onClick={() => onRemove(pin.id)}><Trash2 size={14} /></button>
    </li>)}</ol>}
  </div>;
}
