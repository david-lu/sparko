import { referenceClips, referenceWindow } from '../../../shared/reference-clips';
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
    const originals = referenceClips(result.reference, side), savedClips = referenceClips(result.metadata?.references, side);
    const clips = originals.length ? originals : savedClips;
    if (!clips.length) return [{ name: length ? 'Not recorded' : 'None', detail: 'Reference footage saved with this render', source: undefined }];
    const looping = (result.reference?.mode ?? result.metadata?.references.mode) === 'loop';
    const window = !length || side === 'after' && looping ? clips : referenceWindow(clips, Math.round(length * TIMELINE_FPS), side);
    return window.map(ref => {
      const saved = savedClips.find(clip => clip.assetId === ref.assetId || assetAliases?.[clip.assetId] === ref.assetId);
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
      if (side === 'after' && looping) return { name, source, detail: `Held final frame at ${format((ref.outFrame - 1) / TIMELINE_FPS)} · same pose as the loop start` };
      return { name, source, detail: `${span(ref.inFrame / TIMELINE_FPS, ref.outFrame / TIMELINE_FPS)}${ref.kind === 'image' ? ' · still image, silent' : ''}` };
    });
  };
  const opening = reference('before', range?.start ?? 0), ending = reference('after', tail);
  const seed = <dl aria-label="Generation details"><div><dt>{result.metadata?.settings.resolution === '2k' ? 'H3 base seed' : 'Seed'}</dt>
    <dd aria-label="Generation seed">{result.metadata?.seed ?? 'Not recorded'}</dd></div></dl>;
  const references = <dl className="generated-reference-videos">{([
    ['Start video', 'start', opening], ['End video', 'end', ending],
  ] as const).flatMap(([label, side, refs]) => refs.map((ref, index) => <div key={`${side}:${index}`}>
    <dt>{label}{refs.length > 1 ? ` ${index + 1}` : ''}</dt><dd><span className="generated-reference-name">{ref.name}</span>
      {ref.source ? <button type="button" className="button generated-reference-select" aria-label={`Select ${side} reference video${refs.length > 1 ? ` ${index + 1}` : ''}`} title={`Select ${ref.name} in the timeline`} onClick={() => onSelectReference(ref.source!.id)}><LocateFixed size={14} aria-hidden />Select</button>
        : ref.name !== 'None' && ref.name !== 'Not recorded' && <small>Original clip is not in this project’s timeline</small>}
    </dd>
  </div>))}</dl>;
  if (!range) return <section className="generated-video-info" aria-label="Video breakdown"><h3>Saved video</h3>{seed}{references}<p className="hint">{format(result.duration)} playable loop. Reference timings were not saved with this older render.</p></section>;
  const bounds = generatedBounds(node, result.duration);
  const sections = [{ id: 'reference opening', label: 'Opening reference', start: 0, end: range.start, detail: opening.map(ref => `${ref.name}: ${ref.detail}`).join(' → ') },
    { id: 'generated', label: 'Generated section', start: range.start, end, detail: 'New video created for this clip' },
    { id: 'reference ending', label: 'Ending reference', start: end, end: range.totalDuration, detail: ending.map(ref => `${ref.name}: ${ref.detail}`).join(' → ') }].filter(s => s.end - s.start > 1e-6);
  return <section className="generated-video-info" aria-label="Video breakdown"><h3>Video breakdown <span>{format(range.totalDuration)} total</span></h3>
    <p className="hint">{item.phase === 'ready' ? 'Actual timings in the saved video.' : 'Showing the last playable video while its replacement is pending.'}</p>
    {seed}{references}
    <div className="generated-video-bar" aria-hidden>{sections.map(s => <span key={s.label} className={s.id} style={{ flex: s.end - s.start }} title={s.label}/>)}</div>
    <dl>{sections.map(s => <div key={s.label} className={s.id}><dt>{s.label}<small>{format(s.end - s.start)}</small></dt><dd>{span(s.start, s.end)}<small>{s.detail}</small></dd></div>)}</dl>
    <p className="generated-play-range"><strong>Used in the timeline</strong><span>{span(range.start + bounds.inFrame / TIMELINE_FPS, range.start + bounds.outFrame / TIMELINE_FPS)}</span><small>{format((bounds.outFrame - bounds.inFrame) / TIMELINE_FPS)}{behaviors(node).loop ? ' per repeat' : ''}. Reference sections stay outside the clip.</small></p>
  </section>;
}
