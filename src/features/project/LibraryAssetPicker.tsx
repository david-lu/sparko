import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import type { MediaKind } from '../../../shared/asset-generation';
import ModalBackdrop from '../../shared/ModalBackdrop';
import AssetThumbnail from './AssetThumbnail';
import AssetPreviewButton from './AssetPreviewButton';
import type { LibraryAsset } from './types';
import './library-asset-picker.css';

export default function LibraryAssetPicker({ library, kinds, label, selectedIds = [], multiple = true, maxCount = 16, busy, error, onChoose, onClose, restoreFocus, onPreviewPlay }: {
  library: LibraryAsset[]; kinds: MediaKind[]; label: string; selectedIds?: string[]; multiple?: boolean; maxCount?: number;
  busy: boolean; error: string; onChoose: (ids: string[]) => void; onClose: () => void; restoreFocus: () => void; onPreviewPlay?: () => void;
}) {
  const heading = useId(), [query, setQuery] = useState(''), [selected, setSelected] = useState<string[]>([]);
  const candidates = library.filter(asset => kinds.includes(asset.kind === 'generated' ? 'video' : asset.kind));
  const visible = candidates.filter(asset => asset.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const capacity = multiple ? Math.max(0, maxCount - selectedIds.length) : 1;
  const close = () => { if (!busy) onClose(); };
  // Wait for the triggering button's busy/disabled state to finish updating.
  return <ModalBackdrop labelledBy={heading} onCancel={close} restoreFocus={() => queueMicrotask(restoreFocus)}>
    <div className="library-asset-picker project-card" onKeyDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <h2 id={heading}>Choose {label} from Library</h2>
      <input type="search" aria-label="Search Library assets" placeholder="Search assets…" value={query} autoFocus disabled={busy}
        onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}/>
      <div className="library-asset-picker-list" role="group" aria-label="Available assets" aria-busy={busy}>
        {visible.map(asset => {
          const included = multiple && selectedIds.includes(asset.assetId), checked = selected.includes(asset.assetId);
          return <div className="library-asset-picker-entry" key={asset.assetId}><button type="button" className="library-asset-picker-row" aria-label={asset.name} aria-pressed={included || checked}
            disabled={busy || included || !checked && selected.length >= capacity && multiple}
            onClick={() => setSelected(current => checked ? current.filter(id => id !== asset.assetId) : multiple ? [...current, asset.assetId] : [asset.assetId])}>
            <AssetThumbnail asset={asset} kind={asset.kind} name={asset.name}/>
            <span><strong>{asset.name}</strong><small>{included ? 'Already added' : asset.kind === 'generated' ? 'video' : asset.kind}</small></span>
            <span className="library-asset-picker-check">{(included || checked) && <Check size={16} aria-hidden/>}</span>
          </button><AssetPreviewButton assetId={asset.assetId} kind={asset.kind} name={asset.name} disabled={busy} onPlay={onPreviewPlay}/></div>;
        })}
        {!visible.length && <p className="library-asset-picker-empty">{candidates.length ? 'No matching assets.' : `No ${kinds.join(' or ')} assets in this Library. Import a file to get started.`}</p>}
      </div>
      <div className="library-asset-picker-feedback" role="status">{error || (multiple ? `${selected.length} selected · ${capacity} available ${capacity === 1 ? 'slot' : 'slots'}` : 'Choose one asset.')}</div>
      <div className="library-asset-picker-actions">
        <button type="button" className="button" disabled={busy} onClick={close}>Cancel</button>
        <button type="button" className="button primary" disabled={busy || !selected.length} onClick={() => onChoose(selected)}>{busy ? 'Adding…' : multiple ? 'Use selected' : 'Use asset'}</button>
      </div>
    </div>
  </ModalBackdrop>;
}
