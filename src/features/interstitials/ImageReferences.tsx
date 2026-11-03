import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { IMAGE_REFERENCE, type ImageReference } from '../../../shared/image-references';
import { assets } from '../project/assets';
import { prepareImageReference } from './image-references';

function Thumbnail({ reference, index, onRemove, disabled }: { reference: ImageReference; index: number; onRemove: () => void; disabled: boolean }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let active = true;
    void assets.open(reference.assetId).then(value => { if (active) setUrl(value.url); }).catch(() => undefined);
    return () => { active = false; };
  }, [reference.assetId]);
  return <li>
    <div className="image-reference-thumb">{url && <img src={url} alt={reference.name} />}</div>
    <span title={reference.name}><strong>{`<Picture ${index + 1}>`}</strong><small>{reference.name}</small></span>
    <button type="button" className="icon-button" aria-label={`Remove Picture ${index + 1}`} disabled={disabled} onClick={onRemove}><X size={14} /></button>
  </li>;
}

export default function ImageReferences({ value = [], onChange, onBusyChange }: { value?: ImageReference[]; onChange: (value: ImageReference[]) => void; onBusyChange: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null), operation = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => () => { operation.current?.abort(); }, []);
  const add = async (files: File[]) => {
    if (!files.length || operation.current) return;
    setError('');
    if (value.length + files.length > IMAGE_REFERENCE.maxCount) { setError('H3 supports up to 9 image references.'); return; }
    const task = new AbortController(); operation.current = task; setBusy(true); onBusyChange(true);
    try {
      const added: ImageReference[] = [];
      for (const file of files) added.push(await prepareImageReference(file, task.signal));
      task.signal.throwIfAborted(); onChange([...value, ...added]);
    } catch (error) { if (!task.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to add image references.'); }
    finally { if (!task.signal.aborted) { operation.current = null; setBusy(false); onBusyChange(false); } }
  };
  return <div className="field image-references" role="group" aria-label="Image references">
    <div className="image-reference-heading"><span>Image references <small>{value.length}/{IMAGE_REFERENCE.maxCount}</small></span>
      <button type="button" className="button" disabled={busy || value.length >= IMAGE_REFERENCE.maxCount} onClick={() => input.current?.click()}>
        <span className="status-icon">{busy ? <span className="spinner" /> : <ImagePlus size={14} />}</span>{busy ? 'Adding…' : 'Add images'}
      </button>
    </div>
    <input ref={input} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" aria-label="Choose image references" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void add(files); }} />
    <p className="hint">Use {'<Picture 1>'}, {'<Picture 2>'}, etc. in your prompt to guide subjects or style. PNG, JPEG or WebP, up to 20 MB each.</p>
    <ul className="image-reference-list">{value.map((reference, index) => <Thumbnail key={`${reference.assetId}:${index}`} reference={reference} index={index} disabled={busy} onRemove={() => { setError(''); onChange(value.filter((_, i) => i !== index)); }} />)}</ul>
    <div className="image-reference-feedback" role="status" title={error}>{error}</div>
  </div>;
}
