import { useEffect, useRef, useState } from 'react';
import { GripVertical, Upload, X } from 'lucide-react';
import type { AssetReference, MediaKind } from '../../../shared/asset-generation';
import type { ProjectController } from './ProjectController';
import { fileEntries, mediaFile, mediaKind } from './libraryFiles';
import { readLibraryDrag, startLibraryDrag, STORY_DRAG_TYPE } from '../story-flow/libraryDrag';
import AssetThumbnail from './AssetThumbnail';
import { assets } from './assets';
import './asset-input.css';

export default function AssetInput({ projects, value, kinds, onChange, label = 'Reference assets', multiple = true, maxCount = 16, imageFormats, validate }: {
  projects: ProjectController; value: AssetReference[]; kinds: MediaKind[]; onChange: (value: AssetReference[]) => void; label?: string; multiple?: boolean;
  maxCount?: number; imageFormats?: string[]; validate?: (reference: AssetReference) => string | undefined;
}) {
  const input = useRef<HTMLInputElement>(null), operation = useRef<AbortController | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [dragging, setDragging] = useState(false);
  const projectId = projects.getSnapshot().project?.id, library = projects.getSnapshot().project?.library ?? [];
  useEffect(() => () => { operation.current?.abort(); }, [projectId]);
  const add = async (ids: string[], signal: AbortSignal) => {
    const current = projects.getSnapshot().project?.library ?? [], refs: AssetReference[] = [];
    for (const id of ids) {
      const asset = current.find(a => a.assetId === id), kind = asset?.kind === 'generated' ? 'video' : asset?.kind;
      if (!asset || !kinds.includes(kind as MediaKind)) throw new Error(`Drop ${kinds.join(', ')} assets here.`);
      if (imageFormats && !imageFormats.includes((await assets.open(id)).asset.blob.type)) throw new Error('Use a PNG, JPEG or WebP image.');
      const reference = { assetId: id, name: asset.name, kind: kind as MediaKind }, invalid = validate?.(reference);
      if (invalid) throw new Error(invalid);
      refs.push(reference);
    }
    const next = multiple ? [...value, ...refs.filter(r => !value.some(v => v.assetId === r.assetId))] : refs.slice(-1);
    if (next.length > maxCount) throw new Error(`Use up to ${maxCount} references.`);
    signal.throwIfAborted(); if (projects.getSnapshot().project?.id !== projectId) return;
    onChange(next);
  };
  const receive = async (files: File[], id?: string) => {
    if (operation.current) return;
    const task = new AbortController(); operation.current = task; setBusy(true); setError('');
    try {
      if (files.length) {
        if ((!multiple && files.length > 1) || multiple && value.length + files.length > maxCount) throw new Error(multiple ? `Use up to ${maxCount} references.` : 'Drop one asset at a time.');
        for (const file of files) {
          if (!kinds.includes(mediaKind(file) as MediaKind)) throw new Error(`Drop ${kinds.join(', ')} assets here.`);
          if (imageFormats && !imageFormats.includes(mediaFile(file).type)) throw new Error('Use a PNG, JPEG or WebP image.');
        }
        const added = await projects.importAssets(fileEntries(files)); task.signal.throwIfAborted(); await add(added.map(a => a.assetId), task.signal);
      } else if (id) await add([id], task.signal);
      else throw new Error('This generation has no output yet. Generate it first.');
    } catch (e) { if (!task.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to add reference.'); }
    finally { if (!task.signal.aborted) { operation.current = null; setBusy(false); } }
  };
  const dropLabel = multiple ? `Drag ${kinds.length === 1 ? kinds[0] + 's' : 'assets'} from Library` : `Drag ${kinds[0]} from Library`;
  return <div className={`asset-input ${dragging ? 'is-dragging' : ''}`} role="group" aria-label={label} aria-busy={busy}
    onDragOver={e => { if (e.dataTransfer.types.includes(STORY_DRAG_TYPE) || e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy'; if (!busy) setDragging(true); } }}
    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
    onDragEnd={() => setDragging(false)}
    onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragging(false); const item = readLibraryDrag(e.dataTransfer); void receive([...e.dataTransfer.files], item && 'assetId' in item ? item.assetId : undefined); }}>
    <div className={`asset-input-slots ${multiple ? 'multiple' : ''}`}>
      {!value.length && <div className="asset-input-empty"><Upload size={17}/><span>{dropLabel}</span></div>}
      {value.map(ref => <div className="asset-reference-chip" key={ref.assetId} draggable={!busy} onDragStart={e => { e.stopPropagation(); startLibraryDrag(e, { assetId: ref.assetId }); }}>
        <AssetThumbnail asset={library.find(a => a.assetId === ref.assetId) ?? { assetId: ref.assetId, kind: ref.kind }} kind={ref.kind} name={ref.name}/>
        <span title={ref.name}>{ref.name}</span><GripVertical size={12}/><button type="button" className="icon-button small" disabled={busy} aria-label={`Remove reference ${ref.name}`} onClick={() => { setError(''); onChange(value.filter(v => v.assetId !== ref.assetId)); }}><X size={12}/></button>
      </div>)}
    </div>
    <div className="asset-input-actions"><span>{busy ? 'Importing…' : value.length ? multiple ? 'Drop to add references' : 'Drop to replace' : 'or drop a file'}</span><button type="button" className="text-button" disabled={busy || !kinds.length} onClick={() => input.current?.click()}>Browse files</button></div>
    <input ref={input} type="file" hidden multiple={multiple} accept={imageFormats?.join(',') ?? kinds.map(k => `${k}/*`).join(',')} aria-label={`Upload ${label}`} onChange={e => { const files = [...e.target.files ?? []]; if (files.length) void receive(files); e.target.value = ''; }}/>
    <div className="asset-input-feedback" role="status" title={error}>{error}</div>
  </div>;
}
