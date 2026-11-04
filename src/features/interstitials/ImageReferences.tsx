import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { IMAGE_REFERENCE, type ImageReference } from '../../../shared/image-references';
import { assets } from '../project/assets';
import { useAssetAvailability } from '../project/useAssetAvailability';
import ContentIssues from '../../shared/ContentIssues';
import { prepareImageReference } from './image-references';
import { readLibraryDrag, startLibraryDrag, STORY_DRAG_TYPE } from '../story-flow/libraryDrag';
import type { ProjectController } from '../project/ProjectController';

function Thumbnail({ reference, index, onRemove, disabled }: { reference: ImageReference; index: number; onRemove: () => void; disabled: boolean }) {
  const [url, setUrl] = useState<string>(), [decodeError, setDecodeError] = useState('');
  useAssetAvailability([reference.assetId]);
  const error = assets.error(reference.assetId) || decodeError;
  useEffect(() => {
    let active = true;
    setUrl(undefined); setDecodeError('');
    void assets.open(reference.assetId).then(value => { if (active) setUrl(value.url); }).catch(() => undefined);
    return () => { active = false; };
  }, [reference.assetId]);
  return <li draggable={!disabled} onDragStart={e => { e.stopPropagation(); startLibraryDrag(e, { assetId: reference.assetId }); }}>
    <div className="image-reference-thumb">{url && !error && <img src={url} alt={reference.name} draggable={false} onError={() => setDecodeError('This reference image could not be decoded. Replace it with a working PNG, JPEG or WebP image.')} />}</div>
    <span title={reference.name}><strong>{`<Picture ${index + 1}>`}</strong><small>{reference.name}</small></span>
    <ContentIssues label={`Picture ${index + 1} errors`} issues={error ? [{ key: reference.assetId, title: reference.name, message: error }] : []}/>
    <button type="button" className="icon-button" aria-label={`Remove Picture ${index + 1}`} disabled={disabled} onClick={onRemove}><X size={14} /></button>
  </li>;
}

export default function ImageReferences({ value = [], onChange, onBusyChange, projects }: { value?: ImageReference[]; onChange: (value: ImageReference[]) => void; onBusyChange: (busy: boolean) => void; projects?: ProjectController }) {
  const input = useRef<HTMLInputElement>(null), operation = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [dragging, setDragging] = useState(false);
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
  const addAsset = async (id: string) => {
    if (busy) return;
    try { const { asset } = await assets.open(id); if (!['image/png', 'image/jpeg', 'image/webp'].includes(asset.blob.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
      if (value.some(ref => ref.assetId === id)) { setError(''); return; }
      if (value.length >= IMAGE_REFERENCE.maxCount) throw new Error('Use up to 9 image references.');
      onChange([...value, { assetId: id, name: projects?.getSnapshot().project?.library?.find(a => a.assetId === id)?.name ?? asset.name }]); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to add image.'); }
  };
  return <div className={`field image-references ${dragging ? 'is-dragging' : ''}`} role="group" aria-label="Image references"
    onDragOver={e => { if (e.dataTransfer.types.includes(STORY_DRAG_TYPE) || e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy'; if (!busy) setDragging(true); } }}
    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }} onDragEnd={() => setDragging(false)}
    onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragging(false); if (busy) return; if (e.dataTransfer.files.length) void add([...e.dataTransfer.files]); else { const item = readLibraryDrag(e.dataTransfer); if (item && 'assetId' in item && item.assetId) void addAsset(item.assetId); else setError('Generate the image before using it as a reference.'); } }}>
    <div className="image-reference-heading"><span>Image references <small>{value.length}/{IMAGE_REFERENCE.maxCount}</small></span>
      <button type="button" className="button" disabled={busy || value.length >= IMAGE_REFERENCE.maxCount} onClick={() => input.current?.click()}>
        <span className="status-icon">{busy ? <span className="spinner" /> : <ImagePlus size={14} />}</span>{busy ? 'Adding…' : 'Add images'}
      </button>
    </div>
    <input ref={input} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" aria-label="Choose image references" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void add(files); }} />
    <p className="hint">Drag images from Library, then drag a picture to Start or End. Use {'<Picture 1>'}, {'<Picture 2>'}, etc. for subjects or style. PNG, JPEG or WebP, up to 20 MB each.</p>
    <ul className="image-reference-list">{value.map((reference, index) => <Thumbnail key={`${reference.assetId}:${index}`} reference={reference} index={index} disabled={busy} onRemove={() => { setError(''); onChange(value.filter((_, i) => i !== index)); }} />)}</ul>
    <div className="image-reference-feedback" role="status" title={error}>{error}</div>
  </div>;
}
