import { useEffect, useId, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';
import ModalBackdrop from '../../shared/ModalBackdrop';
import { assets } from './assets';
import type { ProjectController } from './ProjectController';
import type { LibraryAsset } from './types';
import { paintDrawing, type DrawingStroke } from './imageDrawing';
import './image-drawing.css';

export default function ImageDrawingDialog({ assetId, projects, onSaved, onClose, restoreFocus }: {
  assetId: string; projects: ProjectController; onSaved: (asset: LibraryAsset) => void; onClose: () => void; restoreFocus: () => void;
}) {
  const id = useId(), state = useSyncExternalStore(projects.subscribe, projects.getSnapshot);
  const canvas = useRef<HTMLCanvasElement>(null), image = useRef<ImageBitmap | undefined>(undefined), layer = useRef<OffscreenCanvas | undefined>(undefined);
  const mounted = useRef(true), saving = useRef(false), active = useRef<{ id: number; stroke: DrawingStroke } | undefined>(undefined), frame = useRef<number | undefined>(undefined);
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<DrawingStroke['tool']>('brush'), [color, setColor] = useState('#ff4444'), [size, setSize] = useState(12);
  const [history, setHistory] = useState<DrawingStroke[][]>([[]]), [position, setPosition] = useState(0);
  const strokes = history[position], latest = useRef(strokes); latest.current = strokes;
  const render = () => {
    if (!image.current || !layer.current || !canvas.current) return;
    paintDrawing(layer.current.getContext('2d')!, [...latest.current, ...(active.current ? [active.current.stroke] : [])]);
    const context = canvas.current.getContext('2d')!;
    context.clearRect(0, 0, canvas.current.width, canvas.current.height);
    context.drawImage(image.current, 0, 0); context.drawImage(layer.current, 0, 0);
  };
  useEffect(() => {
    let cancelled = false; mounted.current = true;
    void assets.open(assetId).then(({ asset }) => createImageBitmap(asset.blob)).then(bitmap => {
      if (cancelled) { bitmap.close(); return; }
      image.current = bitmap; layer.current = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.current!.width = bitmap.width; canvas.current!.height = bitmap.height;
      render(); setReady(true);
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to open this image.'); });
    return () => {
      cancelled = true; mounted.current = false; image.current?.close(); image.current = undefined; layer.current = undefined;
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      if (saving.current) projects.cancel();
    };
  }, [assetId, projects]);
  useEffect(render, [strokes]);
  const commit = (next: DrawingStroke[]) => { setHistory([...history.slice(0, position + 1), next]); setPosition(position + 1); };
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * event.currentTarget.width / bounds.width, y: (event.clientY - bounds.top) * event.currentTarget.height / bounds.height };
  };
  const stopStroke = (event: PointerEvent<HTMLCanvasElement>, cancel = false) => {
    if (active.current?.id !== event.pointerId) return;
    const stroke = active.current.stroke; active.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancel) commit([...strokes, stroke]);
    render();
  };
  const cancel = () => { if (saving.current) projects.cancel(); onClose(); };
  const save = async () => {
    if (!ready || busy || state.busy || !strokes.length || active.current) return;
    setBusy(true); setError(''); saving.current = true;
    try {
      const copy = await projects.saveDrawnImage(assetId, async signal => {
        signal.throwIfAborted(); render();
        const blob = await new Promise<Blob>((resolve, reject) => canvas.current!.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to save this drawing.')), 'image/png'));
        signal.throwIfAborted(); return blob;
      });
      if (!mounted.current) return;
      if (copy) { saving.current = false; onClose(); onSaved(copy); }
      else setError(projects.getSnapshot().error ?? 'Saving cancelled.');
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Unable to save this drawing.'); }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  };
  return <ModalBackdrop labelledBy={`${id}-title`} onCancel={cancel} restoreFocus={restoreFocus}>
    <section className="project-card image-drawing-dialog" onKeyDown={event => {
      if (busy || active.current || !(event.metaKey || event.ctrlKey) || (event.target instanceof HTMLInputElement)) return;
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); setPosition(p => event.shiftKey ? Math.min(history.length - 1, p + 1) : Math.max(0, p - 1)); }
    }}>
      <h2 id={`${id}-title`}>Draw on image</h2>
      <div className="drawing-toolbar" aria-label="Drawing tools">
        <div className="drawing-tool-buttons"><button autoFocus type="button" aria-pressed={tool === 'brush'} disabled={busy} onClick={() => setTool('brush')}>Brush</button><button type="button" aria-pressed={tool === 'eraser'} disabled={busy} onClick={() => setTool('eraser')}>Eraser</button></div>
        <label>Color<input aria-label="Brush color" type="color" value={color} disabled={busy || tool === 'eraser'} onChange={event => setColor(event.target.value)}/></label>
        <label className="drawing-size">Size<input aria-label="Brush size" type="range" min={1} max={100} value={size} disabled={busy} onChange={event => setSize(Number(event.target.value))}/><output>{size} px</output></label>
        <div className="drawing-history"><button type="button" disabled={busy || position === 0} onClick={() => setPosition(position - 1)}>Undo drawing</button><button type="button" disabled={busy || position === history.length - 1} onClick={() => setPosition(position + 1)}>Redo drawing</button><button type="button" disabled={busy || !strokes.length} onClick={() => commit([])}>Clear drawing</button></div>
      </div>
      <div className="drawing-stage" aria-busy={!ready}>
        <canvas ref={canvas} aria-label="Image drawing canvas" tabIndex={0} style={{ visibility: ready ? 'visible' : 'hidden' }}
          onPointerDown={event => {
            if (!ready || busy || active.current || event.button !== 0) return;
            event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
            active.current = { id: event.pointerId, stroke: { tool, color, size, points: [point(event)] } }; render();
          }} onPointerMove={event => {
            if (active.current?.id !== event.pointerId) return;
            active.current.stroke.points.push(point(event));
            if (frame.current === undefined) frame.current = requestAnimationFrame(() => { frame.current = undefined; render(); });
          }} onPointerUp={event => stopStroke(event)} onPointerCancel={event => stopStroke(event, true)} onLostPointerCapture={event => stopStroke(event, true)}/>
        {!ready && <span className="drawing-loading">{error ? 'Image unavailable' : 'Loading image…'}</span>}
      </div>
      <p className="hint">Draw with a mouse, pen, or touch. The eraser removes drawing marks. Saves a new PNG at the original dimensions.</p>
      <div className="drawing-feedback" role="status" aria-label="Drawing status">{error}</div>
      <footer className="drawing-actions"><button type="button" className="button" onClick={cancel}>Cancel</button><button type="button" className="button primary" disabled={!ready || busy || state.busy || !strokes.length} aria-busy={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save as new asset'}</button></footer>
    </section>
  </ModalBackdrop>;
}
