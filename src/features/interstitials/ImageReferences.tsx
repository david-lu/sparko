import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { IMAGE_REFERENCE, type ImageReference } from '../../../shared/image-references';
import { assets } from '../project/assets';
import { useAssetAvailability } from '../project/useAssetAvailability';
import ContentIssues from '../../shared/ContentIssues';
import { prepareImageReference } from './image-references';
import { readLibraryDrag, startLibraryDrag, STORY_DRAG_TYPE } from '../story-flow/libraryDrag';
import type { ProjectController } from '../project/ProjectController';
import LibraryAssetPicker from '../project/LibraryAssetPicker';
import AssetPreviewButton from '../project/AssetPreviewButton';

function Thumbnail({ reference, index, onRemove, onToggle, disabled }: { reference: ImageReference; index: number; onRemove: () => void; onToggle: () => void; disabled: boolean }) {
  const [url, setUrl] = useState<string>(), [decodeError, setDecodeError] = useState('');
  useAssetAvailability([reference.assetId]);
  const error = assets.error(reference.assetId) || decodeError;
  useEffect(() => {
    let active = true;
    setUrl(undefined); setDecodeError('');
    void assets.open(reference.assetId).then(value => { if (active) setUrl(value.url); }).catch(() => undefined);
    return () => { active = false; };
  }, [reference.assetId]);
  return <li data-enabled={reference.enabled !== false} draggable={!disabled} onDragStart={e => { e.stopPropagation(); startLibraryDrag(e, { assetId: reference.assetId }); }}>
    <div className="image-reference-thumb">{url && !error && <img src={url} alt={reference.name} draggable={false} onError={() => setDecodeError('This reference image could not be decoded. Replace it with a working PNG, JPEG or WebP image.')} />}</div>
    <span title={reference.name}><strong>{`<Picture ${index + 1}>`}</strong><small>{reference.name}</small></span>
    <input type="checkbox" aria-label={`Enable Picture ${index + 1}`} checked={reference.enabled !== false} disabled={disabled} onChange={onToggle}/>
    <ContentIssues label={`Picture ${index + 1} errors`} issues={error ? [{ key: reference.assetId, title: reference.name, message: error }] : []}/>
    <AssetPreviewButton assetId={reference.assetId} kind="image" name={reference.name} disabled={disabled}/>
    <button type="button" className="icon-button" aria-label={`Remove Picture ${index + 1}`} disabled={disabled} onClick={onRemove}><X size={14} /></button>
  </li>;
}

export default function ImageReferences({ value = [], onChange, onBusyChange, projects }: { value?: ImageReference[]; onChange: (value: ImageReference[]) => void; onBusyChange: (busy: boolean) => void; projects?: ProjectController }) {
  const input = useRef<HTMLInputElement>(null), operation = useRef<AbortController | null>(null);
  const choose = useRef<HTMLButtonElement>(null), [picking, setPicking] = useState(false);
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
  const addAssets = async (ids: string[]) => {
    if (operation.current) return false;
    const task = new AbortController(); operation.current = task; setBusy(true); onBusyChange(true); setError('');
    try {
      const added: ImageReference[] = [], unique = [...new Set(ids)].filter(id => !value.some(ref => ref.assetId === id));
      if (value.length + unique.length > IMAGE_REFERENCE.maxCount) throw new Error('Use up to 9 image references.');
      for (const id of unique) {
        const { asset } = await assets.open(id); task.signal.throwIfAborted();
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(asset.blob.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
        added.push({ assetId: id, name: projects?.getSnapshot().project?.library?.find(a => a.assetId === id)?.name ?? asset.name });
      }
      task.signal.throwIfAborted(); onChange([...value, ...added]); return true;
    } catch (e) { if (!task.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to add image.'); return false; }
    finally { if (!task.signal.aborted) { operation.current = null; setBusy(false); onBusyChange(false); } }
  };
  return <div className={`field image-references ${dragging ? 'is-dragging' : ''}`} role="group" aria-label="Image references"
    onDragOver={e => { if (e.dataTransfer.types.includes(STORY_DRAG_TYPE) || e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy'; if (!busy) setDragging(true); } }}
    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }} onDragEnd={() => setDragging(false)}
    onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragging(false); if (busy) return; if (e.dataTransfer.files.length) void add([...e.dataTransfer.files]); else { const item = readLibraryDrag(e.dataTransfer); if (item && 'assetId' in item && item.assetId) void addAssets([item.assetId]); else setError('Generate the image before using it as a reference.'); } }}>
    <div className="image-reference-heading"><span>Image references <small>{value.length}/{IMAGE_REFERENCE.maxCount}</small></span>
      <button type="button" className="button" disabled={busy || value.length >= IMAGE_REFERENCE.maxCount} onClick={() => input.current?.click()}>
        <span className="status-icon">{busy ? <span className="spinner" /> : <ImagePlus size={14} />}</span>{busy ? 'Adding…' : 'Add images'}
      </button>
    </div>
    {projects && <button ref={choose} type="button" className="text-button" aria-label="Choose image references from Library" disabled={busy || value.length >= IMAGE_REFERENCE.maxCount} onClick={() => { setError(''); setPicking(true); }}>Choose from Library</button>}
    <input ref={input} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" aria-label="Choose image references" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void add(files); }} />

    <ul className="image-reference-list">{value.map((reference, index) => <Thumbnail key={`${reference.assetId}:${index}`} reference={reference} index={index} disabled={busy} onToggle={() => onChange(value.map((image, i) => i === index ? { ...image, enabled: image.enabled === false } : image))} onRemove={() => { setError(''); onChange(value.filter((_, i) => i !== index)); }} />)}</ul>
    <div className="image-reference-feedback" role="status" title={error}>{error}</div>
    {picking && projects && <LibraryAssetPicker library={projects.getSnapshot().project?.library ?? []} kinds={['image']} label="image references" selectedIds={value.map(ref => ref.assetId)} maxCount={IMAGE_REFERENCE.maxCount}
      busy={busy} error={error} onClose={() => setPicking(false)} restoreFocus={() => {
        if (choose.current?.disabled) choose.current.closest('.image-references')?.querySelector<HTMLButtonElement>('.image-reference-list button[aria-label^="Remove Picture"]')?.focus();
        else choose.current?.focus();
      }}
      onChoose={ids => { void addAssets(ids).then(added => { if (added) setPicking(false); }); }}/>}
  </div>;
}
