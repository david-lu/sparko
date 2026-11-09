import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import ModalBackdrop from '../../shared/ModalBackdrop';
import { AssetPreview } from './AssetInspector';
import './asset-preview-dialog.css';

function PreviewDialog({ assetId, kind, name, onPlay, onClose, restoreFocus }: {
  assetId: string; kind: string; name: string; onPlay?: () => void; onClose: () => void; restoreFocus: () => void;
}) {
  const heading = useId(), content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = content.current;
    return () => { root?.querySelectorAll<HTMLMediaElement>('video, audio').forEach(media => media.pause()); };
  }, []);
  return <ModalBackdrop labelledBy={heading} onCancel={onClose} restoreFocus={restoreFocus}>
    <div ref={content} className="project-card asset-preview-dialog" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onDragStart={event => event.stopPropagation()}
      onPlayCapture={event => { document.querySelectorAll<HTMLMediaElement>('video, audio').forEach(media => { if (media !== event.target) media.pause(); }); }}>
      <h2 id={heading}>Preview {name}</h2>
      <AssetPreview id={assetId} kind={kind === 'generated' ? 'video' : kind} name={name} showErrorDetails onPlay={() => onPlay?.()}/>
      <div className="asset-preview-dialog-actions"><button type="button" className="button" autoFocus onClick={onClose}>Close preview</button></div>
    </div>
  </ModalBackdrop>;
}

export default function AssetPreviewButton({ assetId, kind, name, disabled, onPlay }: {
  assetId: string; kind: string; name: string; disabled?: boolean; onPlay?: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null), [open, setOpen] = useState(false);
  return <>
    <button ref={trigger} type="button" className="icon-button small asset-preview-button" aria-label={`Preview ${name}`} title={`Preview ${name}`} aria-haspopup="dialog" disabled={disabled}
      onClick={event => { event.stopPropagation(); setOpen(true); }}><Eye size={14} aria-hidden/></button>
    {open && <PreviewDialog assetId={assetId} kind={kind} name={name} onPlay={onPlay} onClose={() => setOpen(false)} restoreFocus={() => trigger.current?.focus()}/>}
  </>;
}
