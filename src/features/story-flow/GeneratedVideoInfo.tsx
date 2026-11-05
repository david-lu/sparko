import { LocateFixed } from 'lucide-react';
import { playableResult, type Interstitial } from '../../../shared/interstitials';
import { behaviors } from './behaviors';
import { TIMELINE_FPS } from '../../../shared/constants';
import { generatedBounds, type StoryNode } from './model';

export default function GeneratedVideoInfo({ item, node, nodes, items, assetAliases, onSelectReference }: {
  item: Interstitial; node: StoryNode; nodes: StoryNode[]; items: Interstitial[]; assetAliases?: Record<string, string>; onSelectReference: (id: string) => void;
}) {
  const result = playableResult(item); if (!result) return null;
  const range = result.fullAssetId ? result.fullRange ?? (result === item.result ? item.requestInsertion : undefined) : result;
  const format = (seconds: number) => `${seconds.toFixed(3)} s`, span = (start: number, end: number) => `${format(start)} – ${format(end)}`;
  const end = range ? range.start + range.duration : 0, tail = range ? Math.max(0, range.totalDuration - end) : 0;
  const reference = (side: 'before' | 'after', length: number) => {
    const saved = result.metadata?.references[side], ref = result.reference?.[side] ?? saved;
    if (!ref) return { name: length ? 'Not recorded' : 'None', detail: 'Reference footage saved with this render' };
    const assetId = assetAliases?.[ref.assetId] ?? ref.assetId;
    // Use the saved render's media, even if the graph or next generation settings changed.
    const matches = nodes.filter(candidate => {
      if (candidate.id === node.id) return false;
      const job = items.find(i => i.id === candidate.interstitialId), media = job && playableResult(job);
      return candidate.source?.assetId === assetId || media?.assetId === assetId || media?.fullAssetId === assetId
        || !!saved?.renderId && media?.metadata?.id === saved.renderId;
    });
    const source = matches.find(candidate => candidate.id === ref.sceneId) ?? matches[0];
    const name = items.find(i => i.id === source?.interstitialId)?.label ?? source?.name ?? saved?.name ?? 'Saved reference clip';
    const looping = (result.reference?.mode ?? result.metadata?.references.mode) === 'loop';
    if (side === 'after' && looping) return { name, source, detail: `Held final frame at ${format((ref.outFrame - 1) / TIMELINE_FPS)} · same pose as the loop start` };
    const start = side === 'after' ? ref.inFrame / TIMELINE_FPS : Math.max(ref.inFrame / TIMELINE_FPS, ref.outFrame / TIMELINE_FPS - length);
    return { name, source, detail: span(start, start + length) };
  };
  const opening = reference('before', range?.start ?? 0), ending = reference('after', tail);
  const references = <dl className="generated-reference-videos">{([
    ['Start video', 'start', opening], ['End video', 'end', ending],
  ] as const).map(([label, side, ref]) => <div key={side}>
    <dt>{label}</dt><dd><span className="generated-reference-name">{ref.name}</span>
      {ref.source ? <button type="button" className="button generated-reference-select" aria-label={`Select ${side} reference video`} title={`Select ${ref.name} in the timeline`} onClick={() => onSelectReference(ref.source!.id)}><LocateFixed size={14} aria-hidden />Select</button>
        : ref.name !== 'None' && ref.name !== 'Not recorded' && <small>Original clip is not in this project’s timeline</small>}
    </dd>
  </div>)}</dl>;
  if (!range) return <section className="generated-video-info" aria-label="Video breakdown"><h3>Saved video</h3>{references}<p className="hint">{format(result.duration)} playable loop. Reference timings were not saved with this older render.</p></section>;
  const bounds = generatedBounds(node, result.duration);
  const sections = [{ id: 'reference', label: 'Opening reference', start: 0, end: range.start, detail: opening.detail },
    { id: 'generated', label: 'Generated section', start: range.start, end, detail: 'New video created for this clip' },
    { id: 'reference', label: 'Ending reference', start: end, end: range.totalDuration, detail: ending.detail }].filter(s => s.end - s.start > 1e-6);
  return <section className="generated-video-info" aria-label="Video breakdown"><h3>Video breakdown <span>{format(range.totalDuration)} total</span></h3>
    <p className="hint">{item.phase === 'ready' ? 'Actual timings in the saved video.' : 'Showing the last playable video while its replacement is pending.'}</p>
    {references}
    <div className="generated-video-bar" aria-hidden>{sections.map(s => <span key={s.label} className={s.id} style={{ flex: s.end - s.start }} title={s.label}/>)}</div>
    <dl>{sections.map(s => <div key={s.label} className={s.id}><dt>{s.label}<small>{format(s.end - s.start)}</small></dt><dd>{span(s.start, s.end)}<small>{s.detail}</small></dd></div>)}</dl>
    <p className="generated-play-range"><strong>Used in the timeline</strong><span>{span(range.start + bounds.inFrame / TIMELINE_FPS, range.start + bounds.outFrame / TIMELINE_FPS)}</span><small>{format((bounds.outFrame - bounds.inFrame) / TIMELINE_FPS)}{behaviors(node).loop ? ' per repeat' : ''}. Reference sections stay outside the clip.</small></p>
  </section>;
}
